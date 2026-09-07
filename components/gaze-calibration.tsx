'use client';
import { useEffect, useRef, useState } from 'react';
import { Crosshair, Pause, Play, RotateCcw, X } from 'lucide-react';
import type { HeadTracker, TrackingStatus } from '@/lib/viewer/tracker';
import { trainingTargets, validationTargets, type Point } from '@/lib/viewer/gaze-calibration';
import { calibrationDistances, DistanceCalibrationSession, type DistanceResult } from '@/lib/viewer/distance-calibration';

type Run = { session: DistanceCalibrationSession; rect: DOMRect; lastFrame: number };
type Props = { tracker: HeadTracker; status: TrackingStatus; onClose: () => void; onApply: (result: DistanceResult, revision: number) => boolean };
const snapshot=(s:DistanceCalibrationSession)=>({phase:s.phase,level:s.level,index:s.index,progress:s.progress,measured:s.measured,inRange:s.inRange,positioned:s.positioned,result:s.result});

export function GazeCalibration({ tracker, status, onClose, onApply }: Props) {
  const dialog=useRef<HTMLDialogElement>(null), board=useRef<HTMLDivElement>(null), run=useRef<Run|null>(null);
  const [steps]=useState(()=>calibrationDistances(tracker.distance));
  const [cameraName]=useState(()=>tracker.camera?.label || 'this webcam');
  const [view,setView]=useState<ReturnType<typeof snapshot>|null>(null);
  const [phase,setPhase]=useState<'intro'|'positioning'|'training'|'checking'|'results'|'error'>('intro');
  const [paused,setPaused]=useState(false), [waiting,setWaiting]=useState(false), [message,setMessage]=useState('');
  const [mapBounds,setMapBounds]=useState<{rect:DOMRect;width:number;height:number}|null>(null);
  const [checkIndex,setCheckIndex]=useState(0);
  const collecting=phase==='training' || phase==='checking', active=collecting || phase==='positioning';
  const step=steps[view?.level ?? 0], result=view?.result;
  useEffect(()=>{const element=dialog.current; element?.showModal(); return ()=>element?.close();},[]);
  const start=()=>{
    if (!board.current || status!=='tracking') return;
    const rect=board.current.getBoundingClientRect(),width=window.innerWidth,height=window.innerHeight;
    const targets=[...trainingTargets,...validationTargets].map(p=>({x:(rect.left+p.x*rect.width)/width,y:(rect.top+p.y*rect.height)/height}));
    const session=new DistanceCalibrationSession(tracker.calibrationRevision,steps,targets,width,height);
    run.current={session,rect,lastFrame:performance.now()}; setMapBounds({rect,width,height}); setView(snapshot(session));
    setPaused(false); setWaiting(true); setMessage(''); setCheckIndex(0); setPhase('positioning');
  };
  useEffect(()=>{
    if (!active) return;
    const current=run.current;
    if (!current) return;
    const {session}=current;
    session.resetFixation(); current.lastFrame=performance.now();
    const fail=(text:string)=>{setMessage(text);setPhase('error');};
    const valid=()=>{
      if (tracker.calibrationRevision!==session.revision) {fail('Tracking was reset. Close this panel, set your eye position, then calibrate again.');return false;}
      const rect=board.current?.getBoundingClientRect();
      if (window.innerWidth!==session.width || window.innerHeight!==session.height || !rect || (['width','height','top','left'] as const).some(key=>Math.abs(rect[key]-current.rect[key])>1)) {fail('The screen layout changed. Keep the device, page zoom and window fixed, then start again.');return false;}
      return true;
    };
    let finished=false;
    const unsubscribe=tracker.subscribeGaze(sample=>{
      if (finished || !valid() || paused) return;
      current.lastFrame=performance.now(); setWaiting(false); session.push(sample); setView(snapshot(session)); setPhase(session.phase);
      if (session.phase==='error') {finished=true;setMessage(session.error);}
      if (session.phase==='results') finished=true;
    });
    const timer=window.setInterval(()=>{
      if (!finished && valid() && !paused && performance.now()-current.lastFrame>700) {session.resetFixation();setView(snapshot(session));setWaiting(true);}
    },200);
    return ()=>{unsubscribe();window.clearInterval(timer);};
  },[active,paused,tracker]);
  const begin=()=>{
    const session=run.current?.session;
    if (!waiting && status==='tracking' && session?.beginDistance()) {setView(snapshot(session));setPhase(session.phase);}
  };
  const apply=()=>{
    const session=run.current?.session;
    if (!session?.result?.usable) return;
    if (!onApply(session.result,session.revision)) {setMessage('Tracking or screen settings changed. Close this panel and set your eye position again.');setPhase('error');}
  };
  const targetIndex=view?.index ?? 0;
  const target=targetIndex<9 ? trainingTargets[targetIndex] : validationTargets[targetIndex-9];
  const distanceHint=waiting ? 'Keep both eyes visible and open' : !view?.inRange ? `${(view?.measured ?? step.distance)>step.distance ? 'Move closer' : 'Move farther back'} to about ${(step.distance*100).toFixed(0)} cm` : 'Hold this distance and look at the dot';
  const checked=result?.checks[checkIndex];
  return <dialog ref={dialog} className="gaze-dialog" aria-labelledby="gaze-calibration-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="gaze-dialog-header"><h2 id="gaze-calibration-title">Calibrate across distances</h2><button className="icon-button" aria-label="Cancel gaze calibration" onClick={onClose}><X size={20}/></button></header>
    <div ref={board} className="gaze-target-board">
      {phase==='intro' && <div className="gaze-explanation"><Crosshair size={38}/><h3>Three distances. A fuller view.</h3><p>Follow nine dots, then five accuracy checks at each distance. Keep your head still during each set; move when prompted. Allow about two minutes.</p><ol className="gaze-distance-plan">{steps.map(s=><li key={s.label}><span>{s.label}</span><strong>{(s.distance*100).toFixed(0)} cm</strong></li>)}</ol><p className="small-copy">Distances are estimates from your physical calibration. Keep your screen and webcam fixed. Each set pauses if you drift away from its distance.</p><p className="small-copy">Save & use remembers calibration numbers and a sparse face reference locally for {cameraName}. Camera images and target recordings are not saved.</p></div>}
      {phase==='positioning' && <div className="gaze-explanation gaze-positioning"><Crosshair size={38}/><h3>{step.label} distance · {(step.distance*100).toFixed(0)} cm</h3><p>{view?.level ? 'Move your head to the next distance. Keep the screen and webcam still.' : 'Stay at your normal viewing position. Keep both eyes visible.'}</p><div className="gaze-distance-meter"><span>Estimated distance</span><output>{waiting || view?.measured===null ? '—' : ((view?.measured ?? 0)*100).toFixed(0)} <small>cm</small></output></div><p aria-live="polite">{view?.positioned && !waiting ? 'In position. Begin when you’re ready.' : distanceHint}</p><p className="small-copy">Distance {((view?.level ?? 0)+1)} of 3 · Nine learning targets, then five separate checks.</p></div>}
      {collecting && target && <><div className={`gaze-target ${paused || waiting || !view?.inRange ? 'is-waiting' : ''}`} style={{left:`${target.x*100}%`,top:`${target.y*100}%`}} aria-hidden="true"><i/><span/></div><div className="gaze-fixation-hint" aria-live="polite">{paused ? 'Paused' : distanceHint}</div></>}
      {phase==='error' && <div className="gaze-explanation"><h3>Let’s try that again.</h3><p aria-live="polite">{message}</p><p>Your saved calibration has not been replaced.</p></div>}
      {phase==='results' && result && <div className="gaze-results"><div><h3>{result.usable ? 'All three distances checked.' : 'This needs another pass.'}</h3><p>{result.usable ? 'The blended mapping passed five unseen targets at each distance.' : 'At least one distance did not pass. Try even lighting, reduce lens reflections, and hold each requested distance.'}</p><table className="gaze-distance-results"><caption>Error at 15 separate check positions · CSS pixels</caption><thead><tr><th scope="col">Distance</th><th scope="col">Average</th><th scope="col">95th %</th><th scope="col">Check</th></tr></thead><tbody>{result.checks.map(c=><tr key={c.label}><th scope="row">{c.label}<span>{(c.distance*100).toFixed(0)} cm</span></th><td>{c.validation.meanPx.toFixed(0)}</td><td>{c.validation.p95Px.toFixed(0)}</td><td>{c.validation.usable ? 'Pass' : 'Retry'}</td></tr>)}</tbody></table><p className="small-copy">{result.checks.reduce((sum,c)=>sum+c.validation.samples,0)} check samples. The viewer blends the mappings as you move between distances. Beyond the sampled range it uses the nearest mapping.</p><p className="small-copy">Saved only in this browser for {cameraName}. Recalibrate if you move the webcam or use a different screen.</p></div><div className="gaze-check-map"><fieldset className="gaze-check-tabs"><legend className="sr-only">Show accuracy check at distance</legend>{result.checks.map((c,i)=><button key={c.label} aria-pressed={i===checkIndex} onClick={()=>setCheckIndex(i)}>{c.label}</button>)}</fieldset><svg viewBox="0 0 100 100" aria-label={`${checked?.label} distance: targets and average predicted gaze positions`}>{checked?.validation.targets.map((t,i)=>{
        const r=mapBounds!, local=(p:Point)=>({x:(p.x*r.width-r.rect.left)/r.rect.width*100,y:(p.y*r.height-r.rect.top)/r.rect.height*100});
        const a=local(t.target),b=local(t.predicted);
        return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><circle className="check-target" cx={a.x} cy={a.y} r="2"/><circle className="check-predicted" cx={b.x} cy={b.y} r="1.5"/></g>;
      })}</svg><p><span>Teal: target</span><span>Coral: estimated gaze</span></p><p>Worst target average: {checked?.validation.worstTargetPx.toFixed(0)} px</p></div></div>}
    </div>
    <footer className="gaze-dialog-footer">
      {collecting ? <><div className="gaze-step"><span aria-live="polite">{step.label} · {phase==='training' ? `Learning ${targetIndex+1}/9` : `Checking ${targetIndex-8}/5`}</span><span className="gaze-distance-status">{waiting ? 'Eyes not visible' : `${((view?.measured ?? 0)*100).toFixed(0)} cm`} / aim {(step.distance*100).toFixed(0)} cm · {((view?.level ?? 0)*14+targetIndex+1)}/42</span><progress aria-label="Current target capture" value={view?.progress ?? 0} max={1}/></div><button className="button secondary" onClick={()=>setPaused(!paused)}>{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? 'Resume' : 'Pause'}</button></> : <p>{phase==='intro' ? '27 learning targets. 15 independent checks.' : phase==='positioning' ? 'Move your head; keep your device still.' : phase==='results' ? 'Save this mapping for the current webcam.' : 'No incomplete mapping will be saved.'}</p>}
      <div className="gaze-footer-actions"><button className="button secondary" onClick={onClose}>{phase==='results' ? 'Keep previous' : 'Cancel'}</button>{phase==='positioning' ? <button className="button primary" disabled={!view?.positioned || waiting || status!=='tracking'} onClick={begin}>Begin {step.label.toLowerCase()} set</button> : !collecting && <button className={`button ${phase==='results' && result?.usable ? 'secondary' : 'primary'}`} disabled={status!=='tracking'} onClick={start}>{phase==='intro' ? <><Crosshair size={16}/> Start</> : <><RotateCcw size={16}/> Try again</>}</button>}{phase==='results' && result?.usable && <button className="button primary" onClick={apply}>Save & use</button>}</div>
    </footer>
  </dialog>;
}
