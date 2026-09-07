import type { DisplayIdentity } from '../viewer/calibration-storage';
export type RecordingScope = 'screen' | 'page';
/** Separate coordinate spaces cannot overwrite the viewer's calibration. */
export function recordingStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: RecordingScope) {
  const prefix = `recorder.${scope}.`;
  return { getItem: (key: string) => storage.getItem(prefix + key), setItem: (key: string, value: string) => storage.setItem(prefix + key, value), removeItem: (key: string) => storage.removeItem(prefix + key) };
}
export function fullScreenFits(width: number, height: number, display: DisplayIdentity) { return Math.abs(width - display.width) <= 2 && Math.abs(height - display.height) <= 2; }
export function captureMismatch(settings: MediaTrackSettings, width: number, height: number) {
  if (settings.displaySurface !== 'monitor') return 'Choose Entire screen so gaze lines up with the recording. Tabs and individual windows use different coordinates.';
  if (!settings.width || !settings.height || Math.abs(settings.width / settings.height / (width / height) - 1) > .025) return 'The selected screen has a different shape. Share the monitor you calibrated and play on that monitor.';
  return '';
}
