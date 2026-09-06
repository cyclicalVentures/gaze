import test from 'node:test';
import assert from 'node:assert/strict';
import { averageObservation, lockEyeModel, observeFace, reconstructEyes, type Vec3 } from '../lib/viewer/eye-model';
import type { EyeObservation } from '../lib/viewer/projection';

const neutral = (): EyeObservation => ({ x: 320, y: 200, span: 63, left: { x: 351.5, y: 200, z: -12 }, right: { x: 288.5, y: 200, z: -12 }, head: { origin: { x: 320, y: 240, z: 0 }, axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: 24 }, imageWidth: 640, imageHeight: 480, time: 1000 });
const close = (a: number, b: number, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

void test('locked eye centers give a neutral pose and unit forward gaze for each viewpoint', () => {
  const observation = neutral(), model = lockEyeModel(observation, 0.063)!;
  const result = reconstructEyes(observation, model, 0.55, 0.063, 'center')!;
  close(result.position.x, 0); close(result.position.y, 0); close(result.position.z, 0.55);
  close(result.gaze.yaw, 0); close(result.gaze.pitch, 0); assert.equal(result.gaze.valid, true);
  close(result.eyeOffset.x, 0); close(result.eyeOffset.z, 0);
  close(reconstructEyes(observation, model, 0.55, 0.063, 'left')!.position.x, -0.0315);
  close(reconstructEyes(observation, model, 0.55, 0.063, 'right')!.position.x, 0.0315);
});
void test('iris-only rotation changes gaze and optical offset without translating the head or changing depth', () => {
  const observation = neutral(), model = lockEyeModel(observation, 0.063)!;
  const angle = Math.PI / 6;
  const rotated: EyeObservation = { ...observation, span: 75, left: { ...observation.left, x: observation.left.x + 12 * Math.sin(angle), z: -12 * Math.cos(angle) }, right: { ...observation.right, x: observation.right.x + 12 * Math.sin(angle), z: -12 * Math.cos(angle) } };
  const result = reconstructEyes(rotated, model, 0.55, 0.063, 'center')!;
  close(result.position.x, 0); close(result.position.y, 0); close(result.position.z, 0.55);
  close(result.gaze.yaw, -30); close(result.eyeOffset.x, -0.003); assert.ok(result.eyeOffset.z > 0);
  close(Math.hypot(result.gaze.left.x, result.gaze.left.y, result.gaze.left.z), 1);
});
void test('rigid head rotation carries locked eye spheres and produces the expected gaze direction', () => {
  const observation = neutral(), model = lockEyeModel(observation, 0.063)!;
  const a = Math.PI / 9;
  const rotate = (p: Vec3): Vec3 => ({ x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) });
  const move = (p: { x: number; y: number; z?: number }): Vec3 => { const r = rotate({ x: p.x - 320, y: p.y - 240, z: p.z ?? 0 }); return { x: r.x + 320, y: r.y + 240, z: r.z }; };
  const current: EyeObservation = { ...observation, left: move(observation.left), right: move(observation.right), head: { ...observation.head!, axes: observation.head!.axes.map(rotate) as [Vec3, Vec3, Vec3] } };
  const result = reconstructEyes(current, model, 0.55, 0.063, 'center')!;
  close(result.position.x, 0); close(result.position.z, 0.55); close(result.gaze.yaw, 20); assert.equal(result.gaze.valid, true);
});
void test('above-screen camera forward motion is reconstructed without spurious vertical translation', () => {
  const observation = neutral(), model = lockEyeModel(observation, 0.063)!;
  const scalePoint = (p: { x: number; y: number; z?: number }) => ({ x: 320 + (p.x - 320) * 1.25, y: 240 + (p.y - 240) * 1.25, z: (p.z ?? 0) * 1.25 });
  const current: EyeObservation = { ...observation, left: scalePoint(observation.left), right: scalePoint(observation.right), head: { ...observation.head!, origin: scalePoint(observation.head!.origin), scale: 30 } };
  const result = reconstructEyes(current, model, 0.55, 0.063, 'center')!;
  close(result.position.x, 0); close(result.position.y, 0); close(result.position.z, 0.44); close(result.gaze.pitch, 0);
});
void test('inconsistent iris measurements suppress eye contribution while retaining head position', () => {
  const observation = neutral(), model = lockEyeModel(observation, 0.063)!;
  const result = reconstructEyes({ ...observation, left: { x: 370, y: 200, z: -1 } }, model, 0.55, 0.063, 'center')!;
  assert.equal(result.gaze.valid, false); assert.deepEqual(result.eyeOffset, { x: 0, y: 0, z: 0 }); close(result.position.z, 0.55);
  assert.equal(reconstructEyes({ ...observation, head: undefined }, model, 0.55, 0.063, 'center'), null);
});
void test('neutral calibration averages head and iris observations consistently', () => {
  const a = neutral(), b = neutral(); b.x += 2; b.left.x += 2; b.right.x += 2; b.head!.origin.x += 2;
  const average = averageObservation([a, b]);
  close(average.x, 321); close(average.left.x, 352.5); close(average.head!.origin.x, 321);
  const result = reconstructEyes(average, lockEyeModel(average, 0.063)!, 0.55, 0.063, 'center')!;
  close(result.position.x, 0); close(result.gaze.yaw, 0);
});
void test('landmark extraction requires visible open eyes and a nondegenerate head frame', () => {
  const points: Vec3[] = Array.from({ length: 478 }, () => ({ x: 320, y: 240, z: 0 }));
  for (const i of [45, 220, 51]) points[i] = { x: 305, y: 235, z: -6 };
  for (const i of [275, 440, 281]) points[i] = { x: 335, y: 235, z: -6 };
  points[168] = { x: 320, y: 205, z: 0 }; points[4] = { x: 320, y: 242, z: -6 };
  for (const [center, outer, inner, top, bottom, x] of [[468, 33, 133, 159, 145, 288.5], [473, 362, 263, 386, 374, 351.5]]) {
    points[center] = { x, y: 200, z: -12 }; points[outer] = { x: x - 14, y: 200, z: -10 }; points[inner] = { x: x + 14, y: 200, z: -10 }; points[top] = { x, y: 196, z: -10 }; points[bottom] = { x, y: 204, z: -10 };
  }
  const normalized = () => points.map(p => ({ x: p.x / 640, y: p.y / 480, z: p.z / 640 }));
  const observation = observeFace(normalized(), 640, 480, 1000)!;
  assert.ok(observation?.head); close(observation.span, 63); assert.ok(observation.head.axes[2].z > 0.9);
  points[159] = { ...points[145] }; assert.equal(observeFace(normalized(), 640, 480, 1000), null);
  assert.equal(observeFace([], 640, 480, 1000), null);
});
