// (state, action) => state. Pure and deterministic: every random roll derives from
// rngFor(runSeed, ...context), never from mutable RNG state.

import { IllegalAction, type Action } from './actions.ts';
import { addClock, cancelOnLeave, CLOCK_KINDS, tickClocks } from './clocks.ts';
import type {
  Cargo,
  ClockPayoff,
  Content,
  Deltas,
  MineableResource,
  Outcome,
  Range,
} from './content.ts';
import { canAfford, findEvent, rollEvent, type EventContext } from './events/engine.ts';
import { generateSystem, round, type SystemState, type World } from './generate/system.ts';
import { rngFor, type Rng } from './rng.ts';
import { distanceBetween, starLabel, type Sector } from './sector.ts';
import type { GameState, LogKind, RunStats } from './state.ts';

export interface Ctx {
  sector: Sector;
  content: Content;
}

const RESOURCES = ['fuel', 'lifeSupport', 'hull', 'materials', 'data'] as const;
const MINEABLE: readonly MineableResource[] = ['fuel', 'materials', 'lifeSupport'];

// ---------------------------------------------------------------- setup

export function newGame(runSeed: string, sector: Sector, content: Content): GameState {
  const b = content.balance;
  const start = sector.start.starIndex;
  const startStar = sector.stars[start];
  if (!startStar) throw new Error('sector has no start star');
  const stats: RunStats = {
    jumps: 0,
    lyTraveled: 0,
    landings: 0,
    mines: 0,
    surveys: 0,
    stays: 0,
    repairs: 0,
    events: 0,
    clockPayoffs: 0,
    payoffTurns: [],
    koisResolved: 0,
    koisConfirmed: 0,
  };
  const s: GameState = {
    runSeed,
    sectorId: sector.id,
    contentVersion: content.version,
    turn: 0,
    ship: { ...b.ship.start, cargo: {} },
    position: start,
    landedOn: null,
    jumpRangeLy: b.jump.startingRangeLy,
    visited: [],
    revealed: [],
    systems: {},
    caches: {},
    frontX: startStar.pos[0] - b.front.startBehindLy,
    clocks: [],
    nextClockId: 1,
    stayStreak: 0,
    pendingEvent: null,
    eventsSeen: [],
    firsts: [],
    lastDamage: null,
    status: { kind: 'active' },
    log: [],
    stats,
  };
  const c = b.clocks;
  addClock(
    s,
    'recycler',
    c.recycler.label,
    c.recycler.every,
    { deltas: c.recycler.payoff, log: `${c.recycler.label} complete.` },
    { every: c.recycler.every },
  );
  addClock(
    s,
    'sensor-sweep',
    c.sensorSweep.label,
    c.sensorSweep.every,
    { deltas: c.sensorSweep.payoff, log: `${c.sensorSweep.label} complete.` },
    { every: c.sensorSweep.every },
  );
  const goal = sector.stars[sector.goal.starIndex];
  log(
    s,
    'info',
    `Departed ${starLabel(startStar)}. Destination: ${goal ? starLabel(goal) : 'unknown'}, ${Math.round(distanceBetween(sector, start, sector.goal.starIndex))} ly ahead.`,
  );
  arrive(s, { sector, content }, start);
  return s;
}

// ---------------------------------------------------------------- helpers

function log(s: GameState, kind: LogKind, text: string): void {
  s.log.push({ turn: s.turn, kind, text });
}

function insertSorted(list: number[], value: number): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] !== value) list.splice(lo, 0, value);
}

export function hasSorted(list: readonly number[], value: number): boolean {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return list[lo] === value;
}

function clampShip(s: GameState, content: Content): void {
  const max = content.balance.ship.max;
  const ship = s.ship;
  ship.fuel = round(Math.min(ship.fuel, max.fuel), 2);
  ship.lifeSupport = round(Math.min(ship.lifeSupport, max.lifeSupport), 2);
  ship.hull = round(Math.min(ship.hull, max.hull), 2);
  ship.materials = round(Math.min(ship.materials, max.materials), 2);
  ship.data = round(ship.data, 2);
}

function applyDeltas(s: GameState, content: Content, deltas: Deltas | undefined): void {
  if (!deltas) return;
  for (const k of RESOURCES) {
    const v = deltas[k];
    if (v) s.ship[k] += v;
  }
  clampShip(s, content);
}

function addCargo(s: GameState, cargo: Cargo | undefined): void {
  for (const [k, v] of Object.entries(cargo ?? {})) s.ship.cargo[k] = (s.ship.cargo[k] ?? 0) + v;
}

