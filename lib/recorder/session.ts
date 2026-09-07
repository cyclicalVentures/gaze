import type { ScreenGaze } from '../viewer/tracker';

export const MAX_SESSION_MS = 2 * 60 * 60 * 1000;
export const MAX_HOLD_MS = 150;
export type GazePoint = { t: number; x: number | null; y: number | null };
export type SessionMeta = {
  version: 1; id: string; name: string; startedAt: number; duration: number;
  width: number; height: number; scope: 'screen' | 'page'; camera: string;
  calibrationError: number; ended: boolean; sampleCount: number; videoType: string;
};
export type GazeSession = SessionMeta & { points: GazePoint[] };
export function onScreen(p: GazePoint) { return p.x !== null && p.y !== null && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1; }
export class SessionCapture {
  readonly points: GazePoint[] = [];
  constructor(readonly origin: number, readonly revision: number) {}
  push(sample: ScreenGaze) {
    const t = sample.time - this.origin, previous = this.points.at(-1);
    if (sample.revision !== this.revision || !Number.isFinite(t) || t < 0 || t > MAX_SESSION_MS || (previous && t <= previous.t)) return;
    const p = sample.point;
    const valid = p && Number.isFinite(p.x + p.y) && Math.abs(p.x) < 10 && Math.abs(p.y) < 10;
    if (previous && t - previous.t < 50 && (previous.x === null) === !valid) return;
    this.points.push({ t: Math.round(t), x: valid ? p.x : null, y: valid ? p.y : null });
  }
}
/** Hold only a short observed interval. Never bridge a blink or suspended tab. */
export function intervals(points: GazePoint[], start: number, end: number, visit: (point: GazePoint, ms: number, from: number) => void) {
  for (let i = lowerBound(points, start - MAX_HOLD_MS); i < points.length && points[i].t < end; i++) {
    const p = points[i], a = Math.max(start, p.t), b = Math.min(end, p.t + MAX_HOLD_MS, points[i + 1]?.t ?? end);
    if (b > a) visit(p, b - a, a);
  }
}
export function lowerBound(points: GazePoint[], time: number) {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].t < time) lo = mid + 1; else hi = mid; }
  return lo;
}
export function pointAt(points: GazePoint[], time: number): GazePoint | null {
  const index = lowerBound(points, time + .001) - 1, p = points[index];
  return p && time - p.t <= MAX_HOLD_MS && onScreen(p) ? p : null;
}
export const zoneNames = ['Upper left', 'Upper center', 'Upper right', 'Middle left', 'Center', 'Middle right', 'Lower left', 'Lower center', 'Lower right'];
export function analyze(points: GazePoint[], start: number, end: number, cols = 96, rows = 54) {
  const grid = new Float32Array(cols * rows), zones = Array.from({ length: 9 }, () => 0);
  let tracked = 0, offscreen = 0;
  intervals(points, start, end, (p, ms) => {
    if (!onScreen(p)) { if (p.x !== null) offscreen += ms; return; }
    tracked += ms;
    const x = p.x!, y = p.y!;
    zones[Math.min(2, Math.floor(y * 3)) * 3 + Math.min(2, Math.floor(x * 3))] += ms;
    const gx = x * (cols - 1), gy = y * (rows - 1), radius = 4;
    for (let yy = Math.max(0, Math.floor(gy) - radius); yy <= Math.min(rows - 1, Math.ceil(gy) + radius); yy++) {
      for (let xx = Math.max(0, Math.floor(gx) - radius); xx <= Math.min(cols - 1, Math.ceil(gx) + radius); xx++) {
        grid[yy * cols + xx] += ms * Math.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / 6);
      }
    }
  });
  let peak = 0; for (const value of grid) peak = Math.max(peak, value);
  return { grid, cols, rows, peak, tracked, offscreen, missing: Math.max(0, end - start - tracked - offscreen), zones: zones.map((ms, i) => ({ name: zoneNames[i], ms })).sort((a, b) => b.ms - a.ms) };
}
export function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
export function sessionCsv(session: GazeSession) {
  return 'time_ms,x_normalized,y_normalized,x_css_px,y_css_px,status\n' + session.points.map(p => `${p.t},${p.x ?? ''},${p.y ?? ''},${p.x === null ? '' : (p.x * session.width).toFixed(1)},${p.y === null ? '' : (p.y * session.height).toFixed(1)},${p.x === null ? 'lost' : onScreen(p) ? 'on-screen' : 'off-screen'}`).join('\n');
}
