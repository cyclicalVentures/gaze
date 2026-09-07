import test from 'node:test';
import assert from 'node:assert/strict';
import { HandGestures, observeHand, type GestureResult } from '../lib/viewer/hand-gestures';
import { hand, handFrame } from './fixtures/hands';
function harness(two=false) {
  const gestures=new HandGestures();let time=1000;
  const push=(hands=two ? [hand(.3,.45,true),hand(.7,.45,true)] : [hand(.5,.45,true)],gap=66)=>gestures.update(handFrame(time+=gap,hands));
  push(two ? [hand(.3),hand(.7)] : [hand()]);
  for(let i=0;i<5;i++) push();
  return {gestures,push};
}
void test('an open hand is inert and a held pinch must release before acquiring the model',()=>{
  const gestures=new HandGestures();let time=1000;
  for(let i=0;i<20;i++) assert.equal(gestures.update(handFrame(time+=66,[hand(.4+i*.005,.45,true)])).delta,null);
  for(let i=0;i<20;i++) {const result=gestures.update(handFrame(time+=66,[hand(.5)]));assert.equal(result.mode,'idle');assert.equal(result.delta,null);}
  const a=gestures.update(handFrame(time+=66,[hand(.5,.45,true)]));assert.equal(a.mode,'arming');assert.equal(a.delta,null);
  assert.equal(gestures.update(handFrame(time+=66,[hand(.52,.45,true)])).delta,null);
  assert.equal(gestures.update(handFrame(time+=66,[hand(.54,.45,true)])).delta,null);
  const b=gestures.update(handFrame(time+=66,[hand(.56,.45,true)]));assert.equal(b.mode,'rotate');assert.ok(b.delta!.rotation.y>0);
});
void test('one-hand pinch drag has mirrored screen directions; releasing freezes with hysteresis',()=>{
  const {push}=harness();
  const result=push([hand(.53,.48,true)]);assert.equal(result.mode,'rotate');assert.ok(result.delta!.rotation.y>0);assert.ok(result.delta!.rotation.x>0);assert.equal(result.delta!.scale,1);
  assert.equal(push([hand(.53,.48,true,.4)]).mode,'rotate');
  assert.equal(push([hand(.6,.48,false)]).delta,null);
  for(let i=0;i<10;i++) assert.equal(push([hand(.6+i*.01,.48,false)]).delta,null);
});
void test('two pinches scale and twist without translating or changing yaw; detection order is irrelevant',()=>{
  const {push}=harness(true);
  const result=push([hand(.73,.48,true),hand(.27,.42,true)]);
  assert.equal(result.mode,'scale');assert.ok(result.delta!.scale>1);assert.ok(result.delta!.rotation.z<0);
  assert.equal(result.delta!.rotation.x,0);assert.equal(result.delta!.rotation.y,0);
  let last:GestureResult=result;
  for(let i=0;i<8;i++) last=push([hand(.73,.48,true),hand(.27,.42,true)]);
  assert.ok(Math.abs(last.delta!.scale-1)<.0001);
  assert.ok(push([hand(.32,.45,true),hand(.68,.45,true)]).delta!.scale<1);
});
void test('loss, stale frames, discontinuities, crossed grips and dropping one pinch release manipulation',()=>{
  for(const lost of [[],[hand(.9,.45,true)],[hand(.5,.45,true)]]) {
    const {push}=harness(true);assert.equal(push(lost).delta,null);
    for(let i=0;i<6;i++) assert.equal(push().delta,null);
  }
  const {push}=harness();assert.equal(push([hand(.55,.45,true)],400).delta,null);
  assert.equal(push([hand(.56,.45,true)]).delta,null);
  const two=harness(true);assert.equal(two.push([hand(.3,.45,true),hand(.7,.45,false)]).delta,null);
  assert.equal(two.push([hand(.35,.45,true),hand(.7,.45,false)]).delta,null);
  const duplicate=new HandGestures();duplicate.update(handFrame(1000,[hand()]));assert.equal(duplicate.update(handFrame(1000,[hand(.6,.45,true)])).delta,null);
});
void test('switching from one pinch to two rebases without an immediate size or rotation jump',()=>{
  const {push}=harness();
  push([hand(.5,.45,true),hand(.75)]);
  assert.equal(push([hand(.5,.45,true),hand(.75,.45,true)]).delta,null);
  for(let i=0;i<4;i++) push([hand(.5,.45,true),hand(.75,.45,true)]);
  const result=push([hand(.48,.45,true),hand(.77,.45,true)]);assert.equal(result.mode,'scale');assert.ok(result.delta!.scale>1);
});
void test('aspect-correct pinch observations reject tiny, cropped, incomplete and nonfinite hands',()=>{
  assert.ok(Math.abs(observeHand(hand(.6,.45,true),.75)!.grip.x-.6)<1e-9);
  assert.ok(Math.abs(observeHand(hand(.6,.45,true),.75)!.ratio-.15)<1e-9);
  assert.equal(observeHand(hand().slice(0,20),.75),null);
  const bad=hand();bad[4].x=NaN;assert.equal(observeHand(bad,.75),null);
  const cropped=hand();cropped[8].x=1.2;assert.equal(observeHand(cropped,.75),null);
  const tiny=hand().map(p=>({x:.5+(p.x-.5)*.1,y:.5+(p.y-.5)*.1,z:0}));assert.equal(observeHand(tiny,.75),null);
});
void test('explicit reset and camera-aspect changes require release, with no residual movement',()=>{
  const {gestures,push}=harness();gestures.reset();assert.equal(push([hand(.6,.45,true)]).delta,null);
  const second=harness();assert.equal(second.gestures.update({...handFrame(10000,[hand(.6,.45,true)]),width:480,height:640}).delta,null);
});
