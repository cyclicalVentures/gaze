import type { EyeObservation } from './projection';
import type { GazePlane, GazeProfile, ScreenGeometry } from './gaze-calibration';
import type { DistanceResult } from './distance-calibration';
import { geometryLandmarks } from './metric-face';

export type CameraIdentity = { deviceId: string; label: string; width: number; height: number; facingMode: string; zoom?: number; resizeMode: string };
export type CalibrationSnapshot = { baseline: EyeObservation; profile: GazeProfile; screen: ScreenGeometry; distance: number; ipd: number; eye: 'center'|'left'|'right'; geometryMode: 'metric'|'legacy' };
export type DisplayIdentity = { width: number; height: number; pixelRatio: number };
export type SavedCalibration = { version: 1; savedAt: number; camera: CameraIdentity; display: DisplayIdentity; calibration: CalibrationSnapshot; checks: { distance: number; meanPx: number; p95Px: number; worstTargetPx: number; samples: number }[] };
type StorageLike = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const prefix='gaze.webcam-calibration.v1:';
export const cameraPreferenceKey='gaze.selected-camera.v1';
export const calibrationStorageKey=(deviceId:string)=>prefix+encodeURIComponent(deviceId);
export function persistentCameraId(id: string) { return !!id && id!=='default' && id!=='communications'; }
export function currentDisplay(): DisplayIdentity { return {width:window.screen.width,height:window.screen.height,pixelRatio:window.devicePixelRatio}; }

