import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { HeadTracker, type DepthReading, type TrackingStatus } from '../lib/viewer/tracker';
import type { EyePosition } from '../lib/viewer/projection';
import type { EyeObservation } from '../lib/viewer/projection';
import type { GazeReading } from '../lib/viewer/eye-model';
import { geometryLandmarks } from '../lib/viewer/metric-face';
import type { GazeProfile, GazeSample } from '../lib/viewer/gaze-calibration';
import { calibrationFixture } from './fixtures/calibration';

function environment(t: TestContext) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  const clock = { now: 1000 };
  t.mock.method(performance, 'now', () => clock.now);
  const callbacks = new Map<number, FrameRequestCallback>(); let frame = 0;
  const settings:MediaTrackSettings={deviceId:'camera-A',width:640,height:480,facingMode:'user'};
  const requests:MediaStreamConstraints[]=[];
  const tracks = [{ label:'Test webcam',getSettings:()=>settings,stopped: false, onended: null as (() => void) | null, stop() { this.stopped = true; } }];
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
  set('navigator', { mediaDevices: { getUserMedia: (constraints:MediaStreamConstraints) => {requests.push(constraints);return getMedia();} } });
  set('Worker', WorkerMock);
  set('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frame, callback); return frame; });
  set('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  set('createImageBitmap', async () => ({ width: 640, height: 480, close() {} }));
  const video = { srcObject: null, readyState: 2, currentTime: 1, paused: true, async play() { this.paused = false; }, pause() { this.paused = true; } };
  const statuses: TrackingStatus[] = [], errors: string[] = [], positions: EyePosition[] = [], gaze: (GazeReading | undefined)[] = [], depth: (DepthReading | undefined)[] = [];
  const tracker = new HeadTracker(video as unknown as HTMLVideoElement, s => statuses.push(s), (p, _ms, g, d) => { positions.push(p); gaze.push(g); depth.push(d); }, e => errors.push(e));
  t.after(() => { tracker.stop(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  return { tracker, video, tracks, stream, statuses, errors, positions, gaze, depth, clock, callbacks, WorkerMock, settings, requests, setMedia: (fn: () => Promise<unknown>) => { getMedia = fn; } };
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
void test('live metric fit uses facial reprojection, preserves approach direction and allows legacy comparison', async t => {
  const env=environment(t);await env.tracker.start();const worker=env.WorkerMock.instances[0];worker.emit({type:'ready'});
  const baseline:EyeObservation={x:320,y:200,span:63,left:{x:351.5,y:200,z:-12},right:{x:288.5,y:200,z:-12},head:{origin:{x:320,y:240,z:0},axes:[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}],scale:24},face:geometryLandmarks.map((_,i)=>({x:320+(i%3-1)*40,y:200+(Math.floor(i/3)-4)*12,z:-12})),imageWidth:640,imageHeight:480,time:0};
  const emit=(observation:EyeObservation)=>{env.clock.now+=33;worker.emit({type:'result',observation:{...observation,time:env.clock.now},inferenceMs:10});};
  for(let i=0;i<6;i++) emit(baseline);assert.equal(env.tracker.calibrate(),true);
  const near={...baseline,face:baseline.face!.map(p=>({...p,x:320+(p.x-320)*1.25,y:240+(p.y-240)*1.25}))};
  for(let i=0;i<60;i++) emit(near);
  assert.equal(env.depth.at(-1)!.method,'metric');assert.ok(Math.abs(env.depth.at(-1)!.measured-.44)<1e-6);assert.ok(Math.abs(env.positions.at(-1)!.z-.66)<1e-5);
  env.tracker.setGeometryMode('legacy');emit(near);
  assert.equal(env.depth.at(-1)!.method,'legacy');assert.ok(Math.abs(env.depth.at(-1)!.measured-.55)<1e-6);
});
void test('gaze profiles apply to rendering, subscriptions detach, and stale sessions cannot apply after reset',async t=>{
  const env=environment(t);await env.tracker.start();const worker=env.WorkerMock.instances[0];worker.emit({type:'ready'});
  const baseline:EyeObservation={x:320,y:200,span:63,left:{x:351.5,y:200,z:-12},right:{x:288.5,y:200,z:-12},head:{origin:{x:320,y:240,z:0},axes:[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}],scale:24},imageWidth:640,imageHeight:480,time:0};
  const emit=()=>{env.clock.now+=33;worker.emit({type:'result',observation:{...baseline,time:env.clock.now},inferenceMs:10});};
  for(let i=0;i<6;i++) emit();assert.equal(env.tracker.calibrate(),true);
  const screen={width:1200,height:800,metersPerPixel:.0003,center:{x:600,y:400}};env.tracker.setScreenGeometry(screen);
  const samples:GazeSample[]=[],unsubscribe=env.tracker.subscribeGaze(s=>samples.push(s));emit();assert.equal(samples.length,1);
  const revision=env.tracker.calibrationRevision,profile:GazeProfile={mean:{x:.5,y:.5},scale:{x:1,y:1},x:[.8,0,0,0,0,0],y:[.5,0,0,0,0,0],width:1200,height:800};
  assert.equal(env.tracker.applyGazeProfile(profile,revision),true);emit();assert.ok(env.positions.at(-1)!.x>.001);assert.equal(env.depth.at(-1)!.calibrated,true);
  unsubscribe();emit();assert.equal(samples.length,2);
  env.tracker.setScreenGeometry({...screen,width:800});assert.equal(env.tracker.hasGazeProfile,false);assert.equal(env.tracker.applyGazeProfile(profile,revision),false);
  env.tracker.setScreenGeometry(screen);assert.equal(env.tracker.applyGazeProfile(profile,env.tracker.calibrationRevision),true);
  env.tracker.calibrate();assert.equal(env.tracker.hasGazeProfile,false);assert.equal(env.tracker.applyGazeProfile(profile,revision),false);
  env.tracker.stop();assert.equal(env.tracker.applyGazeProfile(profile,env.tracker.calibrationRevision),false);
});
void test('a saved face reference and distance mappings restore after a full camera restart without recentering',async t=>{
  const env=environment(t),{calibration}=calibrationFixture();
  for(const layer of calibration.profile.layers!) layer.profile={...layer.profile,x:[.8,0,0,0,0,0]};
  await env.tracker.start('camera-A');assert.deepEqual((env.requests[0].video as MediaTrackConstraints).deviceId,{exact:'camera-A'});
  assert.equal(env.tracker.camera?.deviceId,'camera-A');assert.equal(env.tracker.restoreCalibration(calibration),true);
  let worker=env.WorkerMock.instances.at(-1)!;worker.emit({type:'ready'});
  const samples:GazeSample[]=[];env.tracker.subscribeGaze(s=>samples.push(s));
  const emit=()=>{env.clock.now+=33;worker.emit({type:'result',observation:{...calibration.baseline,time:env.clock.now},inferenceMs:10});};
  for(let i=0;i<60;i++) emit();
  const before=env.positions.at(-1)!;assert.ok(before.x>.001);assert.equal(env.depth.at(-1)!.calibrated,true);
  assert.ok(Math.abs(samples.at(-1)!.distance-.55)<1e-8);
  const snapshot=JSON.parse(JSON.stringify(env.tracker.captureCalibration()));
  env.tracker.stop();assert.equal(env.tracker.captureCalibration(),null);assert.equal(env.tracker.restoreCalibration(snapshot),false);
  await env.tracker.start('camera-A');assert.equal(env.tracker.restoreCalibration(snapshot),true);
  worker=env.WorkerMock.instances.at(-1)!;worker.emit({type:'ready'});
  for(let i=0;i<60;i++) emit();
  const after=env.positions.at(-1)!;assert.ok(Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)<1e-9);
  assert.equal(env.errors.length,0);
  const revision=env.tracker.calibrationRevision;
  env.tracker.calibrate();assert.equal(env.tracker.hasGazeProfile,false);assert.equal(env.tracker.applyGazeProfile(snapshot.profile,revision),false);
});
void test('saved geometry rejects a different resolution and a resolution change during tracking releases the camera',async t=>{
  const env=environment(t),{calibration}=calibrationFixture();await env.tracker.start();
  env.settings.width=1280;assert.equal(env.tracker.restoreCalibration(calibration),false);
  env.settings.width=640;assert.equal(env.tracker.restoreCalibration(calibration),true);
  const worker=env.WorkerMock.instances.at(-1)!;worker.emit({type:'ready'});
  worker.emit({type:'result',observation:{...calibration.baseline,imageWidth:1280,time:env.clock.now},inferenceMs:10});
  assert.match(env.errors.at(-1)!,/resolution changed/);assert.equal(env.tracks[0].stopped,true);assert.equal(env.tracker.hasGazeProfile,false);
});
void test('live distance blending follows measured head depth while Grow when closer reverses only virtual depth',async t=>{
  const env=environment(t),{calibration}=calibrationFixture();
  calibration.profile.layers!.forEach((layer,i)=>{layer.profile={...layer.profile,x:[[.2,.5,.8][i],0,0,0,0,0]};});
  await env.tracker.start();assert.equal(env.tracker.restoreCalibration(calibration),true);
  const worker=env.WorkerMock.instances.at(-1)!;worker.emit({type:'ready'});
  const near={...calibration.baseline,face:calibration.baseline.face!.map(p=>({...p,x:320+(p.x-320)*1.25,y:240+(p.y-240)*1.25}))};
  for(let i=0;i<60;i++) {env.clock.now+=33;worker.emit({type:'result',observation:{...near,time:env.clock.now},inferenceMs:10});}
  assert.ok(Math.abs(env.depth.at(-1)!.measured-.44)<1e-6);
  assert.ok(env.positions.at(-1)!.z>.65);assert.ok(env.positions.at(-1)!.x<-.001,'near mapping should be selected despite reversed virtual depth');
});

void test('screen subscriptions receive calibrated coordinates and explicit loss without the viewer depth reversal', async t => {
  const env = environment(t), { calibration } = calibrationFixture();
  for (const layer of calibration.profile.layers!) layer.profile = { ...layer.profile, x: [.8, 0, 0, 0, 0, 0], y: [.2, 0, 0, 0, 0, 0] };
  await env.tracker.start(); assert.equal(env.tracker.restoreCalibration(calibration), true);
  const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' });
  const samples: import('../lib/viewer/tracker').ScreenGaze[] = [], unsubscribe = env.tracker.subscribeScreenGaze(s => samples.push(s));
  const emit = () => { env.clock.now += 50; worker.emit({ type: 'result', observation: { ...calibration.baseline, time: env.clock.now }, inferenceMs: 10 }); };
  emit(); assert.deepEqual(samples.at(-1)?.point, { x: .8, y: .2 });
  env.tracker.tuning = { ...env.tracker.tuning, depthDirection: 1 }; emit(); assert.deepEqual(samples.at(-1)?.point, { x: .8, y: .2 });
  env.tracker.clearGazeProfile(); emit(); assert.equal(samples.at(-1)?.point, null);
  worker.emit({ type: 'result', observation: null, inferenceMs: 10 }); assert.equal(samples.at(-1)?.point, null);
  const count = samples.length; unsubscribe(); emit(); assert.equal(samples.length, count);
});
void test('recording frame cadence comes from the worker and survives absent animation frames with backpressure', async t => {
  const env = environment(t); await env.tracker.start(); const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' }); await Promise.resolve();
  worker.emit({ type: 'result', observation: null }); env.tracker.setContinuousCapture(true);
  assert.equal(env.callbacks.size, 0); assert.ok(worker.messages.some(m => (m as { type: string; enabled?: boolean }).type === 'continuous' && (m as { enabled: boolean }).enabled));
  const before = worker.messages.filter(m => (m as { type: string }).type === 'frame').length;
  env.clock.now += 60; env.video.currentTime += .06; worker.emit({ type: 'tick' }); await Promise.resolve();
  assert.equal(worker.messages.filter(m => (m as { type: string }).type === 'frame').length, before + 1);
  env.clock.now += 60; env.video.currentTime += .06; worker.emit({ type: 'tick' }); await Promise.resolve();
  assert.equal(worker.messages.filter(m => (m as { type: string }).type === 'frame').length, before + 1, 'never queue frames while inference is busy');
  env.tracker.setContinuousCapture(false); assert.ok(env.callbacks.size > 0); env.tracker.stop(); assert.equal(env.tracks[0].stopped, true);
});
void test('delayed camera results cannot add stale on-screen gaze to a recording', async t => {
  const env = environment(t), { calibration } = calibrationFixture(); await env.tracker.start(); env.tracker.restoreCalibration(calibration);
  const worker = env.WorkerMock.instances[0]; worker.emit({ type: 'ready' });
  const samples: import('../lib/viewer/tracker').ScreenGaze[] = []; env.tracker.subscribeScreenGaze(s => samples.push(s));
  worker.emit({ type: 'result', observation: { ...calibration.baseline, time: env.clock.now - 350 }, inferenceMs: 350 });
  assert.equal(samples.at(-1)?.point, null); assert.equal(env.statuses.at(-1), 'lost');
});
