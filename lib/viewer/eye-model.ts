import type { EyeObservation, EyePosition } from './projection';

export type Vec3 = { x: number; y: number; z: number };
export type HeadFrame = { origin: Vec3; axes: [Vec3, Vec3, Vec3]; scale: number };
export type GazeReading = { yaw: number; pitch: number; valid: boolean; left: Vec3; right: Vec3 };
export type EyeModel = { baseline: EyeObservation; left: Vec3; right: Vec3; radius: number };
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3) => mul(a, 1 / Math.max(length(a), 1e-9));
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const mean = (points: Vec3[]) => mul(points.reduce(add, { x: 0, y: 0, z: 0 }), 1 / points.length);
const local = (v: Vec3, axes: HeadFrame['axes']): Vec3 => ({ x: dot(v, axes[0]), y: dot(v, axes[1]), z: dot(v, axes[2]) });
const world = (v: Vec3, axes: HeadFrame['axes']) => add(add(mul(axes[0], v.x), mul(axes[1], v.y)), mul(axes[2], v.z));
const noseIndices = [4, 45, 275, 220, 440, 1, 5, 51, 281, 44, 274, 241, 461, 125, 354, 218, 438, 195, 167, 393, 165, 391, 3, 248];

/** Image coordinates: x right, y down, relative z away from the webcam.
 * Webcam3DTracker's nose frame / locked local eye spheres / iris-minus-center
 * method is adapted here. Anatomical axes replace PCA to avoid eigenvector flips.
 * See THIRD_PARTY_NOTICES.md for attribution and the upstream MIT license.
 */
export function observeFace(landmarks: Vec3[], width: number, height: number, time: number): EyeObservation | null {
  if (landmarks.length < 478) return null;
  const p = (i: number): Vec3 => ({ x: landmarks[i].x * width, y: landmarks[i].y * height, z: landmarks[i].z * width });
  const nose = noseIndices.map(p);
  if (!nose.every(v => [v.x, v.y, v.z].every(Number.isFinite))) return null;
  const x = unit(sub(mean([p(275), p(440), p(281)]), mean([p(45), p(220), p(51)])));
  const down = sub(p(4), p(168));
  const y = unit(sub(down, mul(x, dot(down, x))));
  const z = unit(cross(x, y));
  if (length(x) < 0.99 || length(y) < 0.99 || z.z < 0.3) return null;
  let scale = 0, pairs = 0;
  for (let i = 0; i < nose.length; i++) for (let j = i + 1; j < nose.length; j++) { scale += length(sub(nose[i], nose[j])); pairs++; }
  scale /= pairs;
  const left = p(473), right = p(468), center = mul(add(left, right), 0.5);
  const span = length(sub(left, right));
  // Require both eyes open: a blink must not become a gaze or depth jump.
  const openness = (top: number, bottom: number, a: number, b: number) => length(sub(p(top), p(bottom))) / Math.max(1, length(sub(p(a), p(b))));
  if (span < 18 || scale < 3 || openness(159, 145, 33, 133) < 0.12 || openness(386, 374, 362, 263) < 0.12 || ![left, right].every(v => [v.x, v.y, v.z].every(Number.isFinite))) return null;
  return { ...center, span, left, right, head: { origin: mean(nose), axes: [x, y, z], scale }, imageWidth: width, imageHeight: height, time };
}

export function averageObservation(samples: EyeObservation[]): EyeObservation {
  const last = samples[samples.length - 1];
  const average = (fn: (s: EyeObservation) => number) => samples.reduce((sum, s) => sum + fn(s), 0) / samples.length;
  const point = (side: 'left' | 'right') => ({ x: average(s => s[side].x), y: average(s => s[side].y), z: average(s => s[side].z ?? 0) });
  const headSamples = samples.flatMap(s => s.head ? [s.head] : []);
  let head: HeadFrame | undefined;
  if (headSamples.length === samples.length) {
    const x = unit(mean(headSamples.map(h => h.axes[0])));
    const z = unit(cross(x, mean(headSamples.map(h => h.axes[1]))));
    head = { origin: mean(headSamples.map(h => h.origin)), axes: [x, unit(cross(z, x)), z], scale: average(s => s.head!.scale) };
  }
  return { ...last, x: average(s => s.x), y: average(s => s.y), span: average(s => s.span), left: point('left'), right: point('right'), head };
}

export function lockEyeModel(baseline: EyeObservation, ipd: number): EyeModel | undefined {
  if (!baseline.head) return undefined;
  // 12 mm anatomical radius prior, scaled by the measured pupil separation.
  const radius = baseline.span / ipd * 0.012;
  const offset = (side: 'left' | 'right') => local(sub({ ...baseline[side], z: (baseline[side].z ?? 0) + radius }, baseline.head!.origin), baseline.head!.axes);
  return { baseline, radius, left: offset('left'), right: offset('right') };
}

export function reconstructEyes(observation: EyeObservation, model: EyeModel, distance: number, ipd: number, selected: 'center' | 'left' | 'right') {
  const head = observation.head, neutral = model.baseline.head;
  if (!head || !neutral) return null;
  const ratio = head.scale / neutral.scale;
  if (!Number.isFinite(ratio) || ratio < 0.35 || ratio > 3) return null;
  const center = (side: 'left' | 'right', frame: HeadFrame, scale: number) => add(frame.origin, world(mul(model[side], scale), frame.axes));
  const left = center('left', head, ratio), right = center('right', head, ratio);
  const neutralCenter = mul(add(center('left', neutral, 1), center('right', neutral, 1)), 0.5);
  const point = selected === 'center' ? mul(add(left, right), 0.5) : selected === 'left' ? left : right;
  const focal = model.baseline.span * distance / ipd;
  const depth = Math.max(0.15, Math.min(1.5, distance / ratio));
  const cx = (model.baseline.imageWidth ?? neutralCenter.x * 2) / 2;
  const cy = (model.baseline.imageHeight ?? neutralCenter.y * 2) / 2;
  const position: EyePosition = { x: ((cx - point.x) * depth - (cx - neutralCenter.x) * distance) / focal, y: ((cy - point.y) * depth - (cy - neutralCenter.y) * distance) / focal, z: depth };
  const ray = (side: 'left' | 'right', origin: Vec3) => sub({ ...observation[side], z: observation[side].z ?? 0 }, origin);
  const l = ray('left', left), r = ray('right', right);
  const ld = unit(l), rd = unit(r);
  const validRay = (v: Vec3) => length(v) > model.radius * ratio * 0.45 && length(v) < model.radius * ratio * 1.8 && unit(v).z < -0.3;
  const valid = validRay(l) && validRay(r) && dot(ld, rd) > 0.75;
  const direction = selected === 'left' ? ld : selected === 'right' ? rd : unit(add(ld, rd));
  const gaze: GazeReading = { yaw: Math.atan2(-direction.x, -direction.z) * 180 / Math.PI, pitch: Math.atan2(-direction.y, Math.hypot(direction.x, direction.z)) * 180 / Math.PI, valid, left: ld, right: rd };
  // Rotation moves the optical viewpoint only millimeters. Gain >1 is an
  // explicit perceptual amplification; the screen projection never rotates.
  const eyeOffset = valid ? { x: -direction.x * 0.006, y: -direction.y * 0.006, z: (direction.z + 1) * 0.006 } : { x: 0, y: 0, z: 0 };
  return { position, eyeOffset, gaze };
}
