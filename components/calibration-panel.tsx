'use client';
import { useEffect, useReducer, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, Crosshair, Pause, Play, RotateCcw, X } from 'lucide-react';
import { beginTuning, tune, tuningSteps, type ViewTuning } from '@/lib/viewer/tuning';
import type { TrackingStatus } from '@/lib/viewer/tracker';

export function CalibrationPanel({ initial, status, gazeValid, centering, onPreview, onSave, onCancel, onStart, onCenter }: {
  initial: ViewTuning; status: TrackingStatus; gazeValid: boolean; centering: boolean;
  onPreview: (value: ViewTuning) => void; onSave: (value: ViewTuning) => void; onCancel: (value: ViewTuning) => void; onStart: () => void; onCenter: () => void;
}) {
  const [session, dispatch] = useReducer(tune, initial, beginTuning);
  const title = useRef<HTMLHeadingElement>(null);
  const step = tuningSteps[session.index];
  const available = status === 'tracking' && !centering && (step.key !== 'eyeGain' || gazeValid);
  const running = available && !session.paused && !session.picked && !session.complete;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { onPreview(session.values); }, [session.values, onPreview]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 1800);
    return () => window.clearInterval(timer);
  }, [running, session.index]);
  return <section className="tuning-panel" aria-labelledby="tuning-title">
    <div className="tuning-heading"><h2 id="tuning-title" ref={title} tabIndex={-1}>Find your depth.</h2><button className="icon-button" aria-label="Cancel calibration and restore settings" onClick={() => onCancel(session.original)}><X size={18}/></button></div>
    <p className="tuning-intro">One setting changes at a time. Keep moving and choose what feels most convincing.</p>
    <ol className="tuning-progress" aria-label="Calibration progress">{tuningSteps.map((s, i) => <li key={s.key} className={session.complete || i < session.index ? 'is-done' : i === session.index ? 'is-current' : ''} aria-current={!session.complete && i === session.index ? 'step' : undefined}><span className="sr-only">{s.title}: {session.complete || i < session.index ? 'chosen' : i === session.index ? 'current' : 'upcoming'}</span></li>)}</ol>
    {session.complete ? <>
      <h3>Try it all together.</h3><p className="tuning-instruction">Move your head and eyes around the model. Your choices are applied now.</p>
      <dl className="tuning-summary"><div><dt>In / out direction</dt><dd>{session.values.depthDirection === -1 ? 'Grow when closer' : 'Physical window'}</dd></div>{tuningSteps.map(s => <div key={s.key}><dt>{s.title}</dt><dd>{session.values[s.key].toFixed(s.step < 1 ? 2 : 0)}{s.unit}</dd></div>)}</dl>
      <button className="button primary full-width" onClick={() => onSave(session.values)}><Check size={17}/>Save calibration</button>
      <p className="small-copy">Saves these settings in this browser. Recenter your eyes whenever you start the camera.</p>
    </> : <>
      <div className="tuning-step-title"><h3>{step.title}</h3><span>{session.index + 1} / {tuningSteps.length}</span></div>
      <p className="tuning-instruction">{step.instruction}</p>
      {step.key === 'depthGain' && <p className="small-copy">Direction: {session.values.depthDirection === -1 ? 'grow when closer' : 'physical window'}. To change it, cancel and use “Grow when closer” under View.</p>}
      <div className="tuning-value"><output htmlFor="tuning-value" aria-live="off">{session.values[step.key].toFixed(step.step < 1 ? 2 : 0)}<span>{step.unit}</span></output><span aria-live="polite">{!available ? 'Waiting for eyes' : session.picked ? 'Choice held' : running ? 'Trying values…' : 'Paused'}</span></div>
      <label className="sr-only" htmlFor="tuning-value">Fine-tune {step.title.toLowerCase()}</label>
      <input id="tuning-value" className="tuning-range" type="range" min={step.min} max={step.max} step={step.step} value={session.values[step.key]} disabled={!available} onChange={e => dispatch({ type: 'adjust', value: Number(e.target.value) })}/>
      <div className="tuning-bounds"><span>{step.min}{step.unit}</span><span>{step.max}{step.unit}</span></div>
      {!available && <div className="tuning-recovery" aria-live="polite"><p>{centering ? 'Look at the target until the countdown finishes.' : status === 'off' ? 'Start the camera to continue with the same settings.' : status === 'ready' ? 'Center your eyes to continue.' : status === 'starting' ? 'Waiting for the camera to start…' : 'Keep both eyes open and visible. The sweep will resume when tracking returns.'}</p>{status === 'off' && <button className="button secondary full-width" onClick={onStart}><Play size={16}/>Start camera</button>}{status === 'ready' && !centering && <button className="button secondary full-width" onClick={onCenter}><Crosshair size={16}/>Center eyes</button>}</div>}
      {session.picked ? <button className="button primary full-width" disabled={!available} onClick={() => dispatch({ type: 'next' })}>Keep this setting<ArrowRight size={17}/></button> : <button className="button primary full-width" disabled={!available} onClick={() => dispatch({ type: 'pick' })}><Check size={17}/>This looks best</button>}
      <div className="tuning-actions"><button className="button secondary" disabled={session.index === 0} onClick={() => dispatch({ type: 'back' })}><ArrowLeft size={15}/>Back</button><button className="button secondary" disabled={!available} onClick={() => dispatch({ type: 'pause' })}>{session.picked ? <RotateCcw size={15}/> : running ? <Pause size={15}/> : <Play size={15}/>} {session.picked ? 'Try again' : running ? 'Pause' : 'Resume'}</button></div>
      <p className="small-copy">Each value stays for 1.8 seconds. Drag the slider to pause and make a precise adjustment.</p>
    </>}
    <button className="text-button tuning-cancel" onClick={() => onCancel(session.original)}>Cancel & restore previous settings</button>
  </section>;
}
