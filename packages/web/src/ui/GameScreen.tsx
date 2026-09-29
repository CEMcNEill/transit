import {
  distanceBetween,
  frontDistance,
  goalDistance,
  hopsToGoal,
  landedWorld,
  legalActions,
  mineYield,
  nextUp,
  pendingEventView,
  starClass,
  starLabel,
  systemAt,
  type Action,
  type GameState,
  type SectorStar,
  type World,
} from '@transit/core';
import { useEffect, useMemo, useState } from 'react';
import { downloadJson } from '../game/persistence';
import { currentSave, dispatch, endSession, type Session } from '../game/session';
import { MapView } from '../map/MapView';
import { advise } from './advice';
import { orderedJumps, type NumberedJump } from './jumps';
import { compactIds, shortLabel } from './labels';
import { useUi } from './ui';

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (p: number) => `${Math.round(p * 100)}%`;
const TYPE_LABEL: Record<string, string> = {
  rocky: 'rocky',
  'super-earth': 'super-Earth',
  ocean: 'ocean',
  ice: 'ice',
  desert: 'desert',
  lava: 'lava',
  'gas-giant': 'gas giant',
  'ice-giant': 'ice giant',
  belt: 'asteroid belt',
};

function isLegal(legal: Action[], a: Action): boolean {
  return legal.some((l) => JSON.stringify(l) === JSON.stringify(a));
}

/** "Gaia …123 IV" -> "IV"; keeps real planet names like "Kepler-452 b". */
function worldShortName(w: World, star: SectorStar): string {
  const base = starLabel(star);
  return w.origin === 'procedural' && w.name.startsWith(base)
    ? w.name
        .slice(base.length)
        .replace(/ belt$/, '')
        .trim()
    : compactIds(w.name);
}

// ---------------------------------------------------------------- HUD

