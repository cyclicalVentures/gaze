import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../lib/recorder/storage';
import type { GazeSession } from '../lib/recorder/session';
const fixture = (id: string): GazeSession => ({ version: 1, id, name: 'Game match', startedAt: 1000, duration: 500, width: 1920, height: 1080, scope: 'screen', camera: 'USB webcam', calibrationError: 45, ended: false, sampleCount: 2, videoType: 'video/webm', points: [{ t: 0, x: .5, y: .5 }, { t: 50, x: null, y: null }] });
void test('session checkpoints survive database reopen and video chunks remain ordered', async () => {
  let store = await SessionStore.open(); const a = fixture('a');
  await store.save(a); await store.addVideo('a', 1, new Blob(['second'])); await store.addVideo('a', 0, new Blob(['first']));
  store.close(); store = await SessionStore.open();
  assert.deepEqual(await store.load('a'), a);
  assert.equal((await store.video('a', 'video/webm'))?.type, 'video/webm');
  assert.equal(await (await store.video('a', 'video/webm'))?.text(), 'firstsecond');
  const [meta] = await store.list(); assert.equal(meta.ended, false); assert.equal('points' in meta, false);
  await store.save({ ...a, ended: true, duration: 700 }); assert.equal((await store.load('a'))?.ended, true);
  await store.remove('a'); store.close();
});
void test('deleting a session removes only its samples and footage, while incomplete sessions remain recoverable', async () => {
  const store = await SessionStore.open();
  await store.save(fixture('delete')); await store.save({ ...fixture('keep'), startedAt: 2000 });
  await store.addVideo('delete', 0, new Blob(['delete'])); await store.addVideo('keep', 0, new Blob(['keep']));
  assert.equal((await store.list())[0].id, 'keep');
  await store.remove('delete'); assert.equal(await store.load('delete'), null); assert.equal(await store.video('delete', 'video/webm'), null);
  assert.equal((await store.load('keep'))?.points.length, 2); assert.equal(await (await store.video('keep', 'video/webm'))?.text(), 'keep');
  await store.remove('keep'); store.close();
});
void test('storage write failure is observable and cannot masquerade as a successful autosave', async () => {
  const store = await SessionStore.open(); store.close();
  await assert.rejects(() => store.save(fixture('closed')));
  await assert.rejects(() => store.addVideo('closed', 0, new Blob(['frame'])));
});
