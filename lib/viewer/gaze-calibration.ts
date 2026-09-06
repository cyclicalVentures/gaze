import type { GazeReading } from './eye-model';
import type { EyePosition } from './projection';
import { median, solveLinear } from './linear';

export type Point = { x: number; y: number };
export type ScreenGeometry = { width: number; height: number; metersPerPixel: number; center: Point };
export type GazeSample = { time: number; signal: Point; revision: number };
export type TargetSamples = { target: Point; samples: GazeSample[] };
export type GazeProfile = { mean: Point; scale: Point; x: number[]; y: number[]; width: number; height: number };
export type GazeValidation = { meanPx: number; p95Px: number; worstTargetPx: number; targets: { target: Point; predicted: Point; errorPx: number }[]; samples: number; usable: boolean };
export const trainingTargets: Point[] = [[.5,.5],[.12,.12],[.5,.12],[.88,.12],[.88,.5],[.88,.88],[.5,.88],[.12,.88],[.12,.5]].map(([x,y]) => ({x,y}));
export const validationTargets: Point[] = [[.3,.3],[.7,.3],[.7,.7],[.3,.7],[.6,.45]].map(([x,y]) => ({x,y}));

/** Intersect the measured eye ray with the screen before learning personal bias.
 * Image axes point right/down; screen axes point left/up from the webcam view.
 * Use measured head depth here, never the user's perceptual depth reversal.
 */
export function gazeSignal(head: EyePosition, gaze: GazeReading, screen: ScreenGeometry): Point | null {
  if (!gaze.valid) return null;
  const ray = { x: (gaze.left.x + gaze.right.x) / 2, y: (gaze.left.y + gaze.right.y) / 2, z: (gaze.left.z + gaze.right.z) / 2 };
  if (ray.z > -.3) return null;
  const x = head.x + head.z * ray.x / ray.z, y = head.y + head.z * ray.y / ray.z;
  const signal = { x: (screen.center.x + x / screen.metersPerPixel) / screen.width, y: (screen.center.y - y / screen.metersPerPixel) / screen.height };
  return Number.isFinite(signal.x + signal.y) ? signal : null;
}
const average = (points: Point[]): Point => ({ x: points.reduce((s,p) => s+p.x,0)/points.length, y: points.reduce((s,p) => s+p.y,0)/points.length });
function terms(point: Point, mean: Point, scale: Point) { const x=(point.x-mean.x)/scale.x, y=(point.y-mean.y)/scale.y; return [1,x,y,x*x,x*y,y*y]; }

/** Equal weight per target, with robust medians; validation data never enters fit. */
export function fitGazeProfile(training: TargetSamples[], width: number, height: number): GazeProfile | null {
  if (training.length !== 9 || training.some(t => t.samples.length < 15 || t.samples.some(s => !Number.isFinite(s.signal.x+s.signal.y)))) return null;
  const points = training.map(t => ({ x: median(t.samples.map(s=>s.signal.x)), y: median(t.samples.map(s=>s.signal.y)) }));
  const mean=average(points), scale={ x:Math.sqrt(points.reduce((s,p)=>s+(p.x-mean.x)**2,0)/points.length), y:Math.sqrt(points.reduce((s,p)=>s+(p.y-mean.y)**2,0)/points.length) };
  if (scale.x < .015 || scale.y < .015 || width <= 0 || height <= 0) return null;
  const rows=points.map(p=>terms(p,mean,scale));
  const normal=Array.from({length:6},(_,i)=>Array.from({length:6},(_,j)=>rows.reduce((s,r)=>s+r[i]*r[j],0)+(i===j && i>0 ? .03 : 0)));
  const solve=(axis:'x'|'y')=>solveLinear(normal,Array.from({length:6},(_,i)=>rows.reduce((s,r,j)=>s+r[i]*training[j].target[axis],0)));
  const x=solve('x'),y=solve('y');
  return x && y ? {mean,scale,x,y,width,height} : null;
}
export function predictGaze(profile: GazeProfile, signal: Point): Point {
  const row=terms(signal,profile.mean,profile.scale), predict=(weights:number[])=>weights.reduce((s,w,i)=>s+w*row[i],0);
  return {x:predict(profile.x),y:predict(profile.y)};
}
export function validateGaze(profile: GazeProfile, heldOut: TargetSamples[]): GazeValidation {
  const errors:number[]=[];
  const distance=(a:Point,b:Point)=>Math.hypot((a.x-b.x)*profile.width,(a.y-b.y)*profile.height);
  const targets=heldOut.map(t=>{
    const predictions=t.samples.map(s=>predictGaze(profile,s.signal));
    errors.push(...predictions.map(p=>distance(p,t.target)));
    const predicted=average(predictions); return {target:t.target,predicted,errorPx:distance(predicted,t.target)};
  });
  errors.sort((a,b)=>a-b);
  const meanPx=errors.reduce((a,b)=>a+b,0)/errors.length,p95Px=errors[Math.max(0,Math.ceil(errors.length*.95)-1)],worstTargetPx=Math.max(...targets.map(t=>t.errorPx));
  const diagonal=Math.hypot(profile.width,profile.height);
  const usable=heldOut.length===5 && heldOut.every(t=>t.samples.length>=15) && Number.isFinite(meanPx+p95Px+worstTargetPx) && meanPx<diagonal*.12 && p95Px<diagonal*.22 && worstTargetPx<diagonal*.2;
  return {meanPx,p95Px,worstTargetPx,targets,samples:errors.length,usable};
}
export function calibratedEyeOffset(head: EyePosition, target: Point, screen: ScreenGeometry): EyePosition {
  const x=(target.x*screen.width-screen.center.x)*screen.metersPerPixel-head.x;
  const y=-(target.y*screen.height-screen.center.y)*screen.metersPerPixel-head.y;
  const z=-head.z, length=Math.hypot(x,y,z);
  return {x:x/length*.006,y:y/length*.006,z:(z/length+1)*.006};
}

/** A fixation needs continuous, unique frames after an 800ms settling period.
 * A blink/gap restarts only this fixation, not previously completed targets.
 */
export class FixationCollector {
  private first=0;
  private last=-Infinity;
  private samples:GazeSample[]=[];
  reset() { this.first=0; this.last=-Infinity; this.samples=[]; }
  push(sample:GazeSample): { progress:number; samples:GazeSample[] | null } {
    if (sample.time<=this.last) return {progress:0,samples:null};
    if (sample.time-this.last>220 || !this.first) { this.first=sample.time; this.samples=[]; }
    this.last=sample.time;
    const elapsed=sample.time-this.first;
    if (elapsed>=800) this.samples.push(sample);
    const complete=elapsed>=1600 && this.samples.length>=15;
    return {progress:Math.min(1,Math.max(0,(elapsed-800)/800)),samples:complete ? [...this.samples] : null};
  }
}