type RecordValue = Record<string,unknown>;
const object=(value:unknown):value is RecordValue=>!!value && typeof value==='object' && !Array.isArray(value);
const number=(value:unknown,min=-1e5,max=1e5):value is number=>typeof value==='number' && Number.isFinite(value) && value>=min && value<=max;
const point=(value:unknown)=>object(value) && number(value.x) && number(value.y);
const vec=(value:unknown)=>point(value) && object(value) && number(value.z);
const text=(value:unknown)=>typeof value==='string' && value.length<=1024;
function plane(value:unknown):value is GazePlane {
  return object(value) && point(value.mean) && object(value.scale) && number(value.scale.x,.015) && number(value.scale.y,.015) && number(value.width,1,20000) && number(value.height,1,20000) && ['x','y'].every(axis=>Array.isArray(value[axis]) && value[axis].length===6 && value[axis].every(n=>number(n)));
}
function observation(value:unknown):value is EyeObservation {
  if (!object(value) || !point(value) || !number(value.span,18,10000) || !vec(value.left) || !vec(value.right) || !number(value.time,0,1e15) || !number(value.imageWidth,1,10000) || !number(value.imageHeight,1,10000) || !object(value.head)) return false;
  const head=value.head;
  if (!vec(head.origin) || !number(head.scale,3,10000) || !Array.isArray(head.axes) || head.axes.length!==3 || !head.axes.every(vec)) return false;
  const axes=head.axes as {x:number;y:number;z:number}[];
  if (axes.some(a=>Math.abs(Math.hypot(a.x,a.y,a.z)-1)>.02) || axes.some((a,i)=>axes.some((b,j)=>i!==j && Math.abs(a.x*b.x+a.y*b.y+a.z*b.z)>.02))) return false;
  return Array.isArray(value.face) && value.face.length===geometryLandmarks.length && value.face.every(vec);
}
export function validSavedCalibration(value:unknown):value is SavedCalibration {
  if (!object(value) || value.version!==1 || !number(value.savedAt,1,1e15) || !object(value.camera) || !object(value.display) || !object(value.calibration)) return false;
  const {camera,display,calibration:c}=value;
  if (!text(camera.deviceId) || !persistentCameraId(camera.deviceId as string) || !text(camera.label) || !text(camera.facingMode) || !text(camera.resizeMode) || !number(camera.width,1,10000) || !number(camera.height,1,10000) || (camera.zoom!==undefined && !number(camera.zoom,.01,100))) return false;
  if (!number(display.width,1,20000) || !number(display.height,1,20000) || !number(display.pixelRatio,.1,10)) return false;
  if (!observation(c.baseline) || !number(c.distance,.15,1.5) || !number(c.ipd,.04,.085) || !['center','left','right'].includes(c.eye as string) || !['metric','legacy'].includes(c.geometryMode as string) || !object(c.screen)) return false;
  const screen=c.screen;
  if (!number(screen.width,1,20000) || !number(screen.height,1,20000) || !number(screen.metersPerPixel,1e-6,.02) || !point(screen.center) || !plane(c.profile)) return false;
  const profile=c.profile as GazeProfile, layers=profile.layers;
  if (profile.width!==screen.width || profile.height!==screen.height || c.baseline.imageWidth!==camera.width || c.baseline.imageHeight!==camera.height || !Array.isArray(layers) || layers.length!==3) return false;
  if (!layers.every((l,i)=>object(l) && number(l.distance,.15,1.5) && (i===0 || l.distance-layers[i-1].distance>=.055) && plane(l.profile) && l.profile.width===profile.width && l.profile.height===profile.height && !('layers' in l.profile))) return false;
  const checks=value.checks;
  const diagonal=Math.hypot(profile.width,profile.height);
  return Array.isArray(checks) && checks.length===3 && checks.every(c=>object(c) && number(c.distance,.15,1.5) && layers.some(l=>Math.abs(l.distance-(c.distance as number))<1e-9) && number(c.meanPx,0,diagonal*.12) && number(c.p95Px,0,diagonal*.22) && number(c.worstTargetPx,0,diagonal*.2) && number(c.samples,75,10000)) && new Set(checks.map(c=>c.distance)).size===3;
}
export type CalibrationLoad = { kind:'found'; value:SavedCalibration } | {kind:'missing'|'invalid'|'unavailable'};
export function loadCalibration(storage:StorageLike,deviceId:string):CalibrationLoad {
  if (!persistentCameraId(deviceId)) return {kind:'missing'};
  let raw:string|null;
  try {raw=storage.getItem(calibrationStorageKey(deviceId));} catch {return {kind:'unavailable'};}
  if (!raw) return {kind:'missing'};
  if (raw.length>128000) return {kind:'invalid'};
  try {
    const value:unknown=JSON.parse(raw);
    return validSavedCalibration(value) && value.camera.deviceId===deviceId ? {kind:'found',value} : {kind:'invalid'};
  } catch { return {kind:'invalid'}; }
}
export function saveCalibration(storage:StorageLike,camera:CameraIdentity,display:DisplayIdentity,calibration:CalibrationSnapshot,result:DistanceResult):SavedCalibration|null {
  const record:SavedCalibration={version:1,savedAt:Date.now(),camera,display,calibration,checks:result.checks.map(c=>({distance:c.distance,meanPx:c.validation.meanPx,p95Px:c.validation.p95Px,worstTargetPx:c.validation.worstTargetPx,samples:c.validation.samples}))};
  if (!result.usable || !validSavedCalibration(record)) return null;
  try { storage.setItem(calibrationStorageKey(camera.deviceId),JSON.stringify(record)); return record; } catch { return null; }
}
export function forgetCalibration(storage:StorageLike,deviceId:string) {
  try { storage.removeItem(calibrationStorageKey(deviceId)); return true; } catch { return false; }
}
export function calibrationMismatch(saved:SavedCalibration,camera:CameraIdentity,display:DisplayIdentity,viewport:{width:number;height:number}):string|null {
  if (saved.camera.deviceId!==camera.deviceId) return 'This calibration belongs to another webcam.';
  if (saved.camera.width!==camera.width || saved.camera.height!==camera.height || saved.camera.facingMode!==camera.facingMode || saved.camera.zoom!==camera.zoom || saved.camera.resizeMode!==camera.resizeMode) return 'Camera resolution or lens settings changed. Recalibrate for these settings.';
  if (saved.display.width!==display.width || saved.display.height!==display.height || Math.abs(saved.display.pixelRatio-display.pixelRatio)>.001 || saved.calibration.screen.width!==viewport.width || saved.calibration.screen.height!==viewport.height) return 'Screen size, orientation or zoom changed. Restore the previous layout or recalibrate.';
  return null;
}
