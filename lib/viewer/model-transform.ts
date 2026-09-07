import { Euler, Quaternion, type Object3D } from 'three';
import type { GestureDelta } from './hand-gestures';
export function applyModelGesture(model:Object3D,zoom:number,delta:GestureDelta,view:Quaternion):number {
  const {x,y,z}=delta.rotation;
  if (![x,y,z,delta.scale].every(Number.isFinite) || delta.scale<.75 || delta.scale>1.33 || Math.max(Math.abs(x),Math.abs(y),Math.abs(z))>.5) return zoom;
  const rotation=new Quaternion().setFromEuler(new Euler(x,y,z,'YXZ'));
  rotation.premultiply(view).multiply(view.clone().invert());
  model.quaternion.premultiply(rotation).normalize();
  return Math.max(.2,Math.min(2.5,zoom*delta.scale));
}
