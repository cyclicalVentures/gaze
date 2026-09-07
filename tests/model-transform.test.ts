import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Quaternion, Euler, Vector3, PerspectiveCamera } from 'three';
import { applyModelGesture } from '../lib/viewer/model-transform';
import { applyOffAxis } from '../lib/viewer/projection';
void test('hand transforms rotate the model about its center and leave the screen projection untouched',()=>{
  const model=new Group(),camera=new PerspectiveCamera();model.position.set(0,0,-.15);
  applyOffAxis(camera,{x:.02,y:-.01,z:.55},.34,.22);
  const projection=camera.projectionMatrix.clone(),position=model.position.clone();
  const scale=applyModelGesture(model,1,{scale:1.2,rotation:{x:.1,y:.2,z:0}},camera.quaternion);
  assert.equal(scale,1.2);assert.ok(model.position.equals(position));assert.ok(camera.projectionMatrix.equals(projection));
  assert.ok(new Vector3(0,0,1).applyQuaternion(model.quaternion).x>0);
  assert.ok(Math.abs(model.quaternion.length()-1)<1e-12);
});
void test('scale has bounded limits, invalid deltas do nothing, and rotation respects the viewing orientation',()=>{
  const model=new Group();let zoom=1;
  for(let i=0;i<100;i++) zoom=applyModelGesture(model,zoom,{scale:1.2,rotation:{x:0,y:0,z:0}},new Quaternion());
  assert.equal(zoom,2.5);
  for(let i=0;i<100;i++) zoom=applyModelGesture(model,zoom,{scale:.8,rotation:{x:0,y:0,z:0}},new Quaternion());
  assert.equal(zoom,.2);
  const before=model.quaternion.clone();assert.equal(applyModelGesture(model,zoom,{scale:NaN,rotation:{x:1,y:0,z:0}},new Quaternion()),zoom);assert.ok(model.quaternion.equals(before));
  const view=new Quaternion().setFromEuler(new Euler(0,Math.PI/2,0));
  applyModelGesture(model,1,{scale:1,rotation:{x:0,y:0,z:.2}},view);
  const screenRotation=view.clone().invert().multiply(model.quaternion).multiply(view);
  assert.ok(screenRotation.angleTo(new Quaternion().setFromEuler(new Euler(0,0,.2)))<1e-7);
});
