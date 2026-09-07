/// <reference lib="webworker" />
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
let detector:HandLandmarker|undefined;
self.onmessage=async (event:MessageEvent)=>{
  if (event.data.type==='init') {
    try {
      const wasm=await FilesetResolver.forVisionTasks(event.data.base,true);
      const {default:factory}=await import(/* @vite-ignore */ wasm.wasmLoaderPath);
      const scope=globalThis as typeof globalThis & {ModuleFactory?:unknown};
      const create=(delegate:'GPU'|'CPU')=>{
        scope.ModuleFactory=factory;
        return HandLandmarker.createFromOptions({...wasm,wasmLoaderPath:''},{baseOptions:{modelAssetPath:event.data.base+'/hand_landmarker.task',delegate},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.65,minHandPresenceConfidence:.65,minTrackingConfidence:.65});
      };
      try {detector=await create('GPU');} catch {detector=await create('CPU');}
      self.postMessage({type:'ready'});
    } catch {self.postMessage({type:'error'});}
    return;
  }
  if (event.data.type==='frame') {
    const bitmap:ImageBitmap=event.data.bitmap;
    try {
      if (!detector) throw new Error('Hand detector not ready');
      const result=detector.detectForVideo(bitmap,event.data.time);
      self.postMessage({type:'result',epoch:event.data.epoch,frame:{time:event.data.time,width:bitmap.width,height:bitmap.height,landmarks:result.landmarks}});
    } catch {self.postMessage({type:'error'});}
    finally {bitmap.close();}
  }
};
