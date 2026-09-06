import test from 'node:test';
import assert from 'node:assert/strict';
import { fitMetricFace, geometryLandmarks, lockMetricFace, projectFacePoint, refineRadialDepth, rotateFacePoint } from '../lib/viewer/metric-face';
import type { HeadFrame, Vec3 } from '../lib/viewer/eye-model';
import type { EyeObservation } from '../lib/viewer/projection';

const axes: HeadFrame['axes']=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
const add=(a:Vec3,b:Vec3)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export function metricFixture() {
  const distance=.55,ipd=.063,focal=600,width=640,height=480,origin={x:.02,y:.045,z:distance};
  const shape=geometryLandmarks.map((_,i)=>({x:((i%3)-1)*.04,y:(Math.floor(i/3)-4)*.013,z:Math.sin(i*2)*.012}));
  const point=(p:Vec3)=>({...projectFacePoint(add(p,origin),focal,width,height),z:p.z*focal/distance});
  const left=point({x:ipd/2,y:0,z:0}),right=point({x:-ipd/2,y:0,z:0});
  const baseline:EyeObservation={x:(left.x+right.x)/2,y:left.y,span:ipd*focal/distance,left,right,head:{origin:{x:340,y:310,z:0},axes,scale:24},face:shape.map(point),imageWidth:width,imageHeight:height,time:1000};
  const model=lockMetricFace(baseline,distance,ipd)!;
  const observation=(translation:Vec3,rotation=axes):EyeObservation=>({...baseline,head:{...baseline.head!,axes:rotation,scale:24*distance/translation.z},span:baseline.span*distance/translation.z,face:model.points.map(p=>({...projectFacePoint(add(rotateFacePoint(p,rotation),translation),focal,width,height),z:0}))});
  return {baseline,model,observation,origin};
}
void test('metric reconstruction recovers neutral position and approach with an off-center webcam',()=>{
  const f=metricFixture();
  const neutral=fitMetricFace(f.baseline,f.model)!;
  assert.ok(Math.abs(neutral.position.x)+Math.abs(neutral.position.y)+Math.abs(neutral.position.z-.55)<1e-8);
  for (const z of [.3,.4,.8,1.2]) {
    const result=fitMetricFace(f.observation({...f.origin,z}),f.model)!;
    assert.ok(result); assert.ok(Math.abs(result.position.z-z)<1e-5);
    assert.ok(Math.abs(result.position.x)+Math.abs(result.position.y)<1e-5,'forward motion must not create sideways drift');
  }
});
void test('rigid head rotation does not masquerade as forward motion',()=>{
  const f=metricFixture();
  for (const angle of [-.45,.45]) {
    const c=Math.cos(angle),s=Math.sin(angle),rotation:HeadFrame['axes']=[{x:c,y:0,z:-s},{x:0,y:1,z:0},{x:s,y:0,z:c}];
    const o=f.observation(f.origin,rotation);
    o.head!.scale*=1.15; // Deliberately wrong scale-only depth prior.
    const result=fitMetricFace(o,f.model)!;
    assert.ok(result); assert.ok(Math.abs(result.position.z-.55)<1e-5); assert.ok(result.errorPx<.001);
  }
});
void test('reprojection fit recovers translation despite isolated landmark outliers',()=>{
  const f=metricFixture(),translation={x:-.025,y:.06,z:.42},o=f.observation(translation);
  for (const i of [0,7,22]) { o.face![i].x+=70; o.face![i].y-=40; }
  const result=fitMetricFace(o,f.model)!;
  assert.ok(result); assert.ok(Math.abs(result.position.z-.42)<.005); assert.ok(Math.abs(result.position.x-.045)<.002); assert.equal(result.inliers,24);
});
void test('invalid geometry, changed camera dimensions and poor fits are rejected',()=>{
  const f=metricFixture();
  assert.equal(fitMetricFace({...f.baseline,imageWidth:1280},f.model),null);
  assert.equal(lockMetricFace({...f.baseline,face:undefined},.55,.063),null);
  const o=f.observation(f.origin); o.face!.forEach((p,i)=>{p.x+=(i%2 ? 1 : -1)*60;p.y+=(i%3-1)*80;});
  assert.equal(fitMetricFace(o,f.model),null);
});
void test('radial refinement moves nearer for a larger observed face, with bounded steps',()=>{
  const projected=[{x:-10,y:0},{x:10,y:0},{x:0,y:10},{x:0,y:-10}],observed=projected.map(p=>({x:p.x*2,y:p.y*2}));
  assert.ok(refineRadialDepth(projected,observed,.55)<.55);
  assert.ok(refineRadialDepth(observed,projected,.55)>.55);
  assert.ok(Math.abs(refineRadialDepth(projected,observed,.55)-.55)<=.05+1e-9);
});