function Meter({
  label,
  value,
  max,
  warn,
  testId,
}: {
  label: string;
  value: number;
  max?: number;
  warn?: number;
  testId: string;
}) {
  const low = warn !== undefined && value <= warn;
  return (
    <div className={`meter${low ? ' low' : ''}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-value" data-testid={testId}>
        {fmt(value, value % 1 ? 1 : 0)}
        {max !== undefined && <span className="dim">/{max}</span>}
      </span>
      {max !== undefined && (
        <span className="meter-bar">
          <span style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
        </span>
      )}
    </div>
  );
}

function Hud({ session }: { session: Session }) {
  const { state, ctx } = session;
  const max = ctx.content.balance.ship.max;
  return (
    <header className="hud">
      <Meter label="Fuel" testId="hud-fuel" value={state.ship.fuel} max={max.fuel} warn={6} />
      <Meter
        label="Life support"
        testId="hud-life-support"
        value={state.ship.lifeSupport}
        max={max.lifeSupport}
        warn={6}
      />
      <Meter label="Hull" testId="hud-hull" value={state.ship.hull} max={max.hull} warn={30} />
      <Meter
        label="Materials"
        testId="hud-materials"
        value={state.ship.materials}
        max={max.materials}
      />
      <Meter label="Data" testId="hud-data" value={state.ship.data} />
      <div className="meter">
        <span className="meter-label">Turn</span>
        <span className="meter-value" data-testid="turn">
          {state.turn}
        </span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- corridor strip

/** The whole crossing on one line: start, you, the front, the goal. */
function CorridorStrip({ session }: { session: Session }) {
  const { state, ctx } = session;
  const stars = ctx.sector.stars;
  const xs = stars.map((s) => s.pos[0]);
  const min = Math.min(...xs, state.frontX);
  const max = Math.max(...xs);
  const at = (x: number) => `${((x - min) / (max - min)) * 100}%`;
  const shipX = stars[state.position]?.pos[0] ?? 0;
  const goalX = stars[ctx.sector.goal.starIndex]?.pos[0] ?? max;
  const startX = stars[ctx.sector.start.starIndex]?.pos[0] ?? min;
  const front = frontDistance(state, ctx);
  const goalLy = goalDistance(ctx, state.position);
  const hops = hopsToGoal(ctx.sector, state.jumpRangeLy)[state.position] ?? -1;
  const goal = stars[ctx.sector.goal.starIndex] as SectorStar;
  const warnFront = front < ctx.content.balance.front.warnDistanceLy;
  return (
    <div className="corridor" aria-label="Progress through the corridor">
      <div className="corridor-track">
        <div className="corridor-behind" style={{ width: at(state.frontX) }} />
        <div
          className="corridor-done"
          style={{ left: at(startX), width: `calc(${at(shipX)} - ${at(startX)})` }}
        />
        <span
          className="corridor-mark front"
          style={{ left: at(state.frontX) }}
          title="The front"
        />
        <span className="corridor-mark ship" style={{ left: at(shipX) }} title="You">
          △
        </span>
        <span className="corridor-mark goal" style={{ left: at(goalX) }} title={starLabel(goal)}>
          ◇
        </span>
      </div>
      <div className="corridor-text">
        <span className={warnFront ? 'warn' : 'dim'}>
          front {front < 0 ? 'is on you' : `${fmt(front)} ly behind`}
        </span>
        <span>
          goal <span className="goal-name">{shortLabel(goal)}</span> · {fmt(goalLy)} ly
          {hops >= 0 && ` · at least ${hops} jumps`}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- star card

function StarCard({ session }: { session: Session }) {
  const hovered = useUi((u) => u.hovered);
  const at = useUi((u) => u.hoverAt);
  if (hovered == null || !at) return null;
  const { state, ctx } = session;
  const star = ctx.sector.stars[hovered];
  if (!star) return null;
  const revealed = state.revealed.includes(hovered);
  const cls = starClass(star, ctx.content.balance);
  const sys = systemAt(state, hovered);
  const fromHere = distanceBetween(ctx.sector, state.position, hovered);
  const confirmed = ctx.sector.planets.filter(
    (p) => p.starIndex === hovered && p.disposition === 'CONFIRMED',
  );
  const real = star.flags.host || confirmed.length > 0 || star.flags.landmark;
  return (
    <div className="star-card" style={{ left: at.x + 16, top: at.y + 12 }}>
      <div className="star-card-title">
        {starLabel(star)} {real && <span className="badge real">Real data</span>}
      </div>
      {star.name && <div className="dim">{star.id}</div>}
      <div>
        {revealed ? `Class ${cls}` : 'Beyond sensor range'}
        {star.teff != null && revealed && ` · ${fmt(star.teff)} K`}
        {sys && ` · ${sys.worlds.length} worlds`}
      </div>
      <div>{fmt(fromHere, 1)} ly from here</div>
      {star.distLy != null && (
        <div className="dim">
          {fmt(star.distLy)} ly from Sol: the light Earth sees left it {fmt(star.distLy)} years ago.
        </div>
      )}
      {confirmed.length > 0 && (
        <div className="real-list">
          Confirmed planets: {confirmed.map((p) => p.name ?? p.koi).join(', ')}
        </div>
      )}
      {star.flags.koi && confirmed.length === 0 && (
        <div className="real-list">Kepler planet candidate host</div>
      )}
      {star.flags.keplerTarget && !star.flags.koi && (
        <div className="dim">Watched by Kepler, 2009–2013</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- side panel

function AdviceBar({ session, jumps }: { session: Session; jumps: NumberedJump[] }) {
  const a = advise(session.state, session.ctx, jumps);
  return (
    <div className={`advice advice-${a.tone}`} data-testid="advice">
      {a.text}
    </div>
  );
}

function JumpPanel({
  session,
  legal,
  jumps,
}: {
  session: Session;
  legal: Action[];
  jumps: NumberedJump[];
}) {
  const { ctx } = session;
  const selected = useUi((u) => u.selected);
  const select = useUi((u) => u.select);
  const preview = jumps.find((j) => j.target === selected) ?? null;
  return (
    <section className="panel jumps">
      <h2>Jump</h2>
      <ul className="targets" data-testid="jump-targets">
        {jumps.map((j) => {
          const star = ctx.sector.stars[j.target] as SectorStar;
          return (
            <li key={j.target}>
              <button
                className={`target${selected === j.target ? ' selected' : ''}`}
                onClick={() => select(selected === j.target ? null : j.target)}
                disabled={!j.affordable}
                title={starLabel(star)}
              >
                <span className="target-n">{j.n <= 9 ? j.n : ''}</span>
                <span className="toward">{j.toward ? '▲' : ''}</span>
                <span className="target-name">
                  {shortLabel(star)}
                  {star.flags.host && <span className="badge real">host</span>}
                </span>
                <span className="target-cost">
                  {fmt(j.distanceLy, 1)} ly · <b>{fmt(j.fuel, 1)}</b> fuel
                  {j.hazard.kind !== 'none' && <span className="warn"> · {j.hazard.kind}</span>}
                </span>
              </button>
              {preview?.target === j.target && (
                <div className="preview" data-testid="jump-preview">
                  <div>
                    Costs {fmt(preview.fuel, 1)} fuel and {fmt(preview.lifeSupport, 1)} life
                    support.
                  </div>
                  <div className="small">
                    {preview.progressLy >= 0
                      ? `${fmt(preview.progressLy, 1)} ly closer to the goal`
                      : `${fmt(-preview.progressLy, 1)} ly farther from the goal`}
                    {preview.visited && ' · visited before'}
                  </div>
                  <div className="small">
                    Known hazards:{' '}
                    {preview.hazard.kind === 'none' ? (
                      <span className="dim">none</span>
                    ) : (
                      <span className="warn">
                        {preview.hazard.kind === 'flare' ? 'flaring star' : 'radiation'}{' '}
                        {pct(preview.hazard.chance)} per turn spent there
                      </span>
                    )}
                    {preview.behindFront && (
                      <span className="warn"> · the front will be on it</span>
                    )}
                  </div>
                  <div className="preview-actions">
                    <button
                      className="primary"
                      data-testid="confirm-jump"
                      disabled={!isLegal(legal, { type: 'jump', target: preview.target })}
                      onClick={() => {
                        dispatch({ type: 'jump', target: preview.target });
                        select(null);
                      }}
                    >
                      {preview.affordable ? 'Jump ⏎' : 'Not enough fuel'}
                    </button>
                    <button onClick={() => select(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {jumps.length === 0 && <li className="warn small">No stars within jump range.</li>}
      </ul>
      <div className="dim small hint">Keys 1–9 pick a jump, Enter jumps, Esc cancels.</div>
    </section>
  );
}

function ResourceChips({ w }: { w: World }) {
  if (!w.surveyed) return <span className="dim">unsurveyed</span>;
  const chips = [
    ['fuel', w.resources.fuel],
    ['materials', w.resources.materials],
    ['life support', w.resources.lifeSupport],
  ] as const;
  const shown = chips.filter(([, v]) => v > 0);
  if (shown.length === 0) return <span className="dim">nothing useful</span>;
  return (
    <>
      {shown.map(([k, v]) => (
        <span key={k} className={`chip chip-${k.replace(' ', '-')}`}>
          {v} {k}
        </span>
      ))}
    </>
  );
}

function WorldRow({
  w,
  star,
  state,
  session,
  legal,
}: {
  w: World;
  star: SectorStar;
  state: GameState;
  session: Session;
  legal: Action[];
}) {
  const b = session.ctx.content.balance;
  const landedHere = state.landedOn === w.id;
  const risk = w.landingRisk + (w.surveyed ? 0 : b.landing.unsurveyedRiskBonus);
  const y = mineYield(state, session.ctx, w);
  const canMineNow = isLegal(legal, { type: 'mine', worldId: w.id });
  const gain = [
    y.fuel && `${y.fuel} fuel`,
    y.materials && `${y.materials} mat`,
    y.lifeSupport && `${y.lifeSupport} LS`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li className={`world${landedHere ? ' landed' : ''}`}>
      <div className="world-line">
        <span className="world-name" title={compactIds(w.name)}>
          {worldShortName(w, star)}
        </span>
        <span className="world-type">{TYPE_LABEL[w.type]}</span>
        {w.temperate && <span className="badge temperate">temperate</span>}
        {w.origin !== 'procedural' && (
          <span className="badge real">{w.origin === 'confirmed' ? 'Kepler' : 'KOI'}</span>
        )}
        <span className="world-actions">
          {!w.surveyed && (
            <button
              onClick={() => dispatch({ type: 'survey', worldId: w.id })}
              title="Free, no turn"
            >
              Survey
            </button>
          )}
          {w.landable && !landedHere && (
            <button
              disabled={!isLegal(legal, { type: 'land', worldId: w.id })}
              onClick={() => dispatch({ type: 'land', worldId: w.id })}
              title={`${b.lifeSupport.perLanding} life support, takes a turn, ${pct(risk)} risk of hull damage`}
            >
              Land <span className={risk > 0.2 ? 'warn' : 'dim'}>{pct(risk)}</span>
            </button>
          )}
          {(landedHere || !w.landable) && (canMineNow || w.surveyed) && (
            <button
              disabled={!canMineNow}
              onClick={() => dispatch({ type: 'mine', worldId: w.id })}
              title="Takes a turn"
            >
              {w.landable ? 'Mine' : 'Skim'}
              {canMineNow && gain && <span className="good"> +{gain}</span>}
            </button>
          )}
        </span>
      </div>
      <div className="world-detail">
        <ResourceChips w={w} />
        <span className="dim">
          {' '}
          · {fmt(w.smaAu, w.smaAu < 1 ? 2 : 1)} AU · {fmt(w.teqK)} K
          {w.radiusEarth > 0 && ` · ${fmt(w.radiusEarth, 1)} R⊕`}
        </span>
      </div>
    </li>
  );
}

function SystemPanel({ session, legal }: { session: Session; legal: Action[] }) {
  const { state, ctx } = session;
  const star = ctx.sector.stars[state.position] as SectorStar;
  const sys = systemAt(state, state.position);
  const b = ctx.content.balance;
  const landed = landedWorld(state);
  const nextHazard = b.stay.hazardChanceBase + b.stay.hazardChancePerTurn * state.stayStreak;
  return (
    <section className="panel system">
      <h2 title={star.id}>
        Here: {shortLabel(star)}
        {(star.flags.host || star.flags.landmark) && <span className="badge real">Real data</span>}
      </h2>
      {sys && (
        <div className="dim small">
          Class {sys.starClass} star · {fmt(sys.teffK)} K
          {sys.hazard.kind !== 'none' && (
            <span className="warn">
              {' '}
              · {sys.hazard.kind === 'flare' ? 'flares' : 'radiation'}: {pct(sys.hazard.chance)} per
              turn here
            </span>
          )}
        </div>
      )}
      {sys?.koiResolutions.map((r) => (
        <div key={r.koi} className="small real-list">
          {r.koi} was{' '}
          {r.result === 'eclipsingBinary' ? 'an eclipsing binary' : 'an instrument artifact'}, not a
          planet.
        </div>
      ))}
      <ul className="worlds">
        {sys?.worlds.map((w) => (
          <WorldRow key={w.id} w={w} star={star} state={state} session={session} legal={legal} />
        ))}
        {sys && sys.worlds.length === 0 && <li className="dim">No worlds. A bare star.</li>}
      </ul>
      {landed && <div className="small">Landed on {worldShortName(landed, star)}.</div>}
      <div className="system-actions">
        <button
          onClick={() => dispatch({ type: 'stay' })}
          disabled={!isLegal(legal, { type: 'stay' })}
          title="Spend a turn here. The yield grows each turn you stay, and so does the risk."
        >
          Stay a turn{state.stayStreak > 0 && ` (×${state.stayStreak + 1})`}{' '}
          <span className="dim">risk {pct(nextHazard)}</span>
        </button>
        <button
          onClick={() => dispatch({ type: 'repair' })}
          disabled={!isLegal(legal, { type: 'repair' })}
          title={`Spend ${b.repair.materialsPerAction} materials and a turn for +${b.repair.hullPerAction} hull`}
        >
          Repair{' '}
          <span className="dim">
            {b.repair.materialsPerAction} mat → +{b.repair.hullPerAction} hull
          </span>
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- bottom

function Ticker({ session }: { session: Session }) {
  const items = nextUp(session.state, session.ctx.sector, session.ctx.content);
  return (
    <section className="ticker" aria-label="Next up">
      <span className="ticker-label">Next up</span>
      {items.map((it, i) => (
        <span key={i} className={`tick ${it.kind === 'front' ? 'tick-front' : ''}`}>
          <span className="tick-turns">
            {it.turns === 0 ? 'now' : `in ${it.turns} turn${it.turns === 1 ? '' : 's'}`}
          </span>{' '}
          {compactIds(it.label)}
          {it.detail && <span className="dim"> · {it.detail}</span>}
        </span>
      ))}
    </section>
  );
}

function Log({ state }: { state: GameState }) {
  const entries = state.log.slice(-8).reverse();
  return (
    <section className="log" aria-label="Log">
      {entries.map((e, i) => (
        <div key={state.log.length - i} className={`log-${e.kind}`}>
          <span className="dim">t{e.turn}</span>{' '}
          {e.kind === 'real' && <span className="badge real">real</span>} {compactIds(e.text)}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- dialogs

function EventDialog({ session }: { session: Session }) {
  const view = pendingEventView(session.state, session.ctx);
  if (!view) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-labelledby="event-title" data-testid="event-dialog">
        <h2 id="event-title">{view.title}</h2>
        <p>{view.text}</p>
        <div className="options">
          {view.options.map((o) => (
            <button
              key={o.id}
              disabled={!o.affordable}
              onClick={() => dispatch({ type: 'chooseEvent', optionId: o.id })}
            >
              <span>{o.label}</span>
              <span className="dim small">
                {o.cost &&
                  Object.entries(o.cost)
                    .map(([k, v]) => `−${v} ${k === 'lifeSupport' ? 'life support' : k}`)
                    .join(', ')}
                {o.chance != null && ` · ${pct(o.chance)} chance`}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EndScreen({ session }: { session: Session }) {
  const { state, ctx } = session;
  if (state.status.kind === 'active') return null;
  const won = state.status.kind === 'won';
  const goal = ctx.sector.stars[ctx.sector.goal.starIndex] as SectorStar;
  const hops = hopsToGoal(ctx.sector, state.jumpRangeLy)[state.position] ?? -1;
  const nearestClock = [...state.clocks].sort((a, b) => a.turnsRemaining - b.turnsRemaining)[0];
  const cause =
    state.status.kind === 'lost'
      ? {
          hull: `Hull failure (${state.status.detail.replace(/-/g, ' ')})`,
          lifeSupport: 'Life support exhausted',
          stranded: 'Stranded without fuel',
        }[state.status.cause]
      : `Arrived at ${starLabel(goal)}`;
  return (
    <div className="modal-backdrop">
      <div className="modal end" data-testid="end-screen">
        <h2>{won ? 'Crossing complete' : 'Run over'}</h2>
        <p className={won ? 'good' : 'warn'}>{cause}</p>
        <dl className="stats">
          <dt>Turns</dt>
          <dd>{state.turn}</dd>
          <dt>Jumps</dt>
          <dd>{state.stats.jumps}</dd>
          <dt>Distance travelled</dt>
          <dd>{fmt(state.stats.lyTraveled)} ly</dd>
          <dt>Systems visited</dt>
          <dd>{state.visited.length}</dd>
          <dt>Data gathered</dt>
          <dd>{fmt(state.ship.data)}</dd>
          <dt>Kepler candidates resolved</dt>
          <dd>
            {state.stats.koisResolved} ({state.stats.koisConfirmed} real planets)
          </dd>
          {state.firsts.length > 0 && (
            <>
              <dt>Firsts</dt>
              <dd>{state.firsts.map((f) => f.replace(/-/g, ' ')).join(', ')}</dd>
            </>
          )}
        </dl>
        {!won && (
          <p className="almost">
            What you almost did:{' '}
            {hops >= 0 &&
              `${fmt(goalDistance(ctx, state.position))} ly (${hops} jumps) from ${starLabel(goal)}`}
            {nearestClock &&
              `; ${compactIds(nearestClock.label)} was ${nearestClock.turnsRemaining} turn${nearestClock.turnsRemaining === 1 ? '' : 's'} from paying off`}
            .
          </p>
        )}
        <div className="preview-actions">
          <button className="primary" onClick={() => void endSession()}>
            New run
          </button>
          <button onClick={() => downloadJson(`transit-run-${state.runSeed}.json`, currentSave())}>
            Export run
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screen

export function GameScreen({ session }: { session: Session }) {
  const { state, ctx } = session;
  const legal = useMemo(() => legalActions(state, ctx), [state, ctx]);
  const jumps = useMemo(() => orderedJumps(state, ctx), [state, ctx]);
  const [menu, setMenu] = useState(false);
  const select = useUi((u) => u.select);
  useEffect(() => select(null), [state.position, select]);

  // Keyboard: 1–9 pick a numbered jump, Enter jumps, Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.pendingEvent || state.status.kind !== 'active') return;
      if (e.target instanceof HTMLInputElement) return;
      const ui = useUi.getState();
      if (/^[1-9]$/.test(e.key)) {
        const j = jumps[Number(e.key) - 1];
        if (j) ui.select(j.target);
      } else if (e.key === 'Enter' && ui.selected != null) {
        const a: Action = { type: 'jump', target: ui.selected };
        if (isLegal(legal, a)) {
          dispatch(a);
          ui.select(null);
        }
      } else if (e.key === 'Escape') {
        ui.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jumps, legal, state.pendingEvent, state.status.kind]);

  return (
    <div className="game">
      <Hud session={session} />
      <div className="game-body">
        <div className="map-wrap">
          <MapView session={session} />
          <CorridorStrip session={session} />
          <StarCard session={session} />
          <div className="map-menu">
            <button className="link" onClick={() => setMenu(!menu)}>
              menu
            </button>
            {menu && (
              <span className="menu">
                <button
                  onClick={() => downloadJson(`transit-save-${state.runSeed}.json`, currentSave())}
                >
                  Export save
                </button>
                <button
                  onClick={() => {
                    if (confirm('Abandon this run?')) void endSession();
                  }}
                >
                  Abandon run
                </button>
              </span>
            )}
          </div>
        </div>
        <aside className="side">
          <AdviceBar session={session} jumps={jumps} />
          <JumpPanel session={session} legal={legal} jumps={jumps} />
          <SystemPanel session={session} legal={legal} />
        </aside>
      </div>
      <footer className="bottom">
        <Ticker session={session} />
        <Log state={state} />
      </footer>
      <EventDialog session={session} />
      <EndScreen session={session} />
    </div>
  );
}
