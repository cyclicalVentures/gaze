import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationDistances, DistanceCalibrationSession } from '../lib/viewer/distance-calibration';
import { combineDistanceProfiles, predictGaze, trainingTargets, validationTargets, type GazePlane, type Point } from '../lib/viewer/gaze-calibration';
const targets=[...trainingTargets,...validationTargets];
const biased=(p:Point,depth:number)=>({x:p.x*.7+.1+depth*.2,y:p.y*.8-.05+depth*.1});
function runCalibration(badLevel=-1) {
  const session=new DistanceCalibrationSession(1,calibrationDistances(.55),targets,1200,800);
  let time=1000;
  for (let frames=0;frames<6000 && session.phase!=='results' && session.phase!=='error';frames++) {
    const point=targets[session.index],distance=session.step.distance,signal=biased(point,distance);
    if (session.phase==='checking' && session.level===badLevel) signal.x+=.7;
    session.push({time:time+=33,revision:1,distance,signal});
    if (session.phase==='positioning' && session.positioned) session.beginDistance();
  }
  return session;
}
void test('three-distance capture completes 27 learning targets and validates 15 held-out positions',()=>{
  const session=runCalibration();assert.equal(session.phase,'results');
  const result=session.result!;assert.equal(result.usable,true);assert.equal(result.checks.length,3);
  assert.ok(result.checks.every(c=>c.validation.targets.length===5 && c.validation.samples>=75 && c.validation.meanPx<5));
  for (const distance of [.43,.5,.55,.6,.67]) for (const target of validationTargets) {
    const predicted=predictGaze(result.profile,biased(target,distance),distance);
    assert.ok(Math.hypot(predicted.x-target.x,predicted.y-target.y)<.004);
  }
});
void test('a failed distance blocks the entire save and held-out data never changes fitted coefficients',()=>{
  const good=runCalibration().result!,bad=runCalibration(1).result!;
  assert.equal(bad.usable,false);assert.equal(bad.checks[1].validation.usable,false);
  assert.deepEqual(good.profile,bad.profile);
});
void test('positioning, depth drift, pauses, stale revisions and frame gaps cannot complete a fixation',()=>{
  const s=new DistanceCalibrationSession(1,calibrationDistances(.55),targets,1200,800);
  let time=1000;
  const push=(distance=.55,revision=1)=>s.push({time:time+=33,revision,distance,signal:{x:.5,y:.5}});
  for(let i=0;i<100;i++) push(.8);
  assert.equal(s.beginDistance(),false);assert.equal(s.index,0);
  for(let i=0;i<25;i++) push();assert.equal(s.beginDistance(),true);
  for(let i=0;i<40;i++) push();assert.ok(s.progress>0);
  push(.6);assert.equal(s.progress,0);
  for(let i=0;i<45;i++) push();assert.equal(s.index,0);
  s.resetFixation();for(let i=0;i<40;i++) push();assert.equal(s.index,0);
  time+=500;push();assert.equal(s.progress,0);
  for(let i=0;i<60;i++) push(.55,2);assert.equal(s.index,0);
  for(let i=0;i<55;i++) push();assert.equal(s.index,1);
});
void test('distance interpolation is continuous, clamps at endpoints and rejects collapsed depth bands',()=>{
  const plane=(x:number):GazePlane=>({mean:{x:0,y:0},scale:{x:1,y:1},x:[x,0,0,0,0,0],y:[.5,0,0,0,0,0],width:1200,height:800});
  const layers=[{distance:.7,profile:plane(.8)},{distance:.4,profile:plane(.2)},{distance:.55,profile:plane(.5)}];
  const profile=combineDistanceProfiles(layers)!;
  assert.equal(layers[0].distance,.7);
  assert.equal(predictGaze(profile,{x:0,y:0},.1).x,.2);
  assert.equal(predictGaze(profile,{x:0,y:0},2).x,.8);
  assert.ok(Math.abs(predictGaze(profile,{x:0,y:0},.475).x-.35)<1e-12);
  assert.ok(Math.abs(predictGaze(profile,{x:0,y:0},.55-1e-7).x-predictGaze(profile,{x:0,y:0},.55+1e-7).x)<1e-6);
  assert.equal(combineDistanceProfiles(layers.slice(1)),null);
  assert.equal(combineDistanceProfiles(layers.map(l=>({...l,distance:.55}))),null);
  for(const neutral of [.15,.4,.55,1.5]) {
    const distances=calibrationDistances(neutral).map(s=>s.distance).sort((a,b)=>a-b);
    assert.ok(distances[0]>=.15 && distances[2]<=1.5 && distances[1]-distances[0]>.055 && distances[2]-distances[1]>.055);
  }
});
