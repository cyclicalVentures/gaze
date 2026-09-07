import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ScreenRecording } from '../lib/recorder/screen-recording';
import type { SessionStore } from '../lib/recorder/storage';
function setup(t: TestContext, fail = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  class Recorder extends EventTarget {
    state = 'inactive'; mimeType = 'video/webm'; ondataavailable?: (e: { data: Blob }) => void; onerror?: () => void;
    static isTypeSupported(type: string) { return type === 'video/webm;codecs=vp8'; }
    start(timeslice: number) { assert.equal(timeslice, 5000); this.state = 'recording'; this.dispatchEvent(new Event('start')); }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['final']) }); this.dispatchEvent(new Event('stop')); }
  }
  Object.defineProperty(globalThis, 'MediaRecorder', { value: Recorder, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'MediaRecorder', original); else Reflect.deleteProperty(globalThis, 'MediaRecorder'); });
  const track = { stopped: false, onended: null as (() => void) | null, stop() { this.stopped = true; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const chunks: string[] = [], reasons: string[] = [];
  const store = { async addVideo(id: string, index: number, blob: Blob) { assert.equal(id, 'game'); assert.equal(index, chunks.length); if (fail) throw new Error('Quota'); chunks.push(await blob.text()); } } as unknown as SessionStore;
  const recorder = new ScreenRecording(stream, store, 'game', reason => reasons.push(reason));
  return { recorder, media: recorder.recorder as unknown as Recorder, chunks, reasons, track };
}
void test('screen capture uses a common start clock and drains ordered chunks including the final one before stopping', async t => {
  const env = setup(t); const before = performance.now(), origin = await env.recorder.start(); assert.ok(origin >= before);
  env.media.ondataavailable?.({ data: new Blob(['first']) }); env.media.ondataavailable?.({ data: new Blob(['second']) });
  await Promise.all([env.recorder.stop(), env.recorder.stop()]);
  assert.deepEqual(env.chunks, ['first', 'second', 'final']); assert.equal(env.track.stopped, true); assert.equal(env.track.onended, null);
});
void test('revoked sharing and persistent-storage failures report a stop reason', async t => {
  const env = setup(t, true); await env.recorder.start(); env.track.onended?.(); assert.match(env.reasons[0], /sharing ended/);
  env.media.ondataavailable?.({ data: new Blob(['first']) }); await env.recorder.stop();
  assert.ok(env.reasons.some(r => /could not be saved/.test(r))); assert.equal(env.chunks.length, 0); assert.equal(env.track.stopped, true);
});
void test('an inactive encoder after an error still drains its asynchronous final chunk before review', async t => {
  const env = setup(t); await env.recorder.start(); env.media.state = 'inactive';
  let completed = false; const stop = env.recorder.stop().then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  env.media.ondataavailable?.({ data: new Blob(['recovered final chunk']) }); env.media.dispatchEvent(new Event('stop'));
  await stop; assert.deepEqual(env.chunks, ['recovered final chunk']); assert.equal(env.track.stopped, true);
});
