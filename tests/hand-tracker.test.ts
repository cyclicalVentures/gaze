import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { HandTracker, type HandStatus } from '../lib/viewer/hand-tracker';
import type { GestureResult, HandPoint } from '../lib/viewer/hand-gestures';
import { hand, handFrame } from './fixtures/hands';
function environment(t:TestContext) {
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const set=(key:string,value:unknown)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
  const clock={now:1000};t.mock.method(performance,'now',()=>clock.now);
  let nextFrame=0,bitmaps=0,closed=0;
  const callbacks=new Map<number,FrameRequestCallback>();
  const stream={getTracks:()=>{throw new Error('Hand tracker must not own camera tracks');}};
  const video={srcObject:stream as unknown,readyState:2,currentTime:1,paused:false,pause:()=>{throw new Error('Hand tracker must not pause shared video');}};
  let createBitmap=async()=>{bitmaps++;return {close:()=>{closed++;},width:640,height:480};};
  class WorkerMock {
    static instances:WorkerMock[]=[];
    onmessage?: (event:{data:unknown})=>void;
    onerror?:()=>void;
    messages:Record<string,unknown>[]=[];terminated=false;
    constructor() {WorkerMock.instances.push(this);}
    postMessage(data:Record<string,unknown>) {this.messages.push(data);}
    terminate() {this.terminated=true;}
    emit(data:unknown) {this.onmessage?.({data});}
    request() {return this.messages.findLast(m=>m.type==='frame') as {type:'frame';time:number;epoch:number};}
    result(landmarks:HandPoint[][]=[]) {const m=this.request();this.emit({type:'result',epoch:m.epoch,frame:handFrame(m.time,landmarks)});}
  }
  set('window',{location:{origin:'https://example.test'},setTimeout:globalThis.setTimeout});set('document',{hidden:false});
  set('Worker',WorkerMock);set('requestAnimationFrame',(cb:FrameRequestCallback)=>{callbacks.set(++nextFrame,cb);return nextFrame;});
  set('cancelAnimationFrame',(id:number)=>callbacks.delete(id));set('createImageBitmap',()=>createBitmap());
  set('navigator',{mediaDevices:{getUserMedia:()=>{throw new Error('A second camera request is forbidden');}}});
  const statuses:HandStatus[]=[],gestures:GestureResult[]=[],errors:string[]=[];
  const tracker=new HandTracker(video as unknown as HTMLVideoElement,s=>statuses.push(s),g=>gestures.push(g),e=>errors.push(e));
  const tick=async(dt=66,newVideo=true)=>{clock.now+=dt;if(newVideo)video.currentTime+=dt/1000;const entry=[...callbacks.entries()].at(-1);if(entry){callbacks.delete(entry[0]);entry[1](clock.now);}await Promise.resolve();};
  const start=async()=>{tracker.start();const worker=WorkerMock.instances.at(-1)!;worker.emit({type:'ready'});await Promise.resolve();return worker;};
  t.after(()=>{tracker.stop();for(const [key,value] of originals) {if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
  return {tracker,video,stream,clock,statuses,gestures,errors,callbacks,WorkerMock,start,tick,get bitmaps(){return bitmaps;},get closed(){return closed;},setBitmap:(fn:typeof createBitmap)=>{createBitmap=fn;}};
}
void test('hand tracking uses the shared video with bounded frame rate, unique frames and one inference in flight',async t=>{
  const env=environment(t),worker=await env.start();assert.equal(env.bitmaps,1);
  await env.tick();assert.equal(env.bitmaps,1,'busy detector must not accumulate frames');
  worker.result();await env.tick();assert.equal(env.bitmaps,2);
  worker.result();await env.tick(20);assert.equal(env.bitmaps,2,'cap inference rate');
  await env.tick(80,false);assert.equal(env.bitmaps,3);
  worker.result();await env.tick(80,false);assert.equal(env.bitmaps,3,'do not process the same video frame twice');
  env.tracker.stop();assert.equal(worker.terminated,true);assert.equal(env.callbacks.size,0);assert.equal(env.video.srcObject,env.stream);assert.equal(env.video.paused,false);
});
void test('pausing invalidates an in-flight gesture, suspends frame work and requires a fresh release on resume',async t=>{
  const env=environment(t),worker=await env.start();
  worker.result([hand()]);
  for(let i=0;i<5;i++){await env.tick();worker.result([hand(.5,.45,true)]);}
  await env.tick();worker.result([hand(.54,.45,true)]);assert.ok(env.gestures.at(-1)!.delta);
  await env.tick();env.tracker.setPaused(true);const count=env.bitmaps;
  worker.result([hand(.6,.45,true)]);assert.equal(env.gestures.at(-1)!.delta,null);
  await env.tick();assert.equal(env.bitmaps,count);assert.equal(env.statuses.at(-1),'paused');
  env.tracker.setPaused(false);await env.tick();worker.result([hand(.6,.45,true)]);assert.equal(env.gestures.at(-1)!.mode,'release');assert.equal(env.gestures.at(-1)!.delta,null);
});
void test('stale inference results, tracking gaps and explicit reset cannot move the model',async t=>{
  const env=environment(t),worker=await env.start();
  env.clock.now+=400;worker.result([hand(.5,.45,true)]);assert.equal(env.gestures.at(-1)!.delta,null);
  await env.tick();worker.result([hand()]);
  for(let i=0;i<5;i++){await env.tick();worker.result([hand(.5,.45,true)]);}
  await env.tick();env.tracker.resetGesture();worker.result([hand(.6,.45,true)]);assert.equal(env.gestures.at(-1)!.delta,null);
  await env.tick();worker.result([hand(.6,.45,true)]);assert.equal(env.gestures.at(-1)!.mode,'release');
});
void test('stopping releases a late bitmap and ignores old worker messages without stopping the webcam',async t=>{
  const env=environment(t);let resolve!:(bitmap:{close:()=>void;width:number;height:number})=>void;let closed=0;
  env.setBitmap(()=>new Promise(r=>{resolve=r;}));
  const worker=await env.start();env.tracker.stop();resolve({close:()=>{closed++;},width:640,height:480});await Promise.resolve();
  assert.equal(closed,1);assert.equal(worker.messages.filter(m=>m.type==='frame').length,0);
  const count=env.statuses.length;worker.emit({type:'ready'});assert.equal(env.statuses.length,count);assert.equal(env.video.srcObject,env.stream);
});
void test('hand-worker failures and stalls keep the shared camera available and support retry',async t=>{
  const env=environment(t),first=await env.start();first.emit({type:'error'});
  assert.equal(env.statuses.at(-1),'error');assert.equal(first.terminated,true);assert.equal(env.video.srcObject,env.stream);
  const second=await env.start();await env.tick(6000);assert.equal(second.terminated,true);assert.match(env.errors.at(-1)!,/stalled/);
  const third=await env.start();first.emit({type:'error'});assert.equal(third.terminated,false);assert.equal(env.statuses.at(-1),'ready');
});
