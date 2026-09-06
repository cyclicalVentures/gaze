'use client';
import { useEffect, useRef, useState } from 'react';
import { Crosshair, Pause, Play, RotateCcw, X } from 'lucide-react';
import type { HeadTracker, TrackingStatus } from '@/lib/viewer/tracker';
import { FixationCollector, fitGazeProfile, validateGaze, trainingTargets, validationTargets, type Point, type GazeProfile, type GazeValidation, type TargetSamples } from '@/lib/viewer/gaze-calibration';

type Run = { revision: number; width: number; height: number; rect: DOMRect; targets: Point[]; index: number; rows: TargetSamples[]; collector: FixationCollector; profile: GazeProfile | null; lastFrame: number };
type Props = { tracker: HeadTracker; status: TrackingStatus; onClose: () => void; onApply: (profile: GazeProfile, revision: number, result: GazeValidation) => boolean };

export function GazeCalibration({ tracker, status, onClose, onApply }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), board = useRef<HTMLDivElement>(null), run = useRef<Run | null>(null);
  const [phase, setPhase] = useState<'intro'|'training'|'checking'|'results'|'error'>('intro');
  const [index, setIndex] = useState(0), [progress, setProgress] = useState(0), [paused, setPaused] = useState(false), [waiting, setWaiting] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ rect: DOMRect; width: number; height: number } | null>(null);
  const [message, setMessage] = useState(''), [result, setResult] = useState<GazeValidation | null>(null);
  const running = phase === 'training' || phase === 'checking';
  useEffect(() => { const element=dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);

  const start = () => {
    if (!board.current || status !== 'tracking') return;
    const rect=board.current.getBoundingClientRect(), width=window.innerWidth, height=window.innerHeight;
    const targets=[...trainingTargets,...validationTargets].map(p=>({x:(rect.left+p.x*rect.width)/width,y:(rect.top+p.y*rect.height)/height}));
    setMapBounds({rect,width,height});
    run.current={revision:tracker.calibrationRevision,width,height,rect,targets,index:0,rows:[],collector:new FixationCollector(),profile:null,lastFrame:performance.now()};
    setIndex(0); setProgress(0); setPaused(false); setWaiting(false); setResult(null); setMessage(''); setPhase('training');
  };
  useEffect(() => {
    if (!running || paused) return;
    const session=run.current;
    if (!session) return;
    session.collector.reset(); session.lastFrame=performance.now();
    const fail=(message:string)=>{ setMessage(message); setPhase('error'); };
    const valid=()=>{
      if (tracker.calibrationRevision!==session.revision) { fail('Tracking was reset. Close this panel, center your eyes, then calibrate again.'); return false; }
      const rect=board.current?.getBoundingClientRect();
      if (window.innerWidth!==session.width || window.innerHeight!==session.height || !rect || Math.abs(rect.width-session.rect.width)>1 || Math.abs(rect.height-session.rect.height)>1 || Math.abs(rect.top-session.rect.top)>1) { fail('The screen size changed. Keep the window and device still, then start again.'); return false; }
      return true;
    };
    let finished=false;
    const unsubscribe=tracker.subscribeGaze(sample=>{
      if (finished || !valid() || sample.revision!==session.revision) return;
      session.lastFrame=performance.now(); setWaiting(false);
      const collected=session.collector.push(sample); setProgress(collected.progress);
      if (!collected.samples) return;
      session.rows.push({target:session.targets[session.index],samples:collected.samples});
      session.index++; session.collector.reset(); setProgress(0); setIndex(session.index);
      if (session.index===9) {
        session.profile=fitGazeProfile(session.rows,session.width,session.height);
        if (!session.profile) { finished=true; fail('We could not distinguish the target positions. Use brighter, even lighting, keep your head still, and look directly at each dot. Then try again.'); return; }
        setPhase('checking');
      } else if (session.index===14 && session.profile) {
        finished=true; setResult(validateGaze(session.profile,session.rows.slice(9))); setPhase('results');
      }
    });
    const timer=window.setInterval(()=>{ if (!finished && valid()) setWaiting(performance.now()-session.lastFrame>700); },200);
    return ()=>{ unsubscribe(); window.clearInterval(timer); };
  },[running,phase,paused,tracker]);

  const target = index<9 ? trainingTargets[index] : validationTargets[index-9];
  const apply = () => {
    const session=run.current;
    if (!session?.profile || !result?.usable) return;
    if (!onApply(session.profile,session.revision,result)) { setMessage('Tracking or screen size changed after the check. Center your eyes and calibrate again.'); setPhase('error'); }
  };
  return <dialog ref={dialog} className="gaze-dialog" aria-labelledby="gaze-calibration-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="gaze-dialog-header"><h2 id="gaze-calibration-title">Calibrate your gaze</h2><button className="icon-button" aria-label="Cancel gaze calibration" onClick={onClose}><X size={20}/></button></header>
    <div ref={board} className="gaze-target-board">
      {phase==='intro' && <div className="gaze-explanation"><Crosshair size={38}/><h3>Follow the dot with your eyes.</h3><p>Keep your head still at your centered position. Look at each dot until it moves. No clicking needed.</p><p>We learn from nine positions, then check five different positions. About 30 seconds in good lighting. Blinks pause collection.</p><p className="small-copy">Keep the device, window size and page zoom fixed. The calibration stays on this device for this camera session.</p></div>}
      {running && target && <><div className={`gaze-target ${paused || waiting ? 'is-waiting' : ''}`} style={{left:`${target.x*100}%`,top:`${target.y*100}%`}} aria-hidden="true"><i/><span/></div><div className="gaze-fixation-hint" aria-live="polite">{paused ? 'Paused' : waiting ? 'Keep both eyes visible and open' : 'Look at the center of the dot'}</div></>}
      {phase==='error' && <div className="gaze-explanation"><h3>Let’s try that again.</h3><p aria-live="polite">{message}</p><p>Your previous gaze calibration has not been replaced.</p></div>}
      {phase==='results' && result && <div className="gaze-results"><div><h3>{result.usable ? 'Gaze check complete.' : 'This needs another pass.'}</h3><p>{result.usable ? 'The new mapping passed a basic accuracy check at five unseen positions.' : 'The error was too large to apply this mapping. Try more even lighting, reduce lens reflections, and keep your head still.'}</p><dl><div><dt>Average error</dt><dd>{result.meanPx.toFixed(0)} px</dd></div><div><dt>95th percentile</dt><dd>{result.p95Px.toFixed(0)} px</dd></div><div><dt>Worst target average</dt><dd>{result.worstTargetPx.toFixed(0)} px</dd></div></dl><p className="small-copy">CSS pixels · {result.samples} samples · checked near your centered head position. This is an estimate, not a hardware eye-tracker measurement.</p></div><div className="gaze-check-map"><svg viewBox="0 0 100 100" aria-label="Five validation targets and their average predicted gaze positions">{result.targets.map((t,i)=>{
        const r=mapBounds!, local=(p:Point)=>({x:(p.x*r.width-r.rect.left)/r.rect.width*100,y:(p.y*r.height-r.rect.top)/r.rect.height*100});
        const a=local(t.target),b=local(t.predicted);
        return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><circle className="check-target" cx={a.x} cy={a.y} r="2"/><circle className="check-predicted" cx={b.x} cy={b.y} r="1.5"/></g>;
      })}</svg><p><span>Teal: target</span><span>Coral: estimated gaze</span></p></div></div>}
    </div>
    <footer className="gaze-dialog-footer">
      {running ? <><div className="gaze-step"><span aria-live="polite">{phase==='training' ? `Learning ${index+1} of 9` : `Checking ${index-8} of 5`}</span><progress aria-label="Current target capture" value={progress} max={1}/></div><button className="button secondary" onClick={()=>setPaused(!paused)}>{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? 'Resume' : 'Pause'}</button></> : <p>{phase==='intro' ? 'First: nine learning targets. Then: five checks.' : phase==='results' ? 'Choose whether to use this mapping.' : 'No incomplete mapping will be applied.'}</p>}
      <div className="gaze-footer-actions"><button className="button secondary" onClick={onClose}>{phase==='results' ? 'Keep previous' : 'Cancel'}</button>{!running && <button className={`button ${phase==='results' && result?.usable ? 'secondary' : 'primary'}`} disabled={status!=='tracking'} onClick={start}>{phase==='intro' ? <><Crosshair size={16}/> Start</> : <><RotateCcw size={16}/> Try again</>}</button>}{phase==='results' && result?.usable && <button className="button primary" onClick={apply}>Use calibration</button>}</div>
    </footer>
  </dialog>;
}
