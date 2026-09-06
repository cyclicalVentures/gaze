import { PerspectiveCamera } from 'three';
import type { HeadFrame } from './eye-model';
import type { Vec3 } from './eye-model';
export type EyePosition = { x: number; y: number; z: number };
/** Screen is the XY plane at z=0; content is behind it (negative Z). All units are meters. */
export function applyOffAxis(camera: PerspectiveCamera, eye: EyePosition, width: number, height: number) {
  if (![eye.x, eye.y, eye.z, width, height].every(Number.isFinite) || eye.z <= 0 || width <= 0 || height <= 0) throw new Error('Invalid physical viewing geometry.');
  const near = 0.005, far = 100;
  const ratio = near / eye.z;
  camera.position.set(eye.x, eye.y, eye.z);
  // Rotating toward the model would destroy the fixed-window projection.
  camera.quaternion.identity();
  camera.near = near; camera.far = far;
  camera.projectionMatrix.makePerspective((-width / 2 - eye.x) * ratio, (width / 2 - eye.x) * ratio, (height / 2 - eye.y) * ratio, (-height / 2 - eye.y) * ratio, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld();
}

/** Casiez et al., One Euro Filter: low jitter at rest, lower lag during motion. */
export class OneEuroFilter {
  private value?: number;
  private raw?: number;
  private derivative = 0;
  private time?: number;
  constructor(private minCutoff = 1.8, private beta = 10) {}
  setCutoff(value: number) { this.minCutoff = value; }
  reset() { this.value = this.raw = this.time = undefined; this.derivative = 0; }
  filter(value: number, seconds: number) {
    if (this.value === undefined || this.time === undefined || this.raw === undefined) {
      this.value = this.raw = value; this.time = seconds; return value;
    }
    const dt = Math.max(1 / 240, Math.min(0.2, seconds - this.time));
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.derivative += alpha(1) * ((value - this.raw) / dt - this.derivative);
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.value);
    this.raw = value; this.time = seconds; return this.value;
  }
}
export type EyeObservation = { x: number; y: number; span: number; left: { x: number; y: number; z?: number }; right: { x: number; y: number; z?: number }; head?: HeadFrame; face?: Vec3[]; time: number; imageWidth?: number; imageHeight?: number };
export function estimateEye(observation: EyeObservation, baseline: EyeObservation, distance: number, ipd: number, eye: 'center' | 'left' | 'right' = 'center'): EyePosition {
  if (observation.span <= 0 || baseline.span <= 0 || distance <= 0 || ipd <= 0) throw new Error('Invalid eye calibration.');
  const z = Math.max(0.15, Math.min(1.5, distance * baseline.span / observation.span));
  const focal = baseline.span * distance / ipd;
  const point = eye === 'center' ? observation : observation[eye];
  // Account for a webcam above/beside the viewport. With forward motion the
  // neutral point changes image coordinates; differencing pixels alone would
  // incorrectly turn that into vertical/horizontal head movement.
  const cx = baseline.imageWidth ? baseline.imageWidth / 2 : baseline.x;
  const cy = baseline.imageHeight ? baseline.imageHeight / 2 : baseline.y;
  const x = ((cx - point.x) * z - (cx - baseline.x) * distance) / focal;
  const y = ((cy - point.y) * z - (cy - baseline.y) * distance) / focal;
  return { x: Math.max(-0.45, Math.min(0.45, x)), y: Math.max(-0.35, Math.min(0.35, y)), z };
}