function damage(s: GameState, amount: number, source: string): void {
  if (amount <= 0) return;
  s.ship.hull = round(s.ship.hull - amount, 2);
  s.lastDamage = source;
}

function rollDamage(rng: Rng, [lo, hi]: Range): number {
  return rng.int(lo, hi);
}

export function systemAt(s: GameState, starIndex: number): SystemState | undefined {
  return s.systems[String(starIndex)];
}

function ensureSystem(s: GameState, ctx: Ctx, starIndex: number): SystemState {
  const key = String(starIndex);
  let sys = s.systems[key];
  if (!sys) {
    sys = generateSystem(s.runSeed, ctx.sector, starIndex, ctx.content.balance);
    s.systems[key] = sys;
  }
  return sys;
}

function currentSystem(s: GameState, ctx: Ctx): SystemState {
  return ensureSystem(s, ctx, s.position);
}

function findWorld(s: GameState, ctx: Ctx, worldId: string): World | undefined {
  return currentSystem(s, ctx).worlds.find((w) => w.id === worldId);
}

function updateWorld(s: GameState, ctx: Ctx, worldId: string, patch: (w: World) => World): void {
  const sys = currentSystem(s, ctx);
  s.systems[String(s.position)] = {
    ...sys,
    worlds: sys.worlds.map((w) => (w.id === worldId ? patch(w) : w)),
  };
}

export function jumpCost(
  content: Content,
  distanceLy: number,
): { fuel: number; lifeSupport: number } {
  const j = content.balance.jump;
  return {
    fuel: round(j.fuelBase + j.fuelPerLy * distanceLy + j.fuelPerLySquared * distanceLy ** 2, 1),
    lifeSupport: j.lifeSupportPerJump,
  };
}

/** Stars the ship can jump to right now (in range, any fuel level), nearest first. */
export function jumpTargets(s: GameState, ctx: Ctx): { index: number; distance: number }[] {
  const out: { index: number; distance: number }[] = [];
  for (const [index, distance] of ctx.sector.neighbors[s.position] ?? []) {
    if (distance > s.jumpRangeLy) break;
    out.push({ index, distance });
  }
  return out;
}

function mineableHere(w: World): boolean {
  return MINEABLE.some((r) => w.resources[r] > 0);
}

/** Can the ship mine this world from where it is? Giants are skimmed from orbit. */
export function canMine(s: GameState, w: World): boolean {
  return mineableHere(w) && (!w.landable || s.landedOn === w.id);
}

// ---------------------------------------------------------------- time

function reveal(s: GameState, ctx: Ctx, from: number): void {
  const range = ctx.content.balance.sensors.rangeLy;
  insertSorted(s.revealed, from);
  for (const [j, d] of ctx.sector.neighbors[from] ?? []) {
    if (d > range) break;
    insertSorted(s.revealed, j);
  }
}

function applyPayoff(s: GameState, ctx: Ctx, p: ClockPayoff, sourceId: number): void {
  applyDeltas(s, ctx.content, p.deltas);
  addCargo(s, p.cargo);
  if (p.revealCache) placeCache(s, ctx, p.revealCache, sourceId);
}

function placeCache(s: GameState, ctx: Ctx, deltas: Deltas, sourceId: number): void {
  const here = ctx.sector.stars[s.position]?.pos[0] ?? 0;
  const goalX = ctx.sector.stars[ctx.sector.goal.starIndex]?.pos[0] ?? here;
  const lo = here + 10;
  const hi = Math.min(goalX, here + 60);
  const options: number[] = [];
  ctx.sector.stars.forEach((st, i) => {
    if (st.pos[0] >= lo && st.pos[0] <= hi && !hasSorted(s.visited, i) && !s.caches[String(i)])
      options.push(i);
  });
  if (options.length === 0) {
    applyDeltas(s, ctx.content, deltas);
    log(s, 'good', 'No suitable cache site ahead; the signal carried the supplies itself.');
    return;
  }
  const idx = rngFor(s.runSeed, 'cache', sourceId).pick(options);
  s.caches[String(idx)] = deltas;
  insertSorted(s.revealed, idx);
  const st = ctx.sector.stars[idx];
  log(s, 'good', `Cache located at ${st ? starLabel(st) : idx}.`);
}

