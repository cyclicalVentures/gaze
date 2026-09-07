import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, formatTime, intervals, MAX_SESSION_MS, pointAt, SessionCapture, sessionCsv, type GazeSession } from '../lib/recorder/session';
import { captureMismatch, fullScreenFits, recordingStorage } from '../lib/recorder/calibration';

void test('recording uses capture timestamps and rejects stale calibration, duplicate, malformed and out-of-session samples', () => {
  const c = new SessionCapture(1000, 4);
  c.push({ time: 900, revision: 4, point: { x: .5, y: .5 } });
  c.push({ time: 1010, revision: 3, point: { x: .5, y: .5 } });
  c.push({ time: 1010, revision: 4, point: { x: .5, y: .5 } });
  c.push({ time: 1010, revision: 4, point: { x: .6, y: .6 } });
  c.push({ time: 1020, revision: 4, point: null });
  c.push({ time: 1080, revision: 4, point: { x: NaN, y: .5 } });
  c.push({ time: 1140, revision: 4, point: { x: 1.1, y: .5 } });
  c.push({ time: 1001 + MAX_SESSION_MS, revision: 4, point: { x: .5, y: .5 } });
  assert.deepEqual(c.points, [{ t: 10, x: .5, y: .5 }, { t: 20, x: null, y: null }, { t: 80, x: null, y: null }, { t: 140, x: 1.1, y: .5 }]);
});
void test('hotspots measure dwell, remain stable across frame rates, and distinguish off-screen from unobserved time', () => {
  const dense = Array.from({ length: 100 }, (_, i) => ({ t: i * 10, x: .5, y: .5 }));
  const sparse = Array.from({ length: 20 }, (_, i) => ({ t: i * 50, x: .5, y: .5 }));
  const a = analyze(dense, 0, 1000), b = analyze(sparse, 0, 1000);
  assert.equal(a.tracked, 1000); assert.equal(b.tracked, 1000); assert.equal(a.zones[0].name, 'Center'); assert.ok(Math.abs(a.peak - b.peak) < .01);
  const mixed = analyze([{ t: 0, x: .1, y: .1 }, { t: 50, x: null, y: null }, { t: 500, x: 1.2, y: .5 }, { t: 550, x: .9, y: .9 }], 0, 1000);
  assert.equal(mixed.tracked, 200); assert.equal(mixed.offscreen, 50); assert.equal(mixed.missing, 750);
  assert.equal(mixed.zones[0].name, 'Lower right');
});
void test('playback, trail intervals and range analysis never bridge a blink or background suspension', () => {
  const points = [{ t: 0, x: .2, y: .3 }, { t: 50, x: null, y: null }, { t: 1000, x: .8, y: .7 }];
  assert.equal(pointAt(points, -1), null); assert.equal(pointAt(points, 49)?.x, .2);
  assert.equal(pointAt(points, 50), null); assert.equal(pointAt(points, 700), null);
  assert.equal(pointAt(points, 1000)?.x, .8); assert.equal(pointAt(points, 1151), null);
  assert.equal(analyze(points, 25, 1100).tracked, 125);
  const durations: number[] = []; intervals(points, 25, 50, (_, ms) => durations.push(ms)); assert.deepEqual(durations, [25]);
  assert.equal(analyze(points, 50, 50).tracked, 0);
});
void test('CSV preserves normalized coordinates, CSS-pixel frame and explicit loss; long-session time stays readable', () => {
  const s = { width: 1000, height: 500, points: [{ t: 0, x: .2, y: .4 }, { t: 50, x: null, y: null }, { t: 100, x: -.1, y: .3 }] } as GazeSession;
  assert.match(sessionCsv(s), /0,0.2,0.4,200.0,200.0,on-screen/);
  assert.match(sessionCsv(s), /50,,,,,lost/); assert.match(sessionCsv(s), /100,-0.1,0.3,-100.0,150.0,off-screen/);
  assert.equal(formatTime(7_200_000), '120:00');
});
void test('recording calibration spaces stay isolated and captured windows are rejected', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  storage.setItem('camera', 'viewer'); recordingStorage(storage, 'screen').setItem('camera', 'screen'); recordingStorage(storage, 'page').setItem('camera', 'page');
  assert.equal(storage.getItem('camera'), 'viewer'); assert.equal(recordingStorage(storage, 'screen').getItem('camera'), 'screen');
  recordingStorage(storage, 'page').removeItem('camera'); assert.equal(recordingStorage(storage, 'screen').getItem('camera'), 'screen');
  assert.equal(fullScreenFits(1920, 1080, { width: 1920, height: 1080, pixelRatio: 2 }), true);
  assert.equal(fullScreenFits(1900, 1000, { width: 1920, height: 1080, pixelRatio: 2 }), false);
  assert.match(captureMismatch({ displaySurface: 'window', width: 1920, height: 1080 }, 1920, 1080), /Entire screen/);
  assert.match(captureMismatch({ displaySurface: 'monitor', width: 1080, height: 1920 }, 1920, 1080), /different shape/);
  assert.equal(captureMismatch({ displaySurface: 'monitor', width: 1280, height: 720 }, 1920, 1080), '');
});
