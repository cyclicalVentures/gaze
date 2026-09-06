export type ViewTuning = { lateralGain: number; depthGain: number; eyeGain: number; response: number; boxDepth: number };
export const defaultTuning: ViewTuning = { lateralGain: 1, depthGain: 1, eyeGain: 1, response: 1.8, boxDepth: 28 };
export const tuningSteps = [
  { key: 'lateralGain', title: 'Side-to-side movement', instruction: 'Move your head slowly left and right. Choose the strength that makes the object feel anchored inside the box.', min: 0.4, max: 2.4, step: 0.05, unit: '×' },
  { key: 'depthGain', title: 'Leaning in and out', instruction: 'Lean closer, then farther away. Choose the setting where the change in perspective feels natural.', min: 0.25, max: 2, step: 0.05, unit: '×' },
  { key: 'eyeGain', title: 'Eye movement', instruction: 'Keep your head still and look across the object. 1× gives a subtle eye-pivot effect; higher values amplify it. Choose 0× if it feels less stable.', min: 0, max: 8, step: 0.1, unit: '×' },
  { key: 'response', title: 'Motion response', instruction: 'Move, then hold still. Lower values smooth jitter; higher values follow movement more quickly.', min: 0.6, max: 4, step: 0.1, unit: ' Hz' },
  { key: 'boxDepth', title: 'Depth of the box', instruction: 'Move gently side to side. Choose how far behind the screen the box should extend.', min: 8, max: 60, step: 1, unit: ' cm' },
] as const;
export const tuningStorageKey = 'gaze.view-tuning.v1';
export function parseTuning(raw: string | null): ViewTuning {
  try {
    const data: unknown = JSON.parse(raw ?? 'null');
    if (!data || typeof data !== 'object') return { ...defaultTuning };
    const tuning = { ...defaultTuning };
    for (const step of tuningSteps) {
      const value: unknown = Reflect.get(data, step.key);
      if (typeof value === 'number' && Number.isFinite(value) && value >= step.min && value <= step.max) tuning[step.key] = value;
    }
    return tuning;
  } catch { return { ...defaultTuning }; }
}
export type TuningSession = { original: ViewTuning; values: ViewTuning; index: number; direction: 1 | -1; paused: boolean; picked: boolean; complete: boolean };
export type TuningAction = { type: 'tick' } | { type: 'pause' } | { type: 'pick' } | { type: 'next' } | { type: 'back' } | { type: 'adjust'; value: number };
export const beginTuning = (values: ViewTuning): TuningSession => ({ original: { ...values }, values: { ...values }, index: 0, direction: 1, paused: false, picked: false, complete: false });
export function tune(state: TuningSession, action: TuningAction): TuningSession {
  if (state.complete) return state;
  const step = tuningSteps[state.index];
  switch (action.type) {
    case 'tick': {
      if (state.paused || state.picked) return state;
      const current = state.values[step.key];
      const direction = current >= step.max ? -1 : current <= step.min ? 1 : state.direction;
      const value = Math.max(step.min, Math.min(step.max, Math.round((current + direction * (step.max - step.min) / 8) / step.step) * step.step));
      return { ...state, direction, values: { ...state.values, [step.key]: Number(value.toFixed(2)) } };
    }
    case 'pause': return { ...state, paused: !state.paused, picked: false };
    case 'pick': return { ...state, picked: true, paused: true };
    case 'adjust': return Number.isFinite(action.value) ? { ...state, paused: true, values: { ...state.values, [step.key]: Math.max(step.min, Math.min(step.max, action.value)) } } : state;
    case 'next': return !state.picked ? state : state.index === tuningSteps.length - 1 ? { ...state, complete: true } : { ...state, index: state.index + 1, direction: 1, paused: false, picked: false };
    case 'back': return { ...state, index: Math.max(0, state.index - 1), paused: true, picked: false };
  }
}