/** One turn passes: life support drains, the front advances, clocks tick. */
function advanceTurn(s: GameState, ctx: Ctx): void {
  const b = ctx.content.balance;
  s.turn += 1;
  s.ship.lifeSupport = round(s.ship.lifeSupport - b.lifeSupport.perTurn, 2);
  s.frontX = round(s.frontX + b.front.speedLyPerTurn, 3);
  const x = ctx.sector.stars[s.position]?.pos[0] ?? 0;
  if (x < s.frontX) {
    damage(s, b.front.hullDamagePerTurn, 'front');
    log(s, 'bad', `Behind the front. Hull -${b.front.hullDamagePerTurn}.`);
  }
  const done = tickClocks(s);
  let rewarded = false;
  for (const c of done) {
    applyPayoff(s, ctx, c.payoff, c.id);
    log(s, 'clock', c.payoff.log);
    if (CLOCK_KINDS[c.kind].reward) rewarded = true;
    s.stats.clockPayoffs += 1;
  }
  if (rewarded) s.stats.payoffTurns.push(s.turn);
}

function passTurns(s: GameState, ctx: Ctx, n: number): void {
  for (let i = 0; i < n && s.status.kind === 'active'; i++) {
    advanceTurn(s, ctx);
    checkEnd(s, ctx);
  }
}

// ---------------------------------------------------------------- run end

function strandedHere(s: GameState, ctx: Ctx): boolean {
  const canJump = jumpTargets(s, ctx).some(
    (t) => jumpCost(ctx.content, t.distance).fuel <= s.ship.fuel,
  );
  if (canJump) return false;
  const sys = currentSystem(s, ctx);
  const perLanding = ctx.content.balance.lifeSupport.perLanding;
  const fuelHere = sys.worlds.some(
    (w) =>
      w.resources.fuel > 0 &&
      (!w.landable || s.landedOn === w.id || s.ship.lifeSupport > perLanding),
  );
  const fuelComing = s.clocks.some(
    (c) => (c.payoff.deltas?.fuel ?? 0) > 0 && !CLOCK_KINDS[c.kind].cancelOnLeave,
  );
  return !fuelHere && !fuelComing;
}

function checkEnd(s: GameState, ctx: Ctx): void {
  if (s.status.kind !== 'active') return;
  if (s.ship.hull <= 0) {
    s.status = { kind: 'lost', cause: 'hull', detail: s.lastDamage ?? 'damage' };
    log(s, 'bad', 'Hull integrity failed.');
  } else if (s.ship.lifeSupport <= 0) {
    s.status = { kind: 'lost', cause: 'lifeSupport', detail: 'life support exhausted' };
    log(s, 'bad', 'Life support failed.');
  } else if (s.position === ctx.sector.goal.starIndex) {
    s.status = { kind: 'won' };
    log(s, 'good', 'Arrived. The crossing is complete.');
  } else if (s.pendingEvent === null && strandedHere(s, ctx)) {
    s.status = { kind: 'lost', cause: 'stranded', detail: 'no fuel and no way to get more' };
    log(s, 'bad', 'Stranded: not enough fuel to jump, and none to be had here.');
  }
}

// ---------------------------------------------------------------- arrival

function arrive(s: GameState, ctx: Ctx, index: number): boolean {
  const b = ctx.content.balance;
  const star = ctx.sector.stars[index];
  if (!star) throw new Error(`no star ${index}`);
  const firstVisit = !hasSorted(s.visited, index);
  const sys = ensureSystem(s, ctx, index);
  if (firstVisit) {
    insertSorted(s.visited, index);
    if (s.visited.length > 1) {
      const sp = b.clocks.spectrum;
      addClock(s, 'spectrum', `${sp.label}: ${starLabel(star)}`, sp.turns, {
        deltas: sp.payoff,
        log: `${sp.label} of ${starLabel(star)} complete: class ${sys.starClass}, ${sys.teffK.toLocaleString('en-US')} K.`,
      });
    }
    if (star.flags.landmark) {
      applyDeltas(s, ctx.content, { data: b.firstVisit.landmarkData });
      log(
        s,
        'real',
        `${starLabel(star)}. A name every astronomer knows. Data +${b.firstVisit.landmarkData}.`,
      );
    } else if (star.flags.host) {
      applyDeltas(s, ctx.content, { data: b.firstVisit.hostData });
      log(
        s,
        'real',
        `${starLabel(star)}: a known planet host, seen up close. Data +${b.firstVisit.hostData}.`,
      );
    }
    const resolved = b.generation.koiResolution.resolvedData;
    for (const r of sys.koiResolutions) {
      s.stats.koisResolved += 1;
      applyDeltas(s, ctx.content, { data: resolved[r.result] });
      const what =
        r.result === 'eclipsingBinary' ? 'an eclipsing binary' : 'an instrument artifact';
      log(s, 'real', `Candidate ${r.koi} was ${what}, not a planet. Data +${resolved[r.result]}.`);
    }
    for (const w of sys.worlds) {
      if (w.origin === 'candidate') {
        s.stats.koisResolved += 1;
        s.stats.koisConfirmed += 1;
        applyDeltas(s, ctx.content, { data: resolved.planet });
        log(
          s,
          'real',
          `Candidate ${w.name} is real: a ${w.type.replace('-', ' ')} world. Data +${resolved.planet}.`,
        );
      }
    }
  }
  reveal(s, ctx, index);
  const cache = s.caches[String(index)];
  if (cache) {
    applyDeltas(s, ctx.content, cache);
    delete s.caches[String(index)];
    log(s, 'good', 'Recovered the cache.');
  }
  return firstVisit;
}

