import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { HeadTracker, type DepthReading, type TrackingStatus } from '../lib/viewer/tracker';
import type { EyePosition } from '../lib/viewer/projection';
import type { EyeObservation } from '../lib/viewer/projection';
import type { GazeReading } from '../lib/viewer/eye-model';

function environment(t: TestContext) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  const clock = { now: 1000 };
  t.mock.method(performance, 'now', () => clock.now);
  const callbacks = new Map<number, FrameRequestCallback>(); let frame = 0;
  const tracks = [{ stopped: false, onended: null as (() => void) | null, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, getVideoTracks: () => tracks };
  let getMedia: () => Promise<unknown> = async () => stream;
  class WorkerMock {
    static instances: WorkerMock[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminated = false;
    messages: unknown[] = [];
    constructor() { WorkerMock.instances.push(this); }
    postMessage(data: unknown) { this.messages.push(data); }
    terminate() { this.terminated = true; }
    emit(data: unknown) { this.onmessage?.({ data }); }
  }
  set('window', { isSecureContext: true, location: { origin: 'https://example.test' }, setTimeout: globalThis.setTimeout });
  set('navigator', { mediaDevices: { getUserMedia: () => getMedia() } });
  set('Worker', WorkerMock);
  set('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frame, callback); return frame; });
  set('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  set('createImageBitmap', async () => ({ width: 640, height: 480, close() {} }));
  const video = { srcObject: null, readyState: 2, currentTime: 1, paused: true, async play() { this.paused = false; }, pause() { this.paused = true; } };
  const statuses: TrackingStatus[] = [], errors: string[] = [], positions: EyePosition[] = [], gaze: (GazeReading | undefined)[] = [], depth: (DepthReading | undefined)[] = [];
  const tracker = new HeadTracker(video as unknown as HTMLVideoElement, s => statuses.push(s), (p, _ms, g, d) => { positions.push(p); gaze.push(g); depth.push(d); }, e => errors.push(e));
  t.after(() => { tracker.stop(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  return { tracker, video, tracks, stream, statuses, errors, positions, gaze, depth, clock, callbacks, WorkerMock, setMedia: (fn: () => Promise<unknown>) => { getMedia = fn; } };
}

void test('canceling while camera permission is pending stops the late stream', async t => {
  const env = environment(t); let resolve!: (stream: unknown) => void;
  env.setMedia(() => new Promise(r => { resolve = r; }));
  const start = env.tracker.start(); env.tracker.stop(); resolve(env.stream); await start;
  assert.equal(env.tracks[0].stopped, true); assert.equal(env.video.srcObject, null); assert.equal(env.WorkerMock.instances.length, 0);
});
void test('stop terminates the worker, camera, frame loop and video after startup', async t => {
  const env = environment(t); await env.tracker.start();
  const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' }); await Promise.resolve();
  assert.ok(env.callbacks.size > 0); assert.equal(env.video.paused, false);
  env.tracker.stop(); assert.equal(worker.terminated, true); assert.equal(env.tracks[0].stopped, true); assert.equal(env.video.srcObject, null); assert.equal(env.callbacks.size, 0); assert.equal(env.statuses.at(-1), 'off');
});
void test('camera denial explains recovery and never starts inference', async t => {
  const env = environment(t); env.setMedia(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  await env.tracker.start(); assert.match(env.errors[0], /declined/); assert.equal(env.statuses.at(-1), 'off'); assert.equal(env.WorkerMock.instances.length, 0);
});
void test('worker failures and revoked camera access release camera resources', async t => {
  const env = environment(t); await env.tracker.start();
  const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'error', message: 'GPU failed' });
  assert.equal(env.tracks[0].stopped, true); assert.equal(worker.terminated, true); assert.equal(env.errors.length, 1);
  env.tracks[0].stopped = false; await env.tracker.start(); env.tracks[0].onended?.();
  assert.equal(env.tracks[0].stopped, true); assert.match(env.errors.at(-1)!, /disconnected|revoked/);
});
void test('calibration requires recent eyes; tracking loss holds the last pose and recovers', async t => {
  const env = environment(t); await env.tracker.start(); const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' });
  assert.equal(env.tracker.calibrate(), false);
  const observation = { x: 320, y: 240, span: 63, left: { x: 351.5, y: 240 }, right: { x: 288.5, y: 240 }, imageWidth: 640, imageHeight: 480 };
  for (let i = 0; i < 6; i++) { env.clock.now += 33; worker.emit({ type: 'result', observation: { ...observation, time: env.clock.now }, inferenceMs: 10 }); }
  assert.equal(env.tracker.calibrate(), true);
  env.clock.now += 33; worker.emit({ type: 'result', observation: { ...observation, x: 300, time: env.clock.now }, inferenceMs: 10 });
  assert.equal(env.positions.length, 1); assert.ok(env.positions[0].x > 0);
  env.clock.now += 700; worker.emit({ type: 'result', observation: null }); assert.equal(env.statuses.at(-1), 'lost'); assert.equal(env.positions.length, 1); assert.equal(env.tracker.calibrate(), false);
  worker.emit({ type: 'result', observation: { ...observation, time: env.clock.now }, inferenceMs: 10 }); assert.equal(env.statuses.at(-1), 'tracking'); assert.equal(env.positions.length, 2);
});
void test('a stalled worker stops tracking instead of freezing indefinitely', async t => {
  const env = environment(t); await env.tracker.start(); const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' });
  env.clock.now += 6000; const callback = [...env.callbacks.values()].at(-1)!; callback(env.clock.now);
  assert.equal(env.tracks[0].stopped, true); assert.match(env.errors[0], /stalled/);
});
void test('the live tracker uses locked eye spheres and applies eye tuning without restarting the camera', async t => {
  const env = environment(t); await env.tracker.start(); const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' });
  const observation: EyeObservation = { x: 320, y: 200, span: 63, left: { x: 351.5, y: 200, z: -12 }, right: { x: 288.5, y: 200, z: -12 }, head: { origin: { x: 320, y: 240, z: 0 }, axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: 24 }, imageWidth: 640, imageHeight: 480, time: env.clock.now };
  const emit = (o: EyeObservation) => { env.clock.now += 33; worker.emit({ type: 'result', observation: { ...o, time: env.clock.now }, inferenceMs: 10 }); };
  for (let i = 0; i < 6; i++) emit(observation);
  assert.equal(env.tracker.calibrate(), true);
  const moved = { ...observation, x: 326, left: { ...observation.left, x: 357.5, z: -Math.sqrt(108) }, right: { ...observation.right, x: 294.5, z: -Math.sqrt(108) } };
  emit(moved); assert.ok(Math.abs(env.positions.at(-1)!.x + 0.003) < 1e-8); assert.equal(env.gaze.at(-1)!.valid, true);
  env.tracker.tuning = { ...env.tracker.tuning, eyeGain: 0 };
  for (let i = 0; i < 100; i++) emit(moved);
  assert.ok(Math.abs(env.positions.at(-1)!.x) < 1e-5); assert.ok(Math.abs(env.positions.at(-1)!.z - 0.55) < 1e-5);
  env.tracker.tuning = { ...env.tracker.tuning, depthDirection: -1 };
  const near = { ...observation, head: { ...observation.head!, scale: 30 } };
  for (let i = 0; i < 100; i++) emit(near);
  assert.ok(Math.abs(env.positions.at(-1)!.z - 0.66) < 1e-5);
  assert.ok(Math.abs(env.depth.at(-1)!.measured - 0.44) < 1e-9, 'reversed view must not reverse the measured distance');
  assert.equal(env.depth.at(-1)!.neutral, 0.55);
  assert.equal(env.WorkerMock.instances.length, 1); assert.equal(env.tracks[0].stopped, false);
});
void test('centering rejects moving samples instead of freezing an unstable eye model', async t => {
  const env = environment(t); await env.tracker.start(); const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' });
  for (let i = 0; i < 6; i++) {
    env.clock.now += 33;
    worker.emit({ type: 'result', observation: { x: 320 + i * 5, y: 200, span: 63, left: { x: 351.5 + i * 5, y: 200 }, right: { x: 288.5 + i * 5, y: 200 }, time: env.clock.now }, inferenceMs: 10 });
  }
  assert.equal(env.tracker.calibrate(), false); assert.equal(env.statuses.at(-1), 'ready');
});
