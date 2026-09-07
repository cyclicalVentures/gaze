/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { observeFace } from './eye-model';
let detector: FaceLandmarker | undefined;
let clock: ReturnType<typeof setInterval> | undefined;
self.onmessage = async (event: MessageEvent) => {
  if (event.data.type === 'continuous') {
    clearInterval(clock); clock = undefined;
    if (event.data.enabled) clock = setInterval(() => self.postMessage({type:'tick'}), 50);
    return;
  }
  if (event.data.type === 'init') {
    try {
      const wasm = await FilesetResolver.forVisionTasks(event.data.base, true);
      const { default: factory } = await import(/* @vite-ignore */ wasm.wasmLoaderPath);
      const moduleScope = globalThis as typeof globalThis & { ModuleFactory?: unknown };
      const options = { baseOptions: { modelAssetPath: event.data.base + '/face_landmarker.task', delegate: 'GPU' as const }, runningMode: 'VIDEO' as const, numFaces: 1, minFaceDetectionConfidence: 0.6, minTrackingConfidence: 0.6, minFacePresenceConfidence: 0.6 };
      const create = (delegate: 'GPU' | 'CPU') => {
        // ESM imports are cached, while MediaPipe clears ModuleFactory after
        // instantiation. Restore it explicitly for a CPU fallback/retry.
        moduleScope.ModuleFactory = factory;
        return FaceLandmarker.createFromOptions({ ...wasm, wasmLoaderPath: '' }, { ...options, baseOptions: { ...options.baseOptions, delegate } });
      };
      try { detector = await create('GPU'); }
      catch { detector = await create('CPU'); }
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
    return;
  }
  if (event.data.type === 'frame') {
    const bitmap: ImageBitmap = event.data.bitmap;
    try {
      if (!detector) return;
      const start = performance.now();
      const result = detector.detectForVideo(bitmap, event.data.time);
      const landmarks = result.faceLandmarks[0];
      const observation = landmarks ? observeFace(landmarks, bitmap.width, bitmap.height, event.data.time) : null;
      self.postMessage({ type: 'result', observation, inferenceMs: performance.now() - start });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
    finally { bitmap.close(); }
  }
};
