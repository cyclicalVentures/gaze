import type { SessionStore } from './storage';
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
export function recordingMime() {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}
/** Persist chunks as they arrive instead of retaining a whole game in JS memory. */
export class ScreenRecording {
  readonly recorder: MediaRecorder;
  private writes: Promise<void> = Promise.resolve();
  private index = 0;
  private bytes = 0;
  private pendingBytes = 0;
  private stopping?: Promise<void>;
  private failed = false;
  private started = false;
  private stopped: Promise<void>;
  constructor(private stream: MediaStream, private store: SessionStore, private id: string, private onEnd: (reason: string) => void) {
    const mimeType = recordingMime();
    this.recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_500_000 });
    this.stopped = new Promise(resolve => this.recorder.addEventListener('stop', () => resolve(), { once: true }));
    this.recorder.ondataavailable = event => {
      if (!event.data.size || this.failed) return;
      const index = this.index++, blob = event.data;
      this.bytes += blob.size; this.pendingBytes += blob.size;
      this.writes = this.writes.then(() => this.store.addVideo(this.id, index, blob)).catch(() => {
        if (!this.failed) { this.failed = true; this.onEnd('Screen video could not be saved. Free browser storage before another recording. Gaze data is still available.'); }
      }).finally(() => { this.pendingBytes -= blob.size; });
      if (this.bytes >= MAX_VIDEO_BYTES || this.pendingBytes > 32 * 1024 * 1024) this.onEnd('Recording reached the screen video storage limit. This session has been stopped.');
    };
    this.recorder.onerror = () => this.onEnd('Screen recording was interrupted. The available gaze and video will be saved.');
    for (const track of stream.getVideoTracks()) track.onended = () => this.onEnd('Screen sharing ended. The session has been stopped.');
  }
  get type() { return this.recorder.mimeType; }
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.recorder.addEventListener('start', () => { this.started = true; resolve(performance.now()); }, { once: true });
      this.recorder.addEventListener('error', () => reject(new Error('Screen recording could not start.')), { once: true });
      this.recorder.start(5000);
    });
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.recorder.state !== 'inactive') {
        this.recorder.stop();
      }
      // On an encoder error, state is already inactive before the final data and
      // stop events arrive. Those chunks must finish before reading the video.
      if (this.started) await this.stopped;
      this.stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
      await this.writes;
    })();
    return this.stopping;
  }
}
