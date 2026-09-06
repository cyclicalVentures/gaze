import test from 'node:test';
import assert from 'node:assert/strict';
import { beginTuning, defaultTuning, mapTrackedEye, parseTuning, tune, tuningSteps } from '../lib/viewer/tuning';

void test('automatic calibration sweeps exactly one parameter within bounds and freezes every choice', () => {
  let state = beginTuning(defaultTuning);
  for (let index = 0; index < tuningSteps.length; index++) {
    const step = tuningSteps[index], before = { ...state.values };
    for (let tick = 0; tick < 30; tick++) {
      state = tune(state, { type: 'tick' });
      assert.equal(state.values.depthDirection, before.depthDirection);
      for (const s of tuningSteps) if (s.key !== step.key) assert.equal(state.values[s.key], before[s.key]);
      assert.ok(state.values[step.key] >= step.min && state.values[step.key] <= step.max);
    }
    state = tune(state, { type: 'pick' }); const frozen = state;
    assert.equal(tune(state, { type: 'tick' }), frozen);
    state = tune(state, { type: 'next' }); assert.deepEqual(state.values, frozen.values);
  }
  assert.equal(state.complete, true); assert.deepEqual(state.original, defaultTuning);
  assert.equal(tune(state, { type: 'tick' }), state);
});
void test('pause, fine adjustment, back, and cancel preserve the original settings', () => {
  let state = beginTuning(defaultTuning);
  state = tune(state, { type: 'tick' }); state = tune(state, { type: 'pause' });
  assert.equal(tune(state, { type: 'tick' }), state);
  state = tune(state, { type: 'adjust', value: 1.35 }); assert.equal(state.values.lateralGain, 1.35);
  assert.equal(tune(state, { type: 'next' }), state, 'cannot advance before choosing');
  state = tune(tune(state, { type: 'pick' }), { type: 'next' });
  state = tune(state, { type: 'tick' }); state = tune(state, { type: 'back' });
  assert.equal(state.index, 0); assert.equal(state.paused, true); assert.equal(state.values.lateralGain, 1.35);
  assert.deepEqual(state.original, defaultTuning); assert.notEqual(state.original, defaultTuning);
});
void test('saved calibration rejects malformed, nonfinite, out-of-range, and unknown settings', () => {
  assert.deepEqual(parseTuning('{broken'), defaultTuning);
  assert.deepEqual(parseTuning('null'), defaultTuning);
  const values = parseTuning(JSON.stringify({ lateralGain: 1.5, depthGain: -10, eyeGain: '8', response: 900, boxDepth: 45, bogus: true }));
  assert.deepEqual(values, { ...defaultTuning, lateralGain: 1.5, boxDepth: 45 });
  assert.deepEqual(parseTuning(JSON.stringify(values)), values);
  assert.equal(parseTuning('{"depthDirection":-1}').depthDirection, -1);
  assert.equal(parseTuning('{"depthDirection":0}').depthDirection, -1);
  assert.equal(parseTuning('{"depthGain":1.3}').depthDirection, -1, 'existing calibration adopts the new approach-growth default');
  assert.equal(parseTuning('{"depthDirection":1}').depthDirection, 1, 'explicit physical window preference survives reload');
});
void test('reversing in/out changes only virtual head depth around the neutral pose', () => {
  const head = { x: 0.02, y: -0.01, z: 0.4 }, offset = { x: 0, y: 0, z: 0 };
  const normal = mapTrackedEye(head, offset, 0.55, { ...defaultTuning, depthDirection: 1 });
  const reversed = mapTrackedEye(head, offset, 0.55, { ...defaultTuning, depthDirection: -1 });
  assert.equal(normal.z, 0.4); assert.ok(Math.abs(reversed.z - 0.7) < 1e-9);
  assert.equal(normal.x, reversed.x); assert.equal(normal.y, reversed.y); assert.equal(head.z, 0.4);
  assert.deepEqual(mapTrackedEye({ ...head, z: 0.55 }, offset, 0.55, { ...defaultTuning, depthDirection: 1 }), mapTrackedEye({ ...head, z: 0.55 }, offset, 0.55, { ...defaultTuning, depthDirection: -1 }));
  for (const z of [0.15, 1.5]) for (const direction of [-1, 1] as const) {
    const result = mapTrackedEye({ ...head, z }, offset, 0.55, { ...defaultTuning, depthGain: 2, depthDirection: direction });
    assert.ok(result.z >= 0.15 && result.z <= 1.5);
  }
});
