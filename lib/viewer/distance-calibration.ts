import { FixationCollector, combineDistanceProfiles, fitGazeProfile, validateGaze, type GazeProfile, type GazeSample, type GazeValidation, type Point, type TargetSamples } from './gaze-calibration';
import { median } from './linear';

export const distanceTolerance = .025;
export type DistanceStep = { label: string; distance: number };
export type DistanceCheck = DistanceStep & { validation: GazeValidation };
export type DistanceResult = { profile: GazeProfile; checks: DistanceCheck[]; usable: boolean; meanPx: number };
export function calibrationDistances(neutral: number): DistanceStep[] {
  // Leave room for three distinct, achievable bands even at the physical input limits.
  const normal=Math.max(.25,Math.min(1.3,neutral)), spread=Math.max(.08,Math.min(.15,normal*.22));
  return [{label:'Normal',distance:normal},{label:'Near',distance:normal-spread},{label:'Far',distance:normal+spread}];
}

/** Shared capture state machine: a change in depth can never complete a fixation. */
export class DistanceCalibrationSession {
  phase: 'positioning'|'training'|'checking'|'results'|'error' = 'positioning';
  level=0;
  index=0;
  progress=0;
  measured: number | null=null;
  inRange=false;
  positioned=false;
  error='';
  result: DistanceResult | null=null;
  private stableSince: number | null=null;
  private lastTime=-Infinity;
  private collector=new FixationCollector();
  private rows: TargetSamples[][]=[[],[],[]];
  private layers: NonNullable<GazeProfile['layers']>=[];
  constructor(readonly revision: number, readonly steps: DistanceStep[], readonly targets: Point[], readonly width: number, readonly height: number) {}
  get step() { return this.steps[this.level]; }
  resetFixation() { this.collector.reset(); this.progress=0; this.stableSince=null; this.positioned=false; this.inRange=false; }
  beginDistance() {
    if (this.phase!=='positioning' || !this.positioned) return false;
    this.phase='training'; this.collector.reset(); return true;
  }
  push(sample: GazeSample) {
    if (sample.revision!==this.revision || this.phase==='results' || this.phase==='error' || sample.time<=this.lastTime) return;
    if (sample.time-this.lastTime>220) this.resetFixation();
    this.lastTime=sample.time;
    this.measured=Number.isFinite(sample.distance) ? sample.distance : null;
    this.inRange=this.measured!==null && Math.abs(this.measured-this.step.distance)<=distanceTolerance;
    if (!this.inRange) { this.resetFixation(); return; }
    if (this.stableSince===null) this.stableSince=sample.time;
    this.positioned=sample.time-this.stableSince>=600;
    if (this.phase==='positioning') return;
    const capture=this.collector.push(sample); this.progress=capture.progress;
    if (!capture.samples) return;
    this.rows[this.level].push({target:this.targets[this.index],samples:capture.samples});
    this.index++; this.collector.reset(); this.progress=0;
    if (this.index===9) {
      const training=this.rows[this.level];
      const profile=fitGazeProfile(training,this.width,this.height);
      if (!profile) { this.phase='error'; this.error='We could not distinguish the targets at this distance. Try even lighting and look directly at each dot.'; return; }
      this.layers.push({distance:median(training.flatMap(t=>t.samples.map(s=>s.distance))),profile});
      this.phase='checking';
    } else if (this.index===14) {
      if (this.level<2) { this.level++; this.index=0; this.phase='positioning'; this.resetFixation(); return; }
      const profile=combineDistanceProfiles(this.layers);
      if (!profile) { this.phase='error'; this.error='The viewing distances were too similar. Try again and hold each requested distance.'; return; }
      // Check the final blended model, with every held-out frame's actual measured depth.
      const checks=this.steps.map((step,i)=>({...step,distance:this.layers[i].distance,validation:validateGaze(profile,this.rows[i].slice(9))}));
      const count=checks.reduce((sum,c)=>sum+c.validation.samples,0);
      this.result={profile,checks,usable:checks.every(c=>c.validation.usable),meanPx:checks.reduce((sum,c)=>sum+c.validation.meanPx*c.validation.samples,0)/count};
      this.phase='results';
    }
  }
}
