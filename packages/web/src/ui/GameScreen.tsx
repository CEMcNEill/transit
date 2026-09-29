import {
  distanceBetween,
  frontDistance,
  goalDistance,
  hopsToGoal,
  jumpPreview,
  jumpTargets,
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
import { dispatch, endSession, currentSave, type Session } from '../game/session';
import { downloadJson } from '../game/persistence';
import { MapView } from '../map/MapView';
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

// ---------------------------------------------------------------- HUD

function Meter({
  label,
  value,
  max,
  warn,
}: {
  label: string;
  value: number;
  max?: number;
  warn?: number;
}) {
  const low = warn !== undefined && value <= warn;
  return (
    <div className={`meter${low ? ' low' : ''}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-value" data-testid={`hud-${label.toLowerCase().replace(/\s/g, '-')}`}>
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
  const front = frontDistance(state, ctx);
  const goal = goalDistance(ctx, state.position);
  const hops = hopsToGoal(ctx.sector, state.jumpRangeLy)[state.position] ?? -1;
  return (
    <header className="hud">
      <Meter label="Fuel" value={state.ship.fuel} max={max.fuel} warn={6} />
      <Meter label="Life support" value={state.ship.lifeSupport} max={max.lifeSupport} warn={6} />
      <Meter label="Hull" value={state.ship.hull} max={max.hull} warn={30} />
      <Meter label="Materials" value={state.ship.materials} max={max.materials} />
      <Meter label="Data" value={state.ship.data} />
      <div className="meter">
        <span className="meter-label">Turn</span>
        <span className="meter-value" data-testid="turn">
          {state.turn}
        </span>
      </div>
      <div className={`meter${front < ctx.content.balance.front.warnDistanceLy ? ' low' : ''}`}>
        <span className="meter-label">Front</span>
        <span className="meter-value">{front < 0 ? 'on you' : `${fmt(front)} ly`}</span>
      </div>
      <div className="meter">
        <span className="meter-label">Goal</span>
        <span className="meter-value">
          {fmt(goal)} ly{hops >= 0 && <span className="dim"> · ≥{hops} jumps</span>}
        </span>
      </div>
    </header>
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
        {revealed ? `Class ${cls}` : 'Unresolved'}
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
          Confirmed: {confirmed.map((p) => p.name ?? p.koi).join(', ')}
        </div>
      )}
      {star.flags.koi && confirmed.length === 0 && (
        <div className="real-list">Kepler candidate host</div>
      )}
      {star.flags.keplerTarget && !star.flags.koi && (
        <div className="dim">Watched by Kepler, 2009–2013</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- right panel

function WorldRow({
  w,
  state,
  session,
  legal,
}: {
  w: World;
  state: GameState;
  session: Session;
  legal: Action[];
}) {
  const b = session.ctx.content.balance;
  const landedHere = state.landedOn === w.id;
  const risk = w.landingRisk + (w.surveyed ? 0 : b.landing.unsurveyedRiskBonus);
  const y = mineYield(state, session.ctx, w);
  const canMineNow = isLegal(legal, { type: 'mine', worldId: w.id });
  return (
    <li className={`world${landedHere ? ' landed' : ''}`}>
      <div className="world-head">
        <span className="world-name">{compactIds(w.name)}</span>
        {w.origin !== 'procedural' && (
          <span className="badge real">
            {w.origin === 'confirmed' ? 'Kepler confirmed' : 'Kepler candidate'}
          </span>
        )}
      </div>
      <div className="dim small">
        {TYPE_LABEL[w.type]} · {fmt(w.smaAu, w.smaAu < 1 ? 2 : 1)} AU · {fmt(w.teqK)} K
        {w.radiusEarth > 0 && ` · ${fmt(w.radiusEarth, 1)} R⊕`}
        {w.transiting === false && ' · non-transiting'}
      </div>
      <div className="small">
        {w.surveyed ? (
          <>
            fuel {w.resources.fuel} · materials {w.resources.materials} · life support{' '}
            {w.resources.lifeSupport}
          </>
        ) : (
          <span className="dim">resources unknown, survey to reveal</span>
        )}
        {w.landable && (
          <span className={risk > 0.2 ? 'warn' : 'dim'}> · landing risk {pct(risk)}</span>
        )}
      </div>
      <div className="world-actions">
        {!w.surveyed && (
          <button onClick={() => dispatch({ type: 'survey', worldId: w.id })}>Survey</button>
        )}
        {w.landable && !landedHere && (
          <button
            disabled={!isLegal(legal, { type: 'land', worldId: w.id })}
            onClick={() => dispatch({ type: 'land', worldId: w.id })}
            title={`${b.lifeSupport.perLanding} life support, takes a turn`}
          >
            Land
          </button>
        )}
        {(landedHere || !w.landable) && (
          <button
            disabled={!canMineNow}
            onClick={() => dispatch({ type: 'mine', worldId: w.id })}
            title="Takes a turn"
          >
            {w.landable ? 'Mine' : 'Skim'}
            {canMineNow &&
              ` +${[y.fuel && `${y.fuel}f`, y.materials && `${y.materials}m`, y.lifeSupport && `${y.lifeSupport}ls`].filter(Boolean).join(' ')}`}
          </button>
        )}
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
        {shortLabel(star)}
        {(star.flags.host || star.flags.landmark) && <span className="badge real">Real data</span>}
      </h2>
      {sys && (
        <div className="dim small">
          Class {sys.starClass} · {fmt(sys.teffK)} K ·{' '}
          {fmt(sys.luminositySun, sys.luminositySun < 1 ? 3 : 1)} L☉
          {sys.hazard.kind !== 'none' && (
            <span className="warn">
              {' '}
              · {sys.hazard.kind} risk {pct(sys.hazard.chance)}
            </span>
          )}
        </div>
      )}
      {sys?.koiResolutions.map((r) => (
        <div key={r.koi} className="small real-list">
          {r.koi}: {r.result === 'eclipsingBinary' ? 'eclipsing binary' : 'instrument artifact'},
          not a planet
        </div>
      ))}
      <ul className="worlds">
        {sys?.worlds.map((w) => (
          <WorldRow key={w.id} w={w} state={state} session={session} legal={legal} />
        ))}
        {sys && sys.worlds.length === 0 && <li className="dim">No worlds. A bare star.</li>}
      </ul>
      <div className="system-actions">
        <button
          onClick={() => dispatch({ type: 'stay' })}
          disabled={!isLegal(legal, { type: 'stay' })}
          title="Work the system another turn: yield grows each turn you stay, and so does the risk."
        >
          Stay{state.stayStreak > 0 && ` ×${state.stayStreak + 1}`}{' '}
          <span className="dim">risk {pct(nextHazard)}</span>
        </button>
        <button
          onClick={() => dispatch({ type: 'repair' })}
          disabled={!isLegal(legal, { type: 'repair' })}
          title={`${b.repair.materialsPerAction} materials → +${b.repair.hullPerAction} hull, takes a turn`}
        >
          Repair <span className="dim">−{b.repair.materialsPerAction}m</span>
        </button>
      </div>
      {landed && <div className="small dim">Landed on {compactIds(landed.name)}.</div>}
    </section>
  );
}

function JumpPanel({ session, legal }: { session: Session; legal: Action[] }) {
  const { state, ctx } = session;
  const selected = useUi((u) => u.selected);
  const select = useUi((u) => u.select);
  const hops = hopsToGoal(ctx.sector, state.jumpRangeLy);
  const here = hops[state.position] ?? -1;
  const targets = useMemo(
    () =>
      jumpTargets(state, ctx)
        .map((t) => jumpPreview(state, ctx, t.index))
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .sort((a, b) => b.progressLy - a.progressLy),
    [state, ctx],
  );
  const preview = selected != null ? jumpPreview(state, ctx, selected) : null;
  return (
    <section className="panel jumps">
      <h2>Jump plotting</h2>
      {preview ? (
        <div className="preview" data-testid="jump-preview">
          <div className="preview-title">
            {starLabel(ctx.sector.stars[preview.target] as SectorStar)}
          </div>
          <div>
            {fmt(preview.distanceLy, 1)} ly · fuel {fmt(preview.fuel, 1)} · life support{' '}
            {fmt(preview.lifeSupport, 1)}
          </div>
          <div className="small">
            {preview.progressLy >= 0
              ? `${fmt(preview.progressLy, 1)} ly closer to goal`
              : `${fmt(-preview.progressLy, 1)} ly farther from goal`}
            {preview.visited && ' · visited'}
          </div>
          <div className="small">
            Known hazards:{' '}
            {preview.hazard.kind === 'none' ? (
              <span className="dim">none</span>
            ) : (
              <span className="warn">
                {preview.hazard.kind} {pct(preview.hazard.chance)}
              </span>
            )}
            {preview.behindFront && <span className="warn"> · the front will be on it</span>}
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
              {preview.affordable ? 'Confirm jump' : 'Not enough fuel'}
            </button>
            <button onClick={() => select(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="dim small">Click a ringed star on the map, or pick one below.</div>
      )}
      <ul className="targets" data-testid="jump-targets">
        {targets.map((t) => {
          const star = ctx.sector.stars[t.target] as SectorStar;
          const h = hops[t.target] ?? -1;
          return (
            <li key={t.target}>
              <button
                className={`target${selected === t.target ? ' selected' : ''}`}
                onClick={() => select(t.target)}
                disabled={!t.affordable}
              >
                <span className="target-name">
                  <span className="toward">{here >= 0 && h >= 0 && h < here ? '▲' : ' '}</span>
                  {shortLabel(star)}
                  {star.flags.host && <span className="badge real">host</span>}
                </span>
                <span className="dim">
                  {fmt(t.distanceLy, 1)} ly · {fmt(t.fuel, 1)} fuel
                </span>
              </button>
            </li>
          );
        })}
        {targets.length === 0 && <li className="warn small">No stars within jump range.</li>}
      </ul>
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
          <span className="tick-turns">{it.turns === 0 ? 'now' : `${it.turns}t`}</span>{' '}
          {compactIds(it.label)}
          {it.detail && <span className="dim"> · {it.detail}</span>}
        </span>
      ))}
    </section>
  );
}

function Log({ state }: { state: GameState }) {
  const entries = state.log.slice(-14).reverse();
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
              `; ${nearestClock.label} was ${nearestClock.turnsRemaining} turn${nearestClock.turnsRemaining === 1 ? '' : 's'} from paying off`}
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
  const [menu, setMenu] = useState(false);
  const select = useUi((u) => u.select);
  useEffect(() => select(null), [state.position, select]);
  const goal = ctx.sector.stars[ctx.sector.goal.starIndex] as SectorStar;
  return (
    <div className="game">
      <Hud session={session} />
      <div className="game-body">
        <div className="map-wrap">
          <MapView session={session} />
          <StarCard session={session} />
          <div className="map-title">
            {ctx.sector.id} ·{' '}
            {shortLabel(ctx.sector.stars[ctx.sector.start.starIndex] as SectorStar)} →{' '}
            {shortLabel(goal)} · {fmt(ctx.sector.sunDistanceLy)} ly from Sol
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
          <SystemPanel session={session} legal={legal} />
          <JumpPanel session={session} legal={legal} />
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
