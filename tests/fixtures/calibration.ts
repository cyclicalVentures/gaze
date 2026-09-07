import type { CalibrationSnapshot, CameraIdentity, DisplayIdentity } from '../../lib/viewer/calibration-storage';
import type { DistanceResult } from '../../lib/viewer/distance-calibration';
import { combineDistanceProfiles, type GazePlane } from '../../lib/viewer/gaze-calibration';
import { geometryLandmarks } from '../../lib/viewer/metric-face';
export const camera:CameraIdentity={deviceId:'camera-A',label:'Same webcam name',width:640,height:480,facingMode:'user',resizeMode:'crop-and-scale'};
export const display:DisplayIdentity={width:1440,height:900,pixelRatio:2};
export function calibrationFixture() {
  const plane:GazePlane={mean:{x:.5,y:.5},scale:{x:1,y:1},x:[.5,1,0,0,0,0],y:[.5,0,1,0,0,0],width:1200,height:800};
  const profile=combineDistanceProfiles([.4,.55,.7].map(distance=>({distance,profile:plane})))!;
  const calibration:CalibrationSnapshot={baseline:{x:320,y:200,span:63,left:{x:351.5,y:200,z:-12},right:{x:288.5,y:200,z:-12},head:{origin:{x:320,y:240,z:0},axes:[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}],scale:24},face:geometryLandmarks.map((_,i)=>({x:320+(i%3-1)*40,y:200+(Math.floor(i/3)-4)*12,z:-12})),imageWidth:640,imageHeight:480,time:1000},profile,screen:{width:1200,height:800,metersPerPixel:.0003,center:{x:600,y:400}},distance:.55,ipd:.063,eye:'center',geometryMode:'metric'};
  const result:DistanceResult={profile,meanPx:10,usable:true,checks:[.4,.55,.7].map((distance,i)=>({label:['Near','Normal','Far'][i],distance,validation:{meanPx:10,p95Px:15,worstTargetPx:12,samples:125,targets:[],usable:true}}))};
  return {calibration,result};
}
export function memoryStorage() {
  const map=new Map<string,string>();
  return {map,getItem:(key:string)=>map.get(key) ?? null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};
}
