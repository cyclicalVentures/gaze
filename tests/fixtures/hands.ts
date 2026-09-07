import type { HandPoint, HandFrame } from '../../lib/viewer/hand-gestures';
/** Synthetic landmarks in mirrored screen coordinates, palm span = .1 image widths. */
export function hand(x=.5,y=.45,pinched=false,ratio?:number):HandPoint[] {
  const aspect=.75;
  const p=(dx:number,dy:number)=>({x:1-(x+dx),y:y+dy/aspect,z:0});
  const points=Array.from({length:21},()=>p(0,0));
  points[0]=p(0,.06);points[9]=p(0,-.04);points[5]=p(-.04,-.03);points[17]=p(.04,-.03);
  const gap=(ratio ?? (pinched ? .15 : .8))*.1;
  points[4]=p(-gap/2,-.05);points[8]=p(gap/2,-.05);
  return points;
}
export const handFrame=(time:number,landmarks:HandPoint[][]):HandFrame=>({time,width:640,height:480,landmarks});
