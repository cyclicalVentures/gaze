import type { EyeObservation, EyePosition } from './projection';
import type { HeadFrame, Vec3 } from './eye-model';
import { median, solveLinear } from './linear';

// Upper-face anchors avoid mouth/jaw expressions and iris rotation.
export const geometryLandmarks = [4, 6, 168, 197, 195, 5, 33, 133, 263, 362, 127, 356, 234, 454, 93, 323, 10, 67, 297, 54, 284, 103, 332, 21, 251, 162, 389];
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Vec3, n: number): Vec3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const local = (v: Vec3, axes: HeadFrame['axes']): Vec3 => ({ x: dot(v, axes[0]), y: dot(v, axes[1]), z: dot(v, axes[2]) });
export const rotateFacePoint = (v: Vec3, axes: HeadFrame['axes']): Vec3 => add(add(mul(axes[0], v.x), mul(axes[1], v.y)), mul(axes[2], v.z));
export type MetricFaceModel = { points: Vec3[]; origin: Vec3; focal: number; width: number; height: number; headScale: number; left: Vec3; right: Vec3 };
export type MetricPose = { position: EyePosition; translation: Vec3; errorPx: number; inliers: number };
export function projectFacePoint(p: Vec3, focal: number, width: number, height: number) { return { x: width / 2 + focal * p.x / p.z, y: height / 2 + focal * p.y / p.z }; }

/** WebEyeTrack-style metric reconstruction and reprojection refinement.
 * Adaptation: freeze the user's neutral 3D landmark shape, use the measured
 * distance/IPD prior, then robustly refine translation. No fixed 60° camera FOV,
 * per-frame face rescaling, integer rounding or neural-network dependency.
 * The upstream method and MIT license are recorded in THIRD_PARTY_NOTICES.md.
 */
export function lockMetricFace(baseline: EyeObservation, distance: number, ipd: number): MetricFaceModel | null {
  if (!baseline.face || !baseline.head || !baseline.imageWidth || !baseline.imageHeight || baseline.face.length !== geometryLandmarks.length) return null;
  const focal = baseline.span * distance / ipd, scale = ipd / baseline.span;
  const irisZ = ((baseline.left.z ?? 0) + (baseline.right.z ?? 0)) / 2;
  const cameraPoint = (p: { x: number; y: number; z?: number }): Vec3 => {
    const z = distance + ((p.z ?? irisZ) - irisZ) * scale;
    return { x: (p.x - baseline.imageWidth! / 2) * z / focal, y: (p.y - baseline.imageHeight! / 2) * z / focal, z };
  };
  const left = cameraPoint(baseline.left), right = cameraPoint(baseline.right), origin = mul(add(left, right), 0.5);
  const points = baseline.face.map(p => local(sub(cameraPoint(p), origin), baseline.head!.axes));
  if (![focal, ...points.flatMap(p => [p.x, p.y, p.z])].every(Number.isFinite) || focal < 50) return null;
  return { points, origin, focal, width: baseline.imageWidth, height: baseline.imageHeight, headScale: baseline.head.scale, left: local(sub(left, origin), baseline.head.axes), right: local(sub(right, origin), baseline.head.axes) };
}

/** Bounded radial correction, adapted from WebEyeTrack's depth refinement.
 * Median radii limit isolated landmark influence; units here are meters.
 */
export function refineRadialDepth(projected: { x: number; y: number }[], observed: { x: number; y: number }[], depth: number) {
  const radii = (points: { x: number; y: number }[]) => {
    const x = median(points.map(p => p.x)), y = median(points.map(p => p.y));
    return median(points.map(p => Math.hypot(p.x - x, p.y - y)));
  };
  const actual = radii(observed), predicted = radii(projected);
  if (actual < 3 || !Number.isFinite(actual + predicted)) return depth;
  return depth + Math.max(-0.05, Math.min(0.05, depth * (predicted / actual - 1) * 0.7));
}

export function fitMetricFace(observation: EyeObservation, model: MetricFaceModel, eye: 'center' | 'left' | 'right' = 'center'): MetricPose | null {
  const face = observation.face, head = observation.head;
  if (!face || !head || face.length !== model.points.length || observation.imageWidth !== model.width || observation.imageHeight !== model.height || !face.every(p => Number.isFinite(p.x + p.y))) return null;
  const shape = model.points.map(p => rotateFacePoint(p, head.axes));
  const z = Math.max(0.15, Math.min(1.5, model.origin.z * model.headScale / head.scale));
  const centerX = median(face.map(p => p.x)), centerY = median(face.map(p => p.y));
  let translation = { x: (centerX - model.width / 2) * z / model.focal - median(shape.map(p => p.x)), y: (centerY - model.height / 2) * z / model.focal - median(shape.map(p => p.y)), z };
  const projected = () => shape.map(p => projectFacePoint(add(p, translation), model.focal, model.width, model.height));
  for (let i = 0; i < 4; i++) translation.z = refineRadialDepth(projected(), face, translation.z);
  // Refine XYZ using the projection Jacobian, with Huber residual weights.
  for (let iteration = 0; iteration < 12; iteration++) {
    const normal = Array.from({ length: 3 }, () => [0, 0, 0]), rhs = [0, 0, 0];
    for (let i = 0; i < shape.length; i++) {
      const p = add(shape[i], translation);
      if (p.z <= 0.04) return null;
      const projectedPoint = projectFacePoint(p, model.focal, model.width, model.height);
      const residual = [face[i].x - projectedPoint.x, face[i].y - projectedPoint.y];
      const weight = Math.min(1, 4 / Math.max(1e-6, Math.hypot(...residual)));
      const j = [[model.focal / p.z, 0, -model.focal * p.x / (p.z * p.z)], [0, model.focal / p.z, -model.focal * p.y / (p.z * p.z)]];
      for (let axis = 0; axis < 3; axis++) for (let row = 0; row < 2; row++) {
        rhs[axis] += weight * j[row][axis] * residual[row];
        for (let column = 0; column < 3; column++) normal[axis][column] += weight * j[row][axis] * j[row][column];
      }
    }
    for (let i = 0; i < 3; i++) normal[i][i] += 1e-5;
    const delta = solveLinear(normal, rhs);
    if (!delta) return null;
    translation = add(translation, { x: Math.max(-0.05, Math.min(0.05, delta[0])), y: Math.max(-0.05, Math.min(0.05, delta[1])), z: Math.max(-0.08, Math.min(0.08, delta[2])) });
    if (Math.hypot(...delta) < 1e-5) break;
  }
  const errors = projected().map((p, i) => Math.hypot(p.x - face[i].x, p.y - face[i].y));
  const threshold = Math.max(4, median(errors) * 2.5), inliers = errors.filter(e => e <= threshold);
  const errorPx = Math.sqrt(inliers.reduce((sum, e) => sum + e * e, 0) / inliers.length);
  if (!Number.isFinite(errorPx) || errorPx > Math.max(4, observation.span * 0.08) || inliers.length < face.length * 0.75 || translation.z < 0.15 || translation.z > 1.5) return null;
  const point = eye === 'center' ? translation : add(translation, rotateFacePoint(model[eye], head.axes));
  return { position: { x: model.origin.x - point.x, y: model.origin.y - point.y, z: point.z }, translation, errorPx, inliers: inliers.length };
}