function maybeEvent(s: GameState, ctx: Ctx, ectx: Omit<EventContext, 'system'>): void {
  if (s.status.kind !== 'active') return;
  const system = currentSystem(s, ctx);
  const ev = rollEvent(s, ctx.content, { ...ectx, system });
  if (!ev) return;
  s.pendingEvent = {
    eventId: ev.id,
    trigger: ectx.trigger,
    starIndex: s.position,
    worldId: s.landedOn,
  };
  s.eventsSeen.push(ev.id);
  s.stats.events += 1;
  log(s, 'event', ev.title);
}

function starHazardRoll(s: GameState, ctx: Ctx, tag: string): void {
  const sys = currentSystem(s, ctx);
  if (sys.hazard.kind === 'none' || sys.hazard.chance <= 0) return;
  const rng = rngFor(s.runSeed, 'star-hazard', tag, s.turn, s.position);
  if (rng.chance(sys.hazard.chance)) {
    const dmg = rollDamage(rng, sys.hazard.damage);
    damage(s, dmg, sys.hazard.kind);
    log(
      s,
      'bad',
      `${sys.hazard.kind === 'flare' ? 'Stellar flare' : 'Radiation surge'}. Hull -${dmg}.`,
    );
  }
}

// ---------------------------------------------------------------- actions

/** What mining this world would yield right now (limited by what's left and hold space). */
export function mineYield(
  s: GameState,
  ctx: Ctx,
  w: World,
  multiplier = 1,
): Record<MineableResource, number> {
  const b = ctx.content.balance;
  const max = b.ship.max;
  const room: Record<MineableResource, number> = {
    fuel: max.fuel - s.ship.fuel,
    materials: max.materials - s.ship.materials,
    lifeSupport: max.lifeSupport - s.ship.lifeSupport,
  };
  const out: Record<MineableResource, number> = { fuel: 0, materials: 0, lifeSupport: 0 };
  for (const r of MINEABLE) {
    out[r] = Math.max(
      0,
      Math.min(w.resources[r], Math.round(b.mining.perAction[r] * multiplier), Math.floor(room[r])),
    );
  }
  return out;
}

function extract(s: GameState, ctx: Ctx, w: World, multiplier: number): Deltas {
  const take = mineYield(s, ctx, w, multiplier);
  const got: Deltas = {};
  const left = { ...w.resources };
  for (const r of MINEABLE) {
    if (take[r] > 0) {
      got[r] = take[r];
      left[r] -= take[r];
    }
  }
  updateWorld(s, ctx, w.id, (x) => ({ ...x, resources: left }));
  applyDeltas(s, ctx.content, got);
  return got;
}

