export type HandPoint = { x: number; y: number; z: number };
export type HandFrame = { time: number; width: number; height: number; landmarks: HandPoint[][] };
export type GestureDelta = { scale: number; rotation: { x: number; y: number; z: number } };
export type GestureMode = 'searching'|'release'|'idle'|'arming'|'rotate'|'scale';
export type HandFeedback = { mode: GestureMode; points: { x: number; y: number; pinched: boolean }[] };
export type GestureResult = HandFeedback & { delta: GestureDelta | null };
type Point = { x: number; y: number };
type Observation = { palm: Point; grip: Point; ratio: number };
type TrackedHand = Observation & { id: number; pinched: boolean; filtered: Point };
const gapLimit=300, closeRatio=.30, openRatio=.48;
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const angle=(a:Point,b:Point)=>Math.atan2(b.y-a.y,b.x-a.x);

/** Mirror like the camera preview and measure both axes in image-width units. */
export function observeHand(points:HandPoint[],aspect:number):Observation|null {
  if (points.length!==21 || !points.every(p=>Number.isFinite(p.x+p.y+p.z))) return null;
  const p=(i:number)=>({x:1-points[i].x,y:points[i].y*aspect,z:points[i].z});
  const d=(a:number,b:number)=>Math.hypot(p(a).x-p(b).x,p(a).y-p(b).y,p(a).z-p(b).z);
  const palmSize=Math.max(d(0,9),d(5,17));
  if (palmSize<.035 || palmSize>.65 || [0,4,8,9].some(i=>points[i].x<0 || points[i].x>1 || points[i].y<0 || points[i].y>1)) return null;
  const palm=[0,5,9,17].map(p).reduce((a,b)=>({x:a.x+b.x/4,y:a.y+b.y/4}),{x:0,y:0});
  return {palm,grip:{x:(p(4).x+p(8).x)/2,y:(p(4).y+p(8).y)/2},ratio:d(4,8)/palmSize};
}

/** Pinching is a clutch. Loss, jumps and release never produce a transform. */
export class HandGestures {
  private hands:TrackedHand[]=[];
  private nextId=0;
  private lastTime=-Infinity;
  private dimensions='';
  private requireRelease=true;
  private candidate='';
  private since=0;
  private previous:Point[]=[];
  reset() {
    this.hands=[];this.requireRelease=true;this.candidate='';this.previous=[];this.since=0;this.lastTime=-Infinity;this.dimensions='';
  }
  private release() {this.requireRelease=true;this.candidate='';this.previous=[];}
  update(frame:HandFrame):GestureResult {
    const empty=(mode:GestureMode):GestureResult=>({mode,points:[],delta:null});
    if (!Number.isFinite(frame.time) || frame.time<=this.lastTime) return empty('searching');
    const dt=frame.time-this.lastTime, dimensions=`${frame.width}x${frame.height}`;
    if (dt>gapLimit || this.dimensions!==dimensions) {this.hands=[];this.release();}
    this.dimensions=dimensions;this.lastTime=frame.time;
    if (!(frame.width>0 && frame.height>0) || !Number.isFinite(frame.width+frame.height)) {this.release();return empty('searching');}
    const aspect=frame.height/frame.width;
    const observations=frame.landmarks.slice(0,2).map(p=>observeHand(p,aspect)).filter((p):p is Observation=>!!p);
    if (!observations.length) {this.hands=[];this.release();return empty('searching');}
    // Match by palm continuity, never by detection-array order or handedness labels.
    const available=new Set(this.hands.map(h=>h.id));
    const pairs=observations.flatMap((o,i)=>this.hands.map(h=>({i,hand:h,cost:distance(o.palm,h.palm)}))).sort((a,b)=>a.cost-b.cost);
    const matches=new Map<number,TrackedHand>();
    for (const pair of pairs) if (pair.cost<.18 && available.has(pair.hand.id) && !matches.has(pair.i)) {matches.set(pair.i,pair.hand);available.delete(pair.hand.id);}
    if (available.size) this.release();
    const alpha=1-Math.exp(-Math.min(dt,100)/55);
    this.hands=observations.map((o,i)=>{
      const old=matches.get(i),pinched=o.ratio<(old?.pinched ? openRatio : closeRatio);
      return {...o,id:old?.id ?? ++this.nextId,pinched,filtered:old ? {x:old.filtered.x+(o.grip.x-old.filtered.x)*alpha,y:old.filtered.y+(o.grip.y-old.filtered.y)*alpha} : {...o.grip}};
    }).sort((a,b)=>a.id-b.id);
    const feedback=(mode:GestureMode,delta:GestureDelta|null=null):GestureResult=>({mode,delta,points:this.hands.map(h=>({x:h.filtered.x,y:h.filtered.y/aspect,pinched:h.pinched}))});
    if (this.requireRelease) {
      if (this.hands.some(h=>h.ratio<openRatio)) return feedback('release');
      this.requireRelease=false;
    }
    const pinched=this.hands.filter(h=>h.pinched);
    if (!pinched.length) {this.candidate='';this.previous=[];return feedback('idle');}
    const key=pinched.map(h=>h.id).join(','), grips=pinched.map(h=>h.filtered);
    if (this.previous.length===2 && grips.length<2) {this.release();return feedback('release');}
    if (grips.length===2 && distance(grips[0],grips[1])<.08) {this.release();return feedback('release');}
    if (key!==this.candidate) {this.candidate=key;this.since=frame.time;this.previous=grips;return feedback('arming');}
    if (frame.time-this.since<150) {this.previous=grips;return feedback('arming');}
    const before=this.previous;this.previous=grips;
    if (before.length!==grips.length) return feedback('arming');
    let delta:GestureDelta;
    if (grips.length===1) {
      const dx=grips[0].x-before[0].x,dy=grips[0].y-before[0].y;
      if (Math.hypot(dx,dy)>.12) {this.release();return feedback('release');}
      delta={scale:1,rotation:{x:dy*4,y:dx*4,z:0}};
    } else {
      const scale=distance(grips[0],grips[1])/distance(before[0],before[1]);
      const raw=angle(grips[0],grips[1])-angle(before[0],before[1]);
      const twist=Math.atan2(Math.sin(raw),Math.cos(raw));
      if (!Number.isFinite(scale) || scale<.75 || scale>1.33 || Math.abs(twist)>.4) {this.release();return feedback('release');}
      delta={scale,rotation:{x:0,y:0,z:-twist}};
    }
    return feedback(grips.length===1 ? 'rotate' : 'scale',delta);
  }
}
