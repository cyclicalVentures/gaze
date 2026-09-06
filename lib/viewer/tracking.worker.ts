/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
let detector: FaceLandmarker | undefined;
self.onmessage = async (event: MessageEvent) => {
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
      let observation = null;
      if (landmarks?.[473]) {
        const a = landmarks[468], b = landmarks[473];
        // Pixel-space distance includes model-relative depth to reduce yaw foreshortening.
        const span = Math.hypot((a.x - b.x) * bitmap.width, (a.y - b.y) * bitmap.height, (a.z - b.z) * bitmap.width);
        const open = Math.abs(landmarks[159].y - landmarks[145].y) + Math.abs(landmarks[386].y - landmarks[374].y);
        if (span > 12 && open > 0.006) observation = { x: (a.x + b.x) * bitmap.width / 2, y: (a.y + b.y) * bitmap.height / 2, span, left: { x: b.x * bitmap.width, y: b.y * bitmap.height }, right: { x: a.x * bitmap.width, y: a.y * bitmap.height }, time: event.data.time, imageWidth: bitmap.width, imageHeight: bitmap.height };
      }
      self.postMessage({ type: 'result', observation, inferenceMs: performance.now() - start });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
    finally { bitmap.close(); }
  }
};
