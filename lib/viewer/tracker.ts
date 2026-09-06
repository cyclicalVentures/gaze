import { assetUrl } from '../base';
import { estimateEye, OneEuroFilter, type EyeObservation, type EyePosition } from './projection';
export type TrackingStatus = 'off' | 'starting' | 'ready' | 'tracking' | 'lost';
export class HeadTracker {
  private worker?: Worker;
  private stream?: MediaStream;
  private frame = 0;
  private generation = 0;
  private busy = false;
  private lastTime = -1;
  private lastSent = 0;
  private lastFace = 0;
  private baseline?: EyeObservation;
  private recent: EyeObservation[] = [];
  private filters = [new OneEuroFilter(), new OneEuroFilter(), new OneEuroFilter(1.3, 7)];
  private status: TrackingStatus = 'off';
  distance = 0.55;
  ipd = 0.063;
  eye: 'center' | 'left' | 'right' = 'center';
  constructor(private video: HTMLVideoElement, private onStatus: (status: TrackingStatus) => void, private onPosition: (position: EyePosition, ms: number) => void, private onError: (message: string) => void) {}
  private updateStatus(status: TrackingStatus) { if (this.status !== status) { this.status = status; this.onStatus(status); } }
  async start() {
    this.stop(); const generation = ++this.generation;
    this.updateStatus('starting');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera tracking needs HTTPS or localhost. Open the secure app link in Safari or Chrome.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      this.worker = new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' });
      const initTimeout = window.setTimeout(() => { if (generation === this.generation && this.status === 'starting') this.fail('Camera tracking took too long to load. Check your connection and try again.'); }, 45000);
      this.worker.onerror = () => { clearTimeout(initTimeout); this.fail('The camera tracker could not start. Try an up-to-date Safari or Chrome browser.'); };
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') { clearTimeout(initTimeout); this.updateStatus('ready'); this.loop(); }
        if (data.type === 'error') { clearTimeout(initTimeout); this.fail('The eye tracker could not process the camera. Stop and try again, or use pointer preview.'); }
        if (data.type === 'result') {
          this.busy = false;
          const observation = data.observation as EyeObservation | null;
          if (!observation) { if (performance.now() - this.lastFace > 650) this.updateStatus('lost'); return; }
          this.lastFace = performance.now(); this.recent.push(observation);
          this.recent = this.recent.filter(v => observation.time - v.time < 700);
          this.updateStatus(this.baseline ? 'tracking' : 'ready');
          if (this.baseline) {
            const eye = estimateEye(observation, this.baseline, this.distance, this.ipd, this.eye);
            this.onPosition({ x: this.filters[0].filter(eye.x, observation.time / 1000), y: this.filters[1].filter(eye.y, observation.time / 1000), z: this.filters[2].filter(eye.z, observation.time / 1000) }, data.inferenceMs);
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
    const mean = (key: 'x' | 'y' | 'span') => recent.reduce((sum, r) => sum + r[key], 0) / recent.length;
    this.baseline = { ...recent[recent.length - 1], x: mean('x'), y: mean('y'), span: mean('span') };
    this.filters.forEach(f => f.reset()); this.updateStatus('tracking'); return true;
  }
  stop() {
    ++this.generation; cancelAnimationFrame(this.frame);
    this.worker?.terminate(); this.worker = undefined;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined;
    this.video.pause(); this.video.srcObject = null;
    this.busy = false; this.lastTime = -1; this.baseline = undefined; this.recent = []; this.lastFace = 0;
    this.filters.forEach(f => f.reset()); this.updateStatus('off');
  }
  private fail(message: string) { this.stop(); this.onError(message); }
}
