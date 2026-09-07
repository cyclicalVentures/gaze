import { assetUrl } from '../base';
import { HandGestures, type GestureResult, type HandFrame } from './hand-gestures';
export type HandStatus='off'|'starting'|'ready'|'paused'|'error';

/** Reads the existing camera video; never requests, stops, or owns its stream. */
export class HandTracker {
  private worker?:Worker;
  private generation=0;
  private epoch=0;
  private frame=0;
  private busy=false;
  private initialized=false;
  private paused=false;
  private lastSent=-Infinity;
  private lastResult=-Infinity;
  private lastVideo=-1;
  private stale=true;
  private initTimeout?:number;
  private gestures=new HandGestures();
  constructor(private video:HTMLVideoElement,private onStatus:(status:HandStatus)=>void,private onGesture:(result:GestureResult)=>void,private onError:(message:string)=>void) {}
  start() {
    this.stop();const generation=++this.generation;
    if (!this.video.srcObject) {this.fail('Enable the webcam to use hand controls.');return;}
    this.onStatus('starting');
    try {
      this.worker=new Worker(new URL('./hand-tracking.worker.ts',import.meta.url),{type:'module'});
      this.initTimeout=window.setTimeout(()=>{if (generation===this.generation) this.fail('Hand tracking took too long to load. Retry with a working connection.');},45000);
      this.worker.onerror=()=>{if (generation===this.generation) this.fail('Hand tracking could not start. Retry or use the model controls.');};
      this.worker.onmessage=({data})=>{
        if (generation!==this.generation) return;
        if (data.type==='ready') {clearTimeout(this.initTimeout);this.initialized=true;this.onStatus(this.paused ? 'paused' : 'ready');this.loop();}
        if (data.type==='error') this.fail('Hand tracking was interrupted. Retry or use the model controls.');
        if (data.type==='result') {
          this.busy=false;
          const frame=data.frame as HandFrame;
          if (this.paused || data.epoch!==this.epoch) return;
          // Do not apply a result that arrived after its hand pose became stale.
          if (performance.now()-frame.time>300) {this.resetGesture();return;}
          this.lastResult=performance.now();this.stale=false;this.onGesture(this.gestures.update(frame));
        }
      };
      this.worker.postMessage({type:'init',base:new URL(assetUrl('/tracking'),window.location.origin).href});
    } catch {this.fail('Hand tracking is unavailable in this browser. Use the model controls.');}
  }
  setPaused(paused:boolean) {
    if (this.paused===paused) return;
    this.paused=paused;++this.epoch;this.resetGesture();
    if (this.initialized) this.onStatus(paused ? 'paused' : 'ready');
  }
  resetGesture() {++this.epoch;this.gestures.reset();this.stale=true;this.onGesture({mode:'searching',points:[],delta:null});}
  private loop=()=>{
    if (!this.worker) return;
    this.frame=requestAnimationFrame(this.loop);
    const now=performance.now();
    if (this.busy && now-this.lastSent>5000) {this.fail('Hand processing stalled. Retry hand tracking.');return;}
    if (!this.stale && now-this.lastResult>300) this.resetGesture();
    if (this.paused || document.hidden || this.busy || now-this.lastSent<66 || this.video.readyState<2 || this.video.paused || this.video.currentTime===this.lastVideo || !this.video.srcObject) return;
    this.busy=true;this.lastSent=now;this.lastVideo=this.video.currentTime;
    const generation=this.generation,epoch=this.epoch;
    createImageBitmap(this.video).then(bitmap=>{
      if (generation!==this.generation || !this.worker || epoch!==this.epoch || this.paused) {bitmap.close();if (generation===this.generation) this.busy=false;return;}
      try {this.worker.postMessage({type:'frame',bitmap,time:now,epoch},[bitmap]);}
      catch (error) {bitmap.close();throw error;}
    }).catch(()=>{if (generation===this.generation) this.fail('The browser could not read hand-tracking frames. Retry or use the model controls.');});
  };
  stop() {
    ++this.generation;cancelAnimationFrame(this.frame);clearTimeout(this.initTimeout);this.initTimeout=undefined;
    this.worker?.terminate();this.worker=undefined;this.busy=false;this.initialized=false;
    this.lastSent=-Infinity;this.lastResult=-Infinity;this.lastVideo=-1;this.resetGesture();this.onStatus('off');
  }
  private fail(message:string) {this.stop();this.onStatus('error');this.onError(message);}
}
