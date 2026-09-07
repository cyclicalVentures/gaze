import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationMismatch, calibrationStorageKey, forgetCalibration, loadCalibration, saveCalibration, validSavedCalibration, type SavedCalibration } from '../lib/viewer/calibration-storage';
import { calibrationFixture, camera, display, memoryStorage } from './fixtures/calibration';
void test('camera profiles survive a JSON round trip and remain isolated even with identical camera labels',()=>{
  const storage=memoryStorage(),{calibration,result}=calibrationFixture();
  const a=saveCalibration(storage,camera,display,calibration,result)!;assert.ok(a);
  const b=saveCalibration(storage,{...camera,deviceId:'camera-B'},display,calibration,result)!;assert.ok(b);
  assert.equal(storage.map.size,2);assert.deepEqual(loadCalibration(storage,camera.deviceId),{kind:'found',value:a});
  assert.equal(loadCalibration(storage,'camera-C').kind,'missing');
  assert.equal(forgetCalibration(storage,camera.deviceId),true);assert.equal(loadCalibration(storage,camera.deviceId).kind,'missing');
  assert.equal(loadCalibration(storage,'camera-B').kind,'found');
  const raw=storage.getItem(calibrationStorageKey('camera-B'))!;
  assert.ok(raw.length<15000);assert.equal(raw.includes('"signal"'),false);assert.equal(raw.includes('"targets"'),false);
});
void test('auto-restore rejects camera identity, resolution, lens, viewport, display, orientation and zoom mismatches',()=>{
  const {calibration,result}=calibrationFixture(),saved=saveCalibration(memoryStorage(),camera,display,calibration,result)!;
  const viewport={width:1200,height:800};assert.equal(calibrationMismatch(saved,camera,display,viewport),null);
  for(const changed of [{...camera,deviceId:'another'}, {...camera,width:1280}, {...camera,facingMode:'environment'}, {...camera,zoom:2}, {...camera,resizeMode:'none'}]) assert.ok(calibrationMismatch(saved,changed,display,viewport));
  for(const changed of [{...display,pixelRatio:1.5},{...display,width:900,height:1440}]) assert.ok(calibrationMismatch(saved,camera,changed,viewport));
  assert.ok(calibrationMismatch(saved,camera,display,{width:1200,height:700}));
});
void test('corrupt, outdated, nonfinite, malformed and incomplete records never restore or replace a valid profile',()=>{
  const storage=memoryStorage(),{calibration,result}=calibrationFixture(),saved=saveCalibration(storage,camera,display,calibration,result)!;
  type MutableRecord=Omit<SavedCalibration,'version'> & {version:number};
  for(const mutate of [(s:MutableRecord)=>{s.version=2;},(s:MutableRecord)=>{s.calibration.profile.layers![1].profile.x=[1];},(s:MutableRecord)=>{s.calibration.profile.layers![0].distance=NaN;},(s:MutableRecord)=>{s.calibration.baseline.head!.axes[0].x=10;},(s:MutableRecord)=>{s.checks[1].meanPx=999;},(s:MutableRecord)=>{s.calibration.baseline.face=[];}]) {
    const bad=structuredClone(saved);mutate(bad);assert.equal(validSavedCalibration(bad),false);
    storage.setItem(calibrationStorageKey(camera.deviceId),JSON.stringify(bad));assert.notEqual(loadCalibration(storage,camera.deviceId).kind,'found');
  }
  storage.setItem(calibrationStorageKey(camera.deviceId),JSON.stringify(saved));
  assert.equal(saveCalibration(storage,camera,display,calibration,{...result,usable:false}),null);
  assert.deepEqual(loadCalibration(storage,camera.deviceId),{kind:'found',value:saved});
  assert.equal(saveCalibration(storage,{...camera,deviceId:''},display,calibration,result),null);
  assert.equal(saveCalibration(storage,{...camera,deviceId:'default'},display,calibration,result),null);
  storage.setItem(calibrationStorageKey('other'),JSON.stringify(saved));assert.equal(loadCalibration(storage,'other').kind,'invalid');
});
void test('blocked or exhausted browser storage is recoverable and never reports a successful save',()=>{
  const fail=()=>{throw new Error('Quota or security error');},storage={getItem:fail,setItem:fail,removeItem:fail};
  const {calibration,result}=calibrationFixture();
  assert.equal(saveCalibration(storage,camera,display,calibration,result),null);
  assert.equal(loadCalibration(storage,camera.deviceId).kind,'unavailable');assert.equal(forgetCalibration(storage,camera.deviceId),false);
});
