// Sector map: an orthographic view of the corridor's real 3D star positions.
// Drag to rotate, wheel to zoom, shift-drag (or right-drag) to pan. Redraws on demand only.

import { starClass, type Balance, type Sector, type StarClass } from '@transit/core';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { shortLabel } from '../ui/labels';
import { palette } from '../ui/palette';

export interface MapView {
  revealed: ReadonlySet<number>;
  visited: ReadonlySet<number>;
  reachable: ReadonlySet<number>;
  route: readonly number[];
  position: number;
  frontX: number;
  jumpRangeLy: number;
  sensorRangeLy: number;
  selected: number | null;
  hovered: number | null;
  caches: ReadonlySet<number>;
}

export interface Camera {
  yaw: number;
  pitch: number;
  /** Pixels per light-year. */
  zoom: number;
  /** Light-year offset of the view center in the sector frame (x, y). */
  panX: number;
  panY: number;
}

export interface RendererEvents {
  onHover(index: number | null, screen: { x: number; y: number } | null): void;
  onClick(index: number | null): void;
  onCamera(c: Camera): void;
}

const CLASS_COLOR: Record<StarClass, number> = {
  O: 0x9fb8e8,
  B: 0xa9c1e6,
  A: 0xbfd2e4,
  F: 0xdfe3d6,
  G: 0xe0d6a0,
  K: 0xd6ad6a,
  M: 0xc98a62,
};

function glowTexture(): Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

interface Projected {
  x: number;
  y: number;
  depth: number;
}

