import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { applyOffAxis, estimateEye, OneEuroFilter, type EyeObservation } from '../lib/viewer/projection';
import { parseModel, disposeObject, validateFile } from '../lib/viewer/model';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const arrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
void test('the physical screen corners stay fixed under head translation in X, Y, and Z', () => {
  for (const eye of [{ x: 0, y: 0, z: .55 }, { x: .14, y: -.07, z: .3 }, { x: -.2, y: .13, z: .9 }]) {
    const camera = new PerspectiveCamera(); applyOffAxis(camera, eye, .34, .22);
    for (const [x, y] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const projected = new Vector3(x * .17, y * .11, 0).project(camera);
      close(projected.x, x); close(projected.y, y);
    }
    close(camera.quaternion.w, 1);
  }
});
void test('behind-screen and front-screen objects have opposite motion parallax', () => {
  const camera = new PerspectiveCamera();
  applyOffAxis(camera, { x: .1, y: 0, z: .55 }, .34, .22);
  assert.ok(new Vector3(0, 0, -.2).project(camera).x > 0);
  assert.ok(new Vector3(0, 0, .1).project(camera).x < 0);
  close(new Vector3(0, 0, 0).project(camera).x, 0);
});
void test('near/far movement changes behind-screen size with the correct ratio', () => {
  const camera = new PerspectiveCamera();
  applyOffAxis(camera, { x: 0, y: 0, z: .3 }, .34, .22);
  const near = new Vector3(.1, 0, -.2).project(camera).x;
  applyOffAxis(camera, { x: 0, y: 0, z: .6 }, .34, .22);
  const far = new Vector3(.1, 0, -.2).project(camera).x;
  close(near / far, (.3 / .5) / (.6 / .8));
});
void test('rejects invalid projection geometry', () => {
  assert.throws(() => applyOffAxis(new PerspectiveCamera(), { x: 0, y: 0, z: 0 }, .3, .2));
  assert.throws(() => applyOffAxis(new PerspectiveCamera(), { x: NaN, y: 0, z: .5 }, .3, .2));
});
const baseline: EyeObservation = { x: 320, y: 240, span: 63, left: { x:351.5, y:240 }, right:{ x:288.5, y:240 }, time: 0 };
void test('calibration reconstructs a known 3D eye displacement and depth', () => {
  const eye = estimateEye({ ...baseline, x: 257, y: 208.5 }, baseline, .5, .063);
  close(eye.x, .063); close(eye.y, .0315); close(eye.z, .5);
  const closer = estimateEye({ ...baseline, span: 126 }, baseline, .5, .063);
  close(closer.z, .25);
  close(estimateEye(baseline, baseline, .5, .063, 'left').x, -.0315);
  close(estimateEye(baseline, baseline, .5, .063, 'right').x, .0315);
});
void test('One Euro filter suppresses jitter and resets on a new calibration', () => {
  const filter = new OneEuroFilter(); let energy = 0;
  for (let i = 0; i < 100; i++) { const n = (i % 2 ? 1 : -1) * .001; energy += Math.abs(filter.filter(n, i / 30)); }
  assert.ok(energy < .06);
  for (let i = 100; i < 115; i++) filter.filter(.1, i / 30);
  assert.ok(filter.filter(.1, 4) > .095);
  filter.reset(); close(filter.filter(.3, 5), .3);
});
void test('ASCII PLY with faces loads as a normalized mesh', async () => {
  const data = new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n');
  const { root, info } = await parseModel(arrayBuffer(data), 'triangle.PLY');
  assert.equal(info.vertices,3); assert.equal(info.triangles,1); assert.equal(info.points,false);
  close(new Box3().setFromObject(root).getSize(new Vector3()).x, 2.7); disposeObject(root);
});
for (const littleEndian of [true, false]) void test(`binary ${littleEndian ? 'little' : 'big'} endian PLY loads as a point cloud`, async () => {
  const header = new TextEncoder().encode(`ply\nformat binary_${littleEndian ? 'little' : 'big'}_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`);
  const bytes = new Uint8Array(header.length + 30); bytes.set(header); const data = new DataView(bytes.buffer);
  for (let i = 0; i < 2; i++) { for (let axis = 0; axis < 3; axis++) data.setFloat32(header.length + i * 15 + axis * 4, i, littleEndian); bytes.set([255,128,0], header.length + i * 15 + 12); }
  const { root, info } = await parseModel(bytes.buffer, 'points.ply'); assert.equal(info.points,true); assert.equal(info.vertices,2); assert.equal(info.triangles,0); disposeObject(root);
});
void test('invalid, empty, oversized and NaN models fail with recovery messages', async () => {
  assert.throws(() => validateFile('foo.glb', 10), /ply/);
  assert.throws(() => validateFile('foo.ply', 0), /empty/);
  assert.throws(() => validateFile('foo.usdz', 160 * 1024 * 1024), /150 MB/);
  await assert.rejects(parseModel(new TextEncoder().encode('hello').buffer, 'bad.usdz'), /valid USDZ/);
  const data = new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\nNaN 0 0\n1 1 1\n');
  await assert.rejects(parseModel(data.buffer, 'bad.ply'), /usable geometry/);
});
void test('the supplied Scaniverse binary USDZ loads mesh geometry and binds its JPEG texture', async () => {
  // Node has no DOM image decoder. Check the embedded JPEG bytes/signature and exercise
  // the loader completion callback; this does not claim GPU/texture rendering validation.
  const original = globalThis.Image;
  class TestImage {
    onload?: () => void; onerror?: () => void;
    width = 4096; height = 4096;
    set src(url: string) { void fetch(url).then(r => r.arrayBuffer()).then(b => { const bytes = new Uint8Array(b); assert.equal(bytes[0],255); assert.equal(bytes[1],216); this.onload?.(); }).catch(() => this.onerror?.()); }
  }
  globalThis.Image = TestImage as unknown as typeof Image;
  try {
    const data = await readFile(new URL('../public/models/USDZ-test.usdz', import.meta.url));
    const { root, info } = await parseModel(arrayBuffer(data), 'USDZ-test.usdz');
    assert.ok(info.vertices > 10000); assert.ok(info.triangles > 10000); assert.equal(info.textures,1);
    const size = new Box3().setFromObject(root).getSize(new Vector3()); close(Math.max(size.x,size.y,size.z),2.7);
    console.log('Scaniverse model:', JSON.stringify(info)); disposeObject(root);
  } finally { globalThis.Image = original; }
});

void test('an above-screen camera does not turn forward head motion into vertical drift', () => {
  const neutral = { ...baseline, x: 300, y: 200, imageWidth: 640, imageHeight: 480 };
  // A camera-centered pinhole model doubles the optical displacement at half distance.
  const observation = { ...neutral, x: 280, y: 160, span: 126 };
  const eye = estimateEye(observation, neutral, .5, .063);
  close(eye.x, 0); close(eye.y, 0); close(eye.z, .25);
});
