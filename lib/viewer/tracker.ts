import { assetUrl } from '../base';
import { estimateEye, OneEuroFilter, type EyeObservation, type EyePosition } from './projection';
import { averageObservation, lockEyeModel, reconstructEyes, type EyeModel, type GazeReading } from './eye-model';
import { defaultTuning, mapTrackedEye, type ViewTuning } from './tuning';
import { lockMetricFace, fitMetricFace, type MetricFaceModel } from './metric-face';
import { gazeSignal, predictGaze, calibratedEyeOffset, type GazeProfile, type GazeSample, type ScreenGeometry } from './gaze-calibration';
export type TrackingStatus = 'off' | 'starting' | 'ready' | 'tracking' | 'lost';
export type GeometryMode = 'metric' | 'legacy';
export type DepthReading = { measured: number; neutral: number; method: GeometryMode; errorPx?: number; calibrated: boolean };
export class HeadTracker {
  private worker?: Worker;
  private stream?: MediaStream;
  private frame = 0;
  private generation = 0;
  private busy = false;
  private lastTime = -1;
  private lastSent = 0;
  private lastFace = 0;
  private initTimeout?: number;
  private baseline?: EyeObservation;
  private eyeModel?: EyeModel;
  private metricModel?: MetricFaceModel;
  private geometryMode: GeometryMode = 'metric';
  private screen?: ScreenGeometry;
  private profile?: GazeProfile;
  private revision = 0;
  private listeners = new Set<(sample: GazeSample) => void>();
  private recent: EyeObservation[] = [];
  private filters = [new OneEuroFilter(), new OneEuroFilter(), new OneEuroFilter(1.3, 7)];
  private status: TrackingStatus = 'off';
  distance = 0.55;
  ipd = 0.063;
  eye: 'center' | 'left' | 'right' = 'center';
  tuning: ViewTuning = { ...defaultTuning };
  constructor(private video: HTMLVideoElement, private onStatus: (status: TrackingStatus) => void, private onPosition: (position: EyePosition, ms: number, gaze?: GazeReading, depth?: DepthReading) => void, private onError: (message: string) => void) {}
  get calibrationRevision() { return this.revision; }
  get hasGazeProfile() { return !!this.profile; }
  subscribeGaze(listener: (sample: GazeSample) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  clearGazeProfile() { this.profile = undefined; ++this.revision; }
  setScreenGeometry(screen: ScreenGeometry) { this.screen = screen; this.clearGazeProfile(); }
  setGeometryMode(mode: GeometryMode) { this.geometryMode = mode; this.clearGazeProfile(); this.filters.forEach(f => f.reset()); }
  applyGazeProfile(profile: GazeProfile, revision: number) {
    if (revision !== this.revision || !this.baseline || !this.screen || profile.width !== this.screen.width || profile.height !== this.screen.height) return false;
    this.profile = profile; this.filters.forEach(f => f.reset()); return true;
  }
  private updateStatus(status: TrackingStatus) { if (this.status !== status) { this.status = status; this.onStatus(status); } }
  async start() {
    this.stop(); const generation = ++this.generation;
    this.updateStatus('starting');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera tracking needs HTTPS or localhost. Open the secure app link in Safari or Chrome.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) track.onended = () => {
        if (generation === this.generation) this.fail('The camera was disconnected or access was revoked. Reconnect it and start tracking again.');
      };
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      this.worker = new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' });
      this.initTimeout = window.setTimeout(() => { if (generation === this.generation && this.status === 'starting') this.fail('Camera tracking took too long to load. Check your connection and try again.'); }, 45000);
      this.worker.onerror = () => { this.fail('The camera tracker could not start. Try an up-to-date Safari or Chrome browser.'); };
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') { clearTimeout(this.initTimeout); this.initTimeout = undefined; this.updateStatus('ready'); this.loop(); }
        if (data.type === 'error') { this.fail('The eye tracker could not process the camera. Stop and try again, or use pointer preview.'); }
        if (data.type === 'result') {
          this.busy = false;
          const observation = data.observation as EyeObservation | null;
          if (!observation) { if (performance.now() - this.lastFace > 650) this.updateStatus('lost'); return; }
          this.lastFace = performance.now(); this.recent.push(observation);
          this.recent = this.recent.filter(v => observation.time - v.time < 700);
          if (!this.baseline) this.updateStatus('ready');
          if (this.baseline) {
            const solution = this.eyeModel ? reconstructEyes(observation, this.eyeModel, this.distance, this.ipd, this.eye) : null;
            if (this.eyeModel && !solution) { this.updateStatus('lost'); return; }
            const metric = this.geometryMode === 'metric' && this.metricModel ? fitMetricFace(observation, this.metricModel, this.eye) : null;
            if (this.geometryMode === 'metric' && this.metricModel && !metric) { this.updateStatus('lost'); return; }
            const head = metric?.position ?? solution?.position ?? estimateEye(observation, this.baseline, this.distance, this.ipd, this.eye);
            let offset = solution?.eyeOffset ?? { x: 0, y: 0, z: 0 };
            if (solution && this.screen) {
              const signal = gazeSignal(head, solution.gaze, this.screen);
              if (signal) {
                for (const listener of this.listeners) listener({ time: observation.time, signal, revision: this.revision });
                if (this.profile) {
                  const target = predictGaze(this.profile, signal);
                  // Avoid unstable extrapolation outside the calibrated screen.
                  if (Number.isFinite(target.x + target.y) && target.x >= -.25 && target.x <= 1.25 && target.y >= -.25 && target.y <= 1.25) offset = calibratedEyeOffset(head, target, this.screen);
                  else offset = { x: 0, y: 0, z: 0 };
                }
              }
            }
            const eye = mapTrackedEye(head, offset, this.distance, this.tuning);
            this.updateStatus('tracking');
            this.filters.forEach(f => f.setCutoff(this.tuning.response));
            this.onPosition({ x: this.filters[0].filter(eye.x, observation.time / 1000), y: this.filters[1].filter(eye.y, observation.time / 1000), z: this.filters[2].filter(eye.z, observation.time / 1000) }, data.inferenceMs, solution?.gaze, { measured: head.z, neutral: this.distance, method: metric ? 'metric' : 'legacy', errorPx: metric?.errorPx, calibrated: !!this.profile });
          }
        }
      };
      this.worker.postMessage({ type: 'init', base: new URL(assetUrl('/tracking'), window.location.origin).href });
    } catch (error) {
      if (generation !== this.generation) return;
      const name = (error as Error).name;
      this.fail(name === 'NotAllowedError' ? 'Camera access was declined. Allow camera access in browser settings, then try again.' : name === 'NotFoundError' ? 'No camera was found. Connect a webcam or use pointer preview.' : (error as Error).message || 'Camera unavailable. Close other camera apps and try again.');
    }
  }
  private loop = () => {
    if (!this.worker) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.busy && now - this.lastSent > 5000) { this.fail('Camera processing stalled. Start tracking again or use pointer preview.'); return; }
    if (this.baseline && now - this.lastFace > 650) this.updateStatus('lost');
    if (this.busy || now - this.lastSent < 32 || this.video.readyState < 2 || this.video.currentTime === this.lastTime) return;
    this.busy = true; this.lastTime = this.video.currentTime; this.lastSent = now;
    const generation = this.generation;
    createImageBitmap(this.video).then(bitmap => {
      if (generation !== this.generation || !this.worker) { bitmap.close(); return; }
      this.worker.postMessage({ type: 'frame', bitmap, time: now }, [bitmap]);
    }).catch(() => { if (generation === this.generation) this.fail('This browser could not read camera frames. Try current Safari or Chrome.'); });
  };
  calibrate() {
    const recent = this.recent.filter(v => performance.now() - v.time < 600);
    if (recent.length < 5 || performance.now() - this.lastFace > 250) return false;
    const baseline = averageObservation(recent);
    if (recent.some(v => Math.hypot(v.x - baseline.x, v.y - baseline.y) > baseline.span * 0.06 || Math.abs(v.span / baseline.span - 1) > 0.04)) return false;
    this.baseline = baseline;
    this.eyeModel = lockEyeModel(baseline, this.ipd);
    this.metricModel = lockMetricFace(baseline, this.distance, this.ipd) ?? undefined;
    this.clearGazeProfile();
    this.filters.forEach(f => f.reset()); this.updateStatus('tracking'); return true;
  }
  stop() {
    ++this.generation; cancelAnimationFrame(this.frame);
    clearTimeout(this.initTimeout); this.initTimeout = undefined;
    this.worker?.terminate(); this.worker = undefined;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined;
    this.video.pause(); this.video.srcObject = null;
    this.busy = false; this.lastTime = -1; this.baseline = undefined; this.eyeModel = undefined; this.metricModel = undefined; this.recent = []; this.lastFace = 0; this.clearGazeProfile();
    this.filters.forEach(f => f.reset()); this.updateStatus('off');
  }
  private fail(message: string) { this.stop(); this.onError(message); }
}