export class SectorRenderer {
  private app = new Application();
  private ready = false;
  private sector: Sector | null = null;
  private colors: number[] = [];
  private view: MapView | null = null;
  private cam: Camera = { yaw: -0.6, pitch: 1.0, zoom: 5, panX: 0, panY: 0 };
  private proj: Projected[] = [];
  private planeG = new Graphics();
  private dropG = new Graphics();
  private overlayG = new Graphics();
  private starLayer = new Container();
  private labelLayer = new Container();
  private sprites: Sprite[] = [];
  private labels = new Map<string, Text>();
  private dirty = true;
  private events: RendererEvents;
  private dragging: { x: number; y: number; pan: boolean; moved: boolean } | null = null;
  private host: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement, events: RendererEvents) {
    this.host = host;
    this.events = events;
  }

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      background: palette.bg,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    this.host.appendChild(this.app.canvas);
    this.app.canvas.setAttribute('data-testid', 'sector-map');
    this.app.stage.addChild(
      this.planeG,
      this.dropG,
      this.starLayer,
      this.overlayG,
      this.labelLayer,
    );
    this.app.ticker.add(() => {
      if (this.dirty) this.draw();
    });
    const c = this.app.canvas;
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(this.host);
    this.ready = true;
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.resizeObserver?.disconnect();
    if (this.ready) this.app.destroy(true, { children: true, texture: true });
  }

  setSector(sector: Sector, balance: Balance): void {
    this.sector = sector;
    this.colors = sector.stars.map((s) => CLASS_COLOR[starClass(s, balance)]);
    this.starLayer.removeChildren();
    const tex = glowTexture();
    this.sprites = sector.stars.map(() => {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      this.starLayer.addChild(sp);
      return sp;
    });
    this.invalidate();
  }

  setView(view: MapView): void {
    this.view = view;
    this.invalidate();
  }

  getCamera(): Camera {
    return { ...this.cam };
  }

  setCamera(c: Partial<Camera>): void {
    this.cam = { ...this.cam, ...c };
    this.invalidate();
  }

  /** Center the view on a star (sector-frame x/y). */
  focus(index: number): void {
    const p = this.sector?.stars[index]?.pos;
    if (p) this.setCamera({ panX: p[0], panY: p[1] });
  }

  invalidate(): void {
    this.dirty = true;
  }

  // ---------------------------------------------------------------- projection

  private project(x: number, y: number, z: number): Projected {
    const { yaw, pitch, zoom, panX, panY } = this.cam;
    const dx = x - panX;
    const dy = y - panY;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x1 = dx * cy - dy * sy;
    const y1 = dx * sy + dy * cy;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const y2 = y1 * cp - z * sp;
    const z2 = y1 * sp + z * cp;
    return {
      x: this.app.screen.width / 2 + zoom * x1,
      y: this.app.screen.height / 2 - zoom * z2,
      depth: y2,
    };
  }

  // ---------------------------------------------------------------- drawing

  private label(key: string, text: string, x: number, y: number, color: number, alpha = 1): void {
    let t = this.labels.get(key);
    if (!t) {
      t = new Text({
        text,
        style: {
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: 11,
          fill: color,
          letterSpacing: 1,
        },
      });
      this.labels.set(key, t);
      this.labelLayer.addChild(t);
    }
    t.text = text;
    t.style.fill = color;
    t.position.set(Math.round(x), Math.round(y));
    t.alpha = alpha;
    t.visible = true;
  }

  private draw(): void {
    this.dirty = false;
    const sector = this.sector;
    const view = this.view;
    if (!sector || !view) return;
    for (const t of this.labels.values()) t.visible = false;
    const stars = sector.stars;
    this.proj = stars.map((s) => this.project(s.pos[0], s.pos[1], s.pos[2]));
    const radius = Math.max(...stars.map((s) => Math.hypot(s.pos[1], s.pos[2])));
    const xs = stars.map((s) => s.pos[0]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);

    // Reference plane (z = 0): a faint grid along the corridor.
    const plane = this.planeG;
    plane.clear();
    const step = 20;
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      const a = this.project(x, -radius, 0);
      const b = this.project(x, radius, 0);
      plane.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    for (let y = -Math.floor(radius / step) * step; y <= radius; y += step) {
      const a = this.project(xMin, y, 0);
      const b = this.project(xMax, y, 0);
      plane.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    plane.stroke({ width: 1, color: palette.grid, alpha: 0.5 });

    // Drop lines from each revealed star to the plane, for depth.
    const drop = this.dropG;
    drop.clear();
    stars.forEach((s, i) => {
      if (!view.revealed.has(i)) return;
      const p = this.proj[i] as Projected;
      const q = this.project(s.pos[0], s.pos[1], 0);
      drop.moveTo(p.x, p.y).lineTo(q.x, q.y);
    });
    drop.stroke({ width: 1, color: palette.dropLine, alpha: 0.35 });
    stars.forEach((s, i) => {
      if (!view.revealed.has(i)) return;
      const q = this.project(s.pos[0], s.pos[1], 0);
      drop.circle(q.x, q.y, 1);
    });
    drop.fill({ color: palette.dropLine, alpha: 0.5 });

    // Stars.
    const zoomScale = Math.min(1.6, Math.max(0.6, this.cam.zoom / 3));
    stars.forEach((s, i) => {
      const sp = this.sprites[i] as Sprite;
      const p = this.proj[i] as Projected;
      sp.position.set(p.x, p.y);
      const revealed = view.revealed.has(i);
      const bright = s.gmag != null ? Math.max(0.35, Math.min(1, (20 - s.gmag) / 8)) : 0.5;
      if (revealed) {
        sp.tint = this.colors[i] as number;
        sp.alpha = 0.55 + 0.45 * bright;
        sp.scale.set((0.18 + 0.2 * bright) * zoomScale);
      } else {
        sp.tint = palette.unrevealed;
        sp.alpha = 0.35;
        sp.scale.set(0.1 * zoomScale);
      }
      if (i === view.position) sp.scale.set(0.5 * zoomScale);
    });

    const o = this.overlayG;
    o.clear();

    // The front: a translucent plane across the corridor, with a fainter wake behind it.
    const frontQuad = (x: number) => [
      this.project(x, -radius, -radius),
      this.project(x, radius, -radius),
      this.project(x, radius, radius),
      this.project(x, -radius, radius),
    ];
    const band = 24;
    for (let k = 3; k >= 0; k--) {
      const x = view.frontX - (k * band) / 3;
      if (x < xMin - band) continue;
      o.poly(frontQuad(x).flatMap((p) => [p.x, p.y])).fill({
        color: palette.front,
        alpha: 0.03 + (3 - k) * 0.015,
      });
    }
    o.poly(frontQuad(view.frontX).flatMap((p) => [p.x, p.y])).stroke({
      width: 1,
      color: palette.front,
      alpha: 0.6,
    });
    const fl = this.project(view.frontX, -radius, radius);
    this.label('front', 'FRONT', fl.x + 4, fl.y - 14, palette.front, 0.8);

    // Route travelled so far.
    if (view.route.length > 1) {
      view.route.forEach((idx, k) => {
        const p = this.proj[idx] as Projected;
        if (k === 0) o.moveTo(p.x, p.y);
        else o.lineTo(p.x, p.y);
      });
      o.stroke({ width: 1.5, color: palette.route, alpha: 0.75 });
    }

    // Jump range ring (an orthographic sphere projects to a circle) and sensor range.
    const here = this.proj[view.position] as Projected;
    o.circle(here.x, here.y, view.jumpRangeLy * this.cam.zoom).stroke({
      width: 1,
      color: palette.ring,
      alpha: 0.6,
    });
    o.circle(here.x, here.y, view.sensorRangeLy * this.cam.zoom).stroke({
      width: 1,
      color: palette.ring,
      alpha: 0.18,
    });

    // Reachable stars.
    for (const i of view.reachable) {
      const p = this.proj[i] as Projected;
      o.circle(p.x, p.y, 6).stroke({ width: 1, color: palette.reach, alpha: 0.8 });
    }
    // Resource caches from decoded signals.
    for (const i of view.caches) {
      const p = this.proj[i] as Projected;
      o.rect(p.x - 5, p.y - 5, 10, 10).stroke({ width: 1, color: palette.good, alpha: 0.9 });
    }

    // Selected / hovered.
    if (view.selected != null) {
      const p = this.proj[view.selected] as Projected;
      o.circle(p.x, p.y, 10).stroke({ width: 1.5, color: palette.amber, alpha: 1 });
      o.moveTo(here.x, here.y)
        .lineTo(p.x, p.y)
        .stroke({ width: 1, color: palette.amber, alpha: 0.7 });
    }
    if (view.hovered != null && view.hovered !== view.selected) {
      const p = this.proj[view.hovered] as Projected;
      o.circle(p.x, p.y, 8).stroke({ width: 1, color: palette.ink, alpha: 0.7 });
    }

    // Ship marker.
    o.moveTo(here.x, here.y - 11)
      .lineTo(here.x + 7, here.y + 6)
      .lineTo(here.x - 7, here.y + 6)
      .closePath();
    o.stroke({ width: 1.5, color: palette.ship, alpha: 1 });

    // Goal marker.
    const goalIdx = sector.goal.starIndex;
    const g = this.proj[goalIdx] as Projected;
    o.moveTo(g.x, g.y - 12)
      .lineTo(g.x + 12, g.y)
      .lineTo(g.x, g.y + 12)
      .lineTo(g.x - 12, g.y)
      .closePath();
    o.stroke({ width: 1.5, color: palette.goal, alpha: 0.95 });
    const goalStar = stars[goalIdx];
    if (goalStar)
      this.label('goal', `GOAL · ${shortLabel(goalStar)}`, g.x + 14, g.y - 6, palette.goal);

    // The Sun: a marker at the view's edge in its true direction, with its distance.
    const sd = sector.sunDirection;
    const origin = this.project(0, 0, 0);
    const far = this.project(sd[0] * 1000, sd[1] * 1000, sd[2] * 1000);
    const dx = far.x - origin.x;
    const dy = far.y - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const reach = Math.min(w, h) * 0.44;
    const sx = w / 2 + (dx / len) * reach;
    const sy = h / 2 + (dy / len) * reach;
    o.circle(sx, sy, 4).stroke({ width: 1, color: palette.sol, alpha: 0.8 });
    o.moveTo(sx - (dx / len) * 10, sy - (dy / len) * 10)
      .lineTo(sx - (dx / len) * 22, sy - (dy / len) * 22)
      .stroke({ width: 1, color: palette.sol, alpha: 0.5 });
    const solText = `Sol, ${Math.round(sector.sunDistanceLy).toLocaleString('en-US')} ly`;
    this.label(
      'sol',
      solText,
      sx + (dx < 0 ? 8 : -8 - solText.length * 7.2),
      sy + 6,
      palette.sol,
      0.85,
    );

    // Current star label.
    const cur = stars[view.position];
    if (cur) this.label('here', shortLabel(cur), here.x + 10, here.y + 8, palette.ship, 0.9);
  }

  // ---------------------------------------------------------------- input

  private pick(clientX: number, clientY: number): number | null {
    const rect = this.app.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: number | null = null;
    let bestD = 12 * 12;
    this.proj.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private onDown = (e: PointerEvent): void => {
    this.dragging = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, moved: false };
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.dragging;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) {
        if (d.pan) {
          const c = Math.cos(this.cam.yaw);
          const s = Math.sin(this.cam.yaw);
          const ux = -dx / this.cam.zoom;
          const uy = dy / this.cam.zoom / Math.max(0.2, Math.sin(this.cam.pitch));
          this.cam.panX += ux * c + uy * s;
          this.cam.panY += -ux * s + uy * c;
        } else {
          this.cam.yaw -= dx * 0.006;
          this.cam.pitch = Math.max(0.05, Math.min(Math.PI / 2, this.cam.pitch + dy * 0.006));
        }
        d.x = e.clientX;
        d.y = e.clientY;
        this.invalidate();
        this.events.onCamera(this.getCamera());
      }
      return;
    }
    if (e.target !== this.app.canvas) return;
    const idx = this.pick(e.clientX, e.clientY);
    const rect = this.app.canvas.getBoundingClientRect();
    this.events.onHover(
      idx,
      idx == null ? null : { x: e.clientX - rect.left, y: e.clientY - rect.top },
    );
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.dragging;
    this.dragging = null;
    if (d && !d.moved && e.target === this.app.canvas)
      this.events.onClick(this.pick(e.clientX, e.clientY));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.cam.zoom = Math.max(0.8, Math.min(30, this.cam.zoom * factor));
    this.invalidate();
    this.events.onCamera(this.getCamera());
  };
}
