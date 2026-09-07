import test from 'node:test';
import assert from 'node:assert/strict';
import { FixationCollector, calibratedEyeOffset, fitGazeProfile, gazeSignal, predictGaze, trainingTargets, validationTargets, validateGaze, type Point, type TargetSamples } from '../lib/viewer/gaze-calibration';
const signal=(p:Point)=>({x:p.x*.6+p.y*.1+.15,y:p.y*.7-p.x*.08+.1});
const rows=(targets:Point[]):TargetSamples[]=>targets.map(target=>({target,samples:Array.from({length:25},(_,i)=>({time:1000+i*33,revision:1,distance:.55,signal:signal(target)}))}));
void test('personal gaze mapping predicts unseen targets with an affine sensor bias',()=>{
  const profile=fitGazeProfile(rows(trainingTargets),1200,800)!;
  assert.ok(profile);
  for(const target of validationTargets) {const p=predictGaze(profile,signal(target));assert.ok(Math.hypot(p.x-target.x,p.y-target.y)<.003);}
  const validation=validateGaze(profile,rows(validationTargets));
  assert.equal(validation.usable,true); assert.ok(validation.meanPx<4); assert.equal(validation.samples,125);
});
void test('held-out errors cannot train or mutate the candidate profile',()=>{
  const profile=fitGazeProfile(rows(trainingTargets),1200,800)!,before=JSON.stringify(profile),heldOut=rows(validationTargets);
  heldOut.forEach(t=>{t.target={x:1.5,y:1.5};});
  const validation=validateGaze(profile,heldOut);
  assert.equal(validation.usable,false); assert.ok(validation.meanPx>500); assert.equal(JSON.stringify(profile),before);
  assert.equal(validateGaze(profile,heldOut.slice(0,4)).usable,false);
});
void test('calibration rejects constant gaze, insufficient samples and nonfinite signals',()=>{
  const constant=rows(trainingTargets); constant.forEach(t=>t.samples.forEach(s=>{s.signal={x:.5,y:.5};}));
  assert.equal(fitGazeProfile(constant,1200,800),null);
  const short=rows(trainingTargets);short[3].samples=[];assert.equal(fitGazeProfile(short,1200,800),null);
  const bad=rows(trainingTargets);bad[1].samples[0].signal.x=NaN;assert.equal(fitGazeProfile(bad,1200,800),null);
});
void test('fixation collector ignores duplicate frames, waits for settling and restarts after a blink',()=>{
  const collector=new FixationCollector(),frame=(time:number)=>({time,revision:1,distance:.55,signal:{x:.5,y:.5}});
  for(let i=0;i<25;i++) assert.equal(collector.push(frame(1000+i*33)).samples,null);
  for(let i=0;i<100;i++) assert.equal(collector.push(frame(1792)).samples,null);
  assert.equal(collector.push(frame(2400)).progress,0);
  let samples=null;
  for(let i=1;i<51;i++) samples=collector.push(frame(2400+i*33)).samples;
  assert.ok(samples);assert.ok(samples.length>=15);assert.ok(samples.every(s=>s.time>=3200));
  collector.reset();assert.equal(collector.push(frame(5000)).samples,null);
});
void test('gaze intersection compensates measured head translation and optical movement stays millimetric',()=>{
  const screen={width:1000,height:800,metersPerPixel:.0003,center:{x:500,y:400}},target={x:.7,y:.3};
  for(const head of [{x:0,y:0,z:.55},{x:.03,y:-.02,z:.4}]) {
    const v={x:head.x-(target.x*1000-500)*screen.metersPerPixel,y:head.y+(target.y*800-400)*screen.metersPerPixel,z:-head.z};
    const length=Math.hypot(v.x,v.y,v.z),ray={x:v.x/length,y:v.y/length,z:v.z/length};
    const result=gazeSignal(head,{left:ray,right:ray,yaw:0,pitch:0,valid:true},screen)!;
    assert.ok(Math.abs(result.x-target.x)+Math.abs(result.y-target.y)<1e-9);
    const offset=calibratedEyeOffset(head,target,screen);assert.ok(offset.x>0);assert.ok(Math.hypot(offset.x,offset.y,offset.z)<.006);
  }
});