function describe(d: Deltas): string {
  const parts = Object.entries(d)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} +${v}`);
  return parts.length ? parts.join(', ') : 'nothing (holds full)';
}

function applyOutcome(s: GameState, ctx: Ctx, o: Outcome, sourceId: string): void {
  applyDeltas(s, ctx.content, o.deltas);
  addCargo(s, o.cargo);
  if (o.liftOff) s.landedOn = null;
  if (o.first && !s.firsts.includes(o.first)) {
    s.firsts.push(o.first);
    log(s, 'first', `First: ${o.first.replace(/-/g, ' ')}.`);
  }
  if (o.clock) {
    const kind = o.clock.kind;
    addClock(s, kind, o.clock.label, o.clock.turns, o.clock.payoff);
  }
  const hullDelta = o.deltas?.hull ?? 0;
  if (hullDelta < 0) s.lastDamage = sourceId;
  log(s, 'event', o.log);
  if (o.passTurns) passTurns(s, ctx, o.passTurns);
}

export function reduce(state: GameState, action: Action, ctx: Ctx): GameState {
  if (state.status.kind !== 'active') throw new IllegalAction(action, 'the run is over');
  if (state.pendingEvent && action.type !== 'chooseEvent')
    throw new IllegalAction(action, 'an event needs a decision first');
  // State is plain JSON; a JSON round-trip clones it and keeps it serializable by construction.
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const b = ctx.content.balance;

  switch (action.type) {
    case 'jump': {
      if (action.target === s.position) throw new IllegalAction(action, 'already here');
      const t = jumpTargets(s, ctx).find((x) => x.index === action.target);
      if (!t) throw new IllegalAction(action, 'out of jump range');
      const cost = jumpCost(ctx.content, t.distance);
      if (s.ship.fuel < cost.fuel) throw new IllegalAction(action, 'not enough fuel');
      s.ship.fuel = round(s.ship.fuel - cost.fuel, 2);
      s.ship.lifeSupport = round(s.ship.lifeSupport - cost.lifeSupport, 2);
      for (const c of cancelOnLeave(s, s.position)) log(s, 'info', `${c.label} abandoned.`);
      s.landedOn = null;
      s.stayStreak = 0;
      s.position = action.target;
      s.stats.jumps += 1;
      s.stats.lyTraveled = round(s.stats.lyTraveled + t.distance, 2);
      const star = ctx.sector.stars[action.target];
      log(
        s,
        'info',
        `Jumped ${t.distance.toFixed(1)} ly to ${star ? starLabel(star) : action.target}.`,
      );
      const firstVisit = arrive(s, ctx, action.target);
      advanceTurn(s, ctx);
      checkEnd(s, ctx);
      maybeEvent(s, ctx, { trigger: 'arrival', firstVisit, landedWorldType: null });
      break;
    }

    case 'survey': {
      const w = findWorld(s, ctx, action.worldId);
      if (!w) throw new IllegalAction(action, 'no such world here');
      if (w.surveyed) throw new IllegalAction(action, 'already surveyed');
      updateWorld(s, ctx, w.id, (x) => ({ ...x, surveyed: true }));
      const real = w.origin !== 'procedural';
      const data = b.survey.data + (real ? b.survey.realDataBonus : 0);
      applyDeltas(s, ctx.content, { data });
      s.stats.surveys += 1;
      log(
        s,
        real ? 'real' : 'info',
        `Surveyed ${w.name}${real ? ' (real Kepler data)' : ''}. Data +${data}.`,
      );
      const a = b.clocks.analysis;
      addClock(s, 'analysis', `${a.label}: ${w.name}`, a.turns, {
        deltas: a.payoff,
        log: `${a.label} of ${w.name} complete.`,
      });
      break;
    }

    case 'land': {
      const w = findWorld(s, ctx, action.worldId);
      if (!w) throw new IllegalAction(action, 'no such world here');
      if (!w.landable) throw new IllegalAction(action, 'cannot land on a giant');
      if (s.landedOn === w.id) throw new IllegalAction(action, 'already landed');
      s.landedOn = w.id;
      s.stayStreak = 0;
      s.ship.lifeSupport = round(s.ship.lifeSupport - b.lifeSupport.perLanding, 2);
      s.stats.landings += 1;
      const rng = rngFor(s.runSeed, 'landing', s.turn, w.id);
      const risk = w.landingRisk + (w.surveyed ? 0 : b.landing.unsurveyedRiskBonus);
      if (rng.chance(risk)) {
        const dmg = rollDamage(rng, b.landing.damage);
        damage(s, dmg, 'landing');
        log(s, 'bad', `Hard landing on ${w.name}. Hull -${dmg}.`);
      } else {
        log(s, 'info', `Landed on ${w.name}.`);
      }
      advanceTurn(s, ctx);
      checkEnd(s, ctx);
      maybeEvent(s, ctx, { trigger: 'landing', firstVisit: false, landedWorldType: w.type });
      break;
    }

    case 'mine': {
      const w = findWorld(s, ctx, action.worldId);
      if (!w) throw new IllegalAction(action, 'no such world here');
      if (!canMine(s, w))
        throw new IllegalAction(action, w.landable ? 'land first' : 'nothing left');
      if (!MINEABLE.some((r) => mineYield(s, ctx, w)[r] > 0))
        throw new IllegalAction(action, 'holds are full');
      const got = extract(s, ctx, w, 1);
      s.stats.mines += 1;
      log(s, 'good', `Mined ${w.name}: ${describe(got)}.`);
      const rng = rngFor(s.runSeed, 'mining', s.turn, w.id);
      if (rng.chance(b.mining.hazardChance)) {
        const dmg = rollDamage(rng, b.mining.hazardDamage);
        damage(s, dmg, 'mining');
        log(s, 'bad', `Mining accident. Hull -${dmg}.`);
      }
      starHazardRoll(s, ctx, 'mine');
      advanceTurn(s, ctx);
      checkEnd(s, ctx);
      break;
    }

    case 'stay': {
      s.stayStreak += 1;
      s.stats.stays += 1;
      const st = b.stay;
      const mult = 1 + st.yieldGrowthPerTurn * (s.stayStreak - 1);
      const sys = currentSystem(s, ctx);
      const landed = s.landedOn ? sys.worlds.find((w) => w.id === s.landedOn) : undefined;
      const source =
        landed && mineableHere(landed)
          ? landed
          : sys.worlds
              .filter((w) => !w.landable && w.resources.fuel > 0)
              .sort((a, c) => c.resources.fuel - a.resources.fuel)[0];
      if (source) {
        const got = extract(s, ctx, source, mult);
        log(s, 'good', `Held position at ${source.name} (x${mult.toFixed(1)}): ${describe(got)}.`);
      } else {
        log(s, 'info', 'Held position. Nothing here to gather.');
      }
      const rng = rngFor(s.runSeed, 'stay', s.turn, s.position);
      if (rng.chance(st.hazardChanceBase + st.hazardChancePerTurn * (s.stayStreak - 1))) {
        const dmg = rollDamage(rng, st.hazardDamage);
        damage(s, dmg, 'stay');
        log(s, 'bad', `Lingered too long: debris strike. Hull -${dmg}.`);
      }
      starHazardRoll(s, ctx, 'stay');
      if (!s.clocks.some((c) => c.kind === 'stay-yield' && c.starIndex === s.position)) {
        addClock(
          s,
          'stay-yield',
          'Deep survey (stay to finish)',
          st.clockTurns,
          { deltas: st.clockPayoff, log: 'Deep survey complete.' },
          { starIndex: s.position },
        );
      }
      advanceTurn(s, ctx);
      checkEnd(s, ctx);
      maybeEvent(s, ctx, {
        trigger: 'stay',
        firstVisit: false,
        landedWorldType: landed?.type ?? null,
      });
      break;
    }

    case 'repair': {
      const r = b.repair;
      if (s.ship.materials < r.materialsPerAction)
        throw new IllegalAction(action, 'not enough materials');
      if (s.ship.hull >= b.ship.max.hull) throw new IllegalAction(action, 'hull is intact');
      s.ship.materials = round(s.ship.materials - r.materialsPerAction, 2);
      applyDeltas(s, ctx.content, { hull: r.hullPerAction });
      s.stats.repairs += 1;
      log(s, 'good', `Repaired the hull. Hull +${r.hullPerAction}.`);
      advanceTurn(s, ctx);
      checkEnd(s, ctx);
      break;
    }

    case 'chooseEvent': {
      const pending = s.pendingEvent;
      if (!pending) throw new IllegalAction(action, 'no event pending');
      const ev = findEvent(ctx.content, pending.eventId);
      const option = ev.options.find((o) => o.id === action.optionId);
      if (!option) throw new IllegalAction(action, 'no such option');
      if (!canAfford(s, option)) throw new IllegalAction(action, 'cannot afford that option');
      for (const [k, v] of Object.entries(option.cost ?? {})) {
        const key = k as keyof typeof option.cost & keyof GameState['ship'];
        (s.ship[key] as number) = round((s.ship[key] as number) - (v ?? 0), 2);
      }
      s.pendingEvent = null;
      let outcome = option.success;
      if (option.chance !== undefined) {
        const rng = rngFor(s.runSeed, 'event', s.turn, ev.id, option.id);
        if (!rng.chance(option.chance) && option.failure) outcome = option.failure;
      }
      applyOutcome(s, ctx, outcome, ev.id);
      checkEnd(s, ctx);
      break;
    }
  }
  return s;
}
