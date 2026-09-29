import { jumpTargets } from '@transit/core';
import { useEffect, useMemo, useRef } from 'react';
import type { Session } from '../game/session';
import { useUi } from '../ui/ui';
import { SectorRenderer, type MapView as View } from './renderer';

export function MapView({ session }: { session: Session }) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<SectorRenderer | null>(null);
  const hovered = useUi((u) => u.hovered);
  const selected = useUi((u) => u.selected);
  const { state, ctx, route } = session;

  const reachable = useMemo(
    () => new Set(jumpTargets(state, ctx).map((t) => t.index)),
    [state, ctx],
  );

  const view: View = useMemo(
    () => ({
      revealed: new Set(state.revealed),
      visited: new Set(state.visited),
      reachable,
      route,
      position: state.position,
      frontX: state.frontX,
      jumpRangeLy: state.jumpRangeLy,
      sensorRangeLy: ctx.content.balance.sensors.rangeLy,
      selected,
      hovered,
      caches: new Set(Object.keys(state.caches).map(Number)),
    }),
    [state, ctx, reachable, route, selected, hovered],
  );

  // Latest values for the renderer's long-lived callbacks.
  const latest = useRef({ reachable, view });
  useEffect(() => {
    latest.current = { reachable, view };
  }, [reachable, view]);

  useEffect(() => {
    if (!host.current) return;
    const r = new SectorRenderer(host.current, {
      onHover: (i, at) => useUi.getState().setHover(i, at),
      onClick: (i) => {
        const ui = useUi.getState();
        if (i != null && latest.current.reachable.has(i)) ui.select(i);
        else if (i == null) ui.select(null);
      },
      onCamera: () => undefined,
    });
    let alive = true;
    void r.init().then(() => {
      if (!alive) return r.destroy();
      renderer.current = r;
      r.setSector(ctx.sector, ctx.content.balance);
      r.focus(latest.current.view.position);
      r.setView(latest.current.view);
    });
    return () => {
      alive = false;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [ctx.sector, ctx.content.balance]);

  useEffect(() => {
    renderer.current?.setView(view);
  }, [view]);

  useEffect(() => {
    renderer.current?.focus(state.position);
  }, [state.position]);

  return (
    <div className="map" ref={host}>
      <div className="map-help">
        drag rotate · wheel zoom · shift-drag pan · click a ringed star to plot a jump
      </div>
    </div>
  );
}
