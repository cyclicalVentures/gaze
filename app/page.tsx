'use client';
/* oxlint-disable next/no-img-element -- Quick Look needs an img child; the AR link uses a tiny local SVG. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Box, Camera, CameraOff, Check, Crosshair, Expand, Eye, FileBox, FolderOpen, Info, LoaderCircle, Maximize, Minus, Move3D, Plus, ScanFace, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { assetUrl } from '@/lib/base';
import type { ViewerEngine } from '@/lib/viewer/engine';
import type { HeadTracker, TrackingStatus } from '@/lib/viewer/tracker';
import type { ModelInfo } from '@/lib/viewer/model';
import { validateFile } from '@/lib/viewer/file';
import { CalibrationPanel } from '@/components/calibration-panel';
import { defaultTuning, parseTuning, tuningStorageKey, type ViewTuning } from '@/lib/viewer/tuning';
import type { GazeReading } from '@/lib/viewer/eye-model';
import { GazeCalibration } from '@/components/gaze-calibration';
import type { GeometryMode } from '@/lib/viewer/tracker';

const cubeInfo: ModelInfo = { name: 'Depth cube', bytes: 0, format: 'PLY', vertices: 24, triangles: 12, meshes: 1, points: false, textures: 0 };
const formatNumber = (n: number) => new Intl.NumberFormat('en', { notation: n > 99999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
function PhysicalNumber({ label, ariaLabel, value, min, max, unit, onCommit }: { label: string; ariaLabel: string; value: number; min: number; max: number; unit: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.max(min, Math.min(max, parsed));
    setDraft(String(next)); if (next !== value) onCommit(next);
  };
  return <label className="number-field">{label}<span><input type="number" aria-label={ariaLabel} min={min} max={max} step={unit === 'cm' ? 0.5 : 1} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>{unit}</span></label>;
}
export default function Home() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const viewer = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<ViewerEngine | null>(null);
  const tracker = useRef<HeadTracker | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const operation = useRef(0);
  const alive = useRef(true);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState(cubeInfo);
  const [source, setSource] = useState('cube');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<TrackingStatus>('off');
  const [mode, setMode] = useState<'window' | 'orbit'>('window');
  const [preview, setPreview] = useState(false);
  const [focus, setFocus] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [room, setRoom] = useState(true);
  const [depth, setDepth] = useState(28);
  const [tuning, setTuning] = useState<ViewTuning>({ ...defaultTuning });
  const [tuningOpen, setTuningOpen] = useState(false);
  const [centering, setCentering] = useState<number | null>(null);
  const [gaze, setGaze] = useState<GazeReading | null>(null);
  const [gazeCalibrationTracker, setGazeCalibrationTracker] = useState<HeadTracker | null>(null);
  const [gazeCalibrated, setGazeCalibrated] = useState(false);
  const [geometryMode, setGeometryMode] = useState<GeometryMode>('metric');
  const [faceFit, setFaceFit] = useState<number | null>(null);
  const gazeButton = useRef<HTMLButtonElement>(null);
  const tuneButton = useRef<HTMLButtonElement>(null);
  const [screenWidth, setScreenWidth] = useState(34);
  const [distance, setDistance] = useState(55);
  const [ipd, setIpd] = useState(63);
  const [eye, setEye] = useState<'center' | 'left' | 'right'>('center');
  const [fps, setFps] = useState(0);
  const [telemetry, setTelemetry] = useState({ x: 0, y: 0, z: 55, measured: 55, neutral: 55, ms: 0 });
  const [arAvailable, setArAvailable] = useState(false);
  const [arUrl, setArUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const active = status !== 'off';
  const tracking = status === 'tracking';
  const statusLabel = { off: 'Camera off', starting: 'Starting camera…', ready: 'Ready to center', tracking: 'Tracking eyes', lost: 'Eyes not visible' }[status];

  useEffect(() => {
    alive.current = true;
    let canceled = false;
    let ownedEngine: ViewerEngine | undefined;
    let ownedTracker: HeadTracker | undefined;
    let lastTelemetry = 0;
    const mobile = window.innerWidth < 700;
    Promise.all([import('@/lib/viewer/engine'), import('@/lib/viewer/tracker')]).then(([{ ViewerEngine }, { HeadTracker }]) => {
      if (canceled || !canvasHost.current || !video.current) return;
      if (mobile) { setScreenWidth(7); setDistance(40); }
      const ar = document.createElement('a'); setArAvailable(ar.relList?.supports?.('ar') ?? false);
      try {
        engine.current = new ViewerEngine(canvasHost.current, setFps, setError);
        ownedEngine = engine.current;
        engine.current.distance = mobile ? 0.4 : 0.55; engine.current.center();
        tracker.current = new HeadTracker(video.current, s => {
          setStatus(s);
          if (s === 'off') { setGazeCalibrated(false); setFaceFit(null); }
          if (engine.current) { engine.current.tracking = s === 'tracking' || s === 'lost'; if (s === 'off') engine.current.center(); }
        }, (position, ms, reading, depthReading) => {
          engine.current?.setEye(position);
          if (performance.now() - lastTelemetry > 180) { setTelemetry({ x: position.x * 100, y: position.y * 100, z: position.z * 100, measured: (depthReading?.measured ?? position.z) * 100, neutral: (depthReading?.neutral ?? position.z) * 100, ms }); setGaze(reading ?? null); setFaceFit(depthReading?.errorPx ?? null); setGazeCalibrated(depthReading?.calibrated ?? false); lastTelemetry = performance.now(); }
        }, setError);
        tracker.current.distance = mobile ? 0.4 : 0.55;
        ownedTracker = tracker.current;
        let saved = { ...defaultTuning };
        try { saved = parseTuning(localStorage.getItem(tuningStorageKey)); } catch { /* Storage is optional. */ }
        tracker.current.tuning = saved; setTuning(saved); setDepth(saved.boxDepth); engine.current.setDepth(saved.boxDepth);
        setReady(true);
      } catch { setError('WebGL 2 is unavailable. Enable hardware acceleration or open this page in current Safari or Chrome.'); }
    }).catch(() => setError('The viewer could not load. Check your connection and reload the page.'));
    const pause = () => { if (document.hidden) { tracker.current?.stop(); setNote('Tracking paused while the app was in the background. Start it again when you’re ready.'); } };
    const pageHide = () => tracker.current?.stop();
    const orientation = () => { tracker.current?.stop(); setNote('Screen orientation changed. Start tracking and center your eyes again.'); };
    const resize = () => { if (engine.current) tracker.current?.setScreenGeometry(engine.current.getScreenGeometry()); setGazeCalibrated(false); };
    const fullscreen = () => { if (!document.fullscreenElement) setFocus(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(false); };
    document.addEventListener('visibilitychange', pause); window.addEventListener('pagehide', pageHide); window.addEventListener('orientationchange', orientation); document.addEventListener('fullscreenchange', fullscreen); window.addEventListener('keydown', escape);
    window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current async operation counter; this is not a DOM ref.
      canceled = true; alive.current = false; ++operation.current;
      ownedTracker?.stop(); ownedEngine?.dispose(); engine.current = null;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Release the latest local file URL, not the initial URL.
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      document.removeEventListener('visibilitychange', pause); window.removeEventListener('pagehide', pageHide); window.removeEventListener('orientationchange', orientation); document.removeEventListener('fullscreenchange', fullscreen); window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);

  const applyTuning = useCallback((value: ViewTuning) => {
    setTuning(value); setDepth(value.boxDepth);
    if (tracker.current) tracker.current.tuning = value;
    if (engine.current && Math.abs(engine.current.depth * 100 - value.boxDepth) > 0.001) engine.current.setDepth(value.boxDepth);
  }, []);
  const reverseDepth = (reverse: boolean) => {
    const next: ViewTuning = { ...tuning, depthDirection: reverse ? -1 : 1 };
    applyTuning(next);
    try { localStorage.setItem(tuningStorageKey, JSON.stringify(next)); }
    catch { setNote('Depth direction applied for this visit. Your browser could not save it.'); }
  };
  const closeTuning = (value: ViewTuning, save: boolean) => {
    applyTuning(value); setTuningOpen(false);
    if (save) {
      try { localStorage.setItem(tuningStorageKey, JSON.stringify(value)); setNote('Calibration saved in this browser. Recenter after moving your screen or camera.'); }
      catch { setNote('Calibration applied for this visit. Your browser could not save it.'); }
    } else setNote('Previous calibration restored.');
    requestAnimationFrame(() => tuneButton.current?.focus());
  };
  useEffect(() => {
    if (centering === null) return;
    const timer = window.setTimeout(() => {
      if (status !== 'ready' && status !== 'tracking') { setCentering(null); setNote('Keep both eyes visible, then try centering again.'); return; }
      if (centering > 1) { setCentering(centering - 1); return; }
      setCentering(null);
      if (tracker.current?.calibrate()) { engine.current?.calibrateOrigin(); if (engine.current) tracker.current.setScreenGeometry(engine.current.getScreenGeometry()); setGazeCalibrated(false); setNote('Eye position set. Calibrate gaze with the screen targets, or move gently to look into the box.'); }
      else setNote('Hold your head still and look at the target. Then try centering again.');
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [centering, status]);

  const load = useCallback(async (file?: File) => {
    if (!engine.current) return;
    const id = ++operation.current;
    engine.current.cancelPendingLoad();
    try {
      if (file) validateFile(file.name, file.size);
      setError(''); setLoading(file?.name ?? 'USDZ-test.usdz');
      let buffer: ArrayBuffer;
      if (file) buffer = await file.arrayBuffer();
      else { const response = await fetch(assetUrl('/models/USDZ-test.usdz')); if (!response.ok) throw new Error('The demo model could not be downloaded. Try again.'); buffer = await response.arrayBuffer(); }
      if (!alive.current || id !== operation.current) return;
      // Let the loading message paint before parsing the geometry.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const next = await engine.current.load(buffer, file?.name ?? 'USDZ-test.usdz');
      if (!next || !alive.current || id !== operation.current) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = file && next.format === 'USDZ' ? URL.createObjectURL(new Blob([buffer], { type: 'model/vnd.usdz+zip' })) : null;
      setArUrl(next.format === 'USDZ' ? objectUrl.current ?? assetUrl('/models/USDZ-test.usdz') : '');
      setInfo(next); setSource(file ? 'local' : 'usdz');
      setNote(next.points ? 'PLY point cloud loaded. Gaussian splat attributes, if present, are shown as points.' : 'Model loaded. Use Orbit to inspect or Window for head-coupled depth.');
    } catch (e) { if (alive.current && id === operation.current) setError((e as Error).message || 'This model could not be opened. Export a standard mesh and try again.'); }
    finally { if (alive.current && id === operation.current) setLoading(''); }
  }, []);
  const showCube = useCallback(() => {
    if (!engine.current) return;
    ++operation.current; setLoading(''); setInfo(engine.current.showCube()); setSource('cube'); setArUrl(''); setError(''); setNote('');
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
  }, []);
  const changeMode = (value: 'window' | 'orbit') => {
    tracker.current?.stop(); setMode(value); engine.current?.setMode(value); setPreview(false); if (engine.current) engine.current.pointerPreview = false;
  };
  const startTracking = () => {
    setError(''); setNote(''); setMode('window'); setPreview(false);
    if (engine.current) { engine.current.setMode('window'); engine.current.pointerPreview = false; }
    void tracker.current?.start();
  };
  const recenter = () => {
    if (!active) { engine.current?.center(); return; }
    setNote(''); setCentering(3);
  };
  const fullscreen = async () => {
    if (focus) { setFocus(false); if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); }
    else { setFocus(true); if (viewer.current?.requestFullscreen) await viewer.current.requestFullscreen().catch(() => {}); }
  };
  const changePreview = (checked: boolean) => { setPreview(checked); if (engine.current) { engine.current.pointerPreview = checked; if (!checked) engine.current.center(); } };
  const calibrationChanged = () => { if (active) { tracker.current?.stop(); setNote('Calibration updated. Start tracking and center your eyes again.'); } };

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: unknown) => unknown } }).modelContext;
    if (!context?.registerTool || !ready) return;
    const lifecycle = new AbortController();
    try { void Promise.resolve(context.registerTool({ name: 'show_depth_cube', title: 'Show the depth cube', description: 'Replace the current model with the built-in geometric cube in the 3D viewer.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); showCube(); await new Promise<void>(r => requestAnimationFrame(() => r())); return { model: 'Depth cube', triangles: 12 }; } }, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional browser API. */ }
    return () => lifecycle.abort();
  }, [ready, showCube]);

  return <main className={`app-shell ${tuningOpen ? 'is-tuning' : ''}`}>
    <header className="app-header">
      <a className="brand" href={assetUrl('/')} aria-label="Gaze home"><svg viewBox="0 0 40 32" aria-hidden="true"><path d="M2 16 13 5h14l11 11-11 11H13Z"/><circle cx="20" cy="16" r="5"/></svg><span>gaze<span className="brand-dot">.</span></span></a>
      <div className="app-title">Spatial viewer <span>PLY / USDZ</span></div>
      <button className="button primary header-open" onClick={() => input.current?.click()} disabled={!ready || !!loading}><FolderOpen size={17} /> Open model</button>
    </header>
    <div className="workspace">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- File drop is an alternative to the keyboard-accessible Open model button. */}
      <section ref={viewer} className={`viewer ${focus ? 'is-focused' : ''}`} aria-label="3D model viewer" onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) void load(file); }}>
        <div ref={canvasHost} className="canvas-host" />
        <div className="viewport-heading"><div className="scene-name"><Box size={16}/><span>{info.name}</span></div><span className={`live-status ${tracking ? 'is-live' : ''}`}><i />{active ? statusLabel : preview ? 'Pointer preview' : mode === 'orbit' ? 'Orbit view' : 'Window view'}</span></div>
        <div className="viewport-corner corner-tl"/><div className="viewport-corner corner-tr"/><div className="viewport-corner corner-bl"/><div className="viewport-corner corner-br"/>
        {centering !== null && <div className="centering-target" aria-live="polite" aria-atomic="true"><Crosshair size={38}/><strong>{centering}</strong><span>Look here. Hold your head still.</span></div>}
        {!ready && !error && <div className="canvas-message"><LoaderCircle className="spin"/><p>Opening the 3D window…</p></div>}
        {!!loading && <div className="canvas-message loading"><LoaderCircle className="spin"/><p>Opening {loading}</p><span>Preparing geometry and textures</span></div>}
        {dragging && <div className="drop-zone"><FolderOpen size={36}/><strong>Drop your model here</strong><span>PLY or USDZ · up to 150 MB</span></div>}
        <div className="viewport-bottom">
          <div className="view-hint"><span className="axis-mark"><i>X</i><i>Y</i><i>Z</i></span><span>{tracking ? 'Move your head. The window stays still.' : preview ? 'Move your pointer or drag to shift your viewpoint.' : mode === 'orbit' ? 'Drag to rotate · Scroll or pinch to zoom' : 'A window into depth. Enable tracking to look inside.'}</span></div>
          <div className="viewport-tools">
            <button className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => engine.current?.scaleBy(1 / 1.15)}><Minus size={17}/></button>
            <button className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => engine.current?.scaleBy(1.15)}><Plus size={17}/></button>
            <span className="tool-divider"/>
            <button className="icon-button" title={active ? 'Recenter eye position' : 'Reset view'} aria-label={active ? 'Recenter eye position' : 'Reset view'} onClick={recenter}><Crosshair size={18}/></button>
            {focus && active && <button className="icon-button" title="Stop tracking" aria-label="Stop tracking" onClick={() => tracker.current?.stop()}><CameraOff size={18}/></button>}
            <button className="icon-button" disabled={tuningOpen} title={focus ? 'Exit full view' : 'Full view'} aria-label={focus ? 'Exit full view' : 'Full view'} onClick={() => void fullscreen()}>{focus ? <X size={18}/> : <Expand size={18}/>}</button>
          </div>
        </div>
      </section>
      <aside className="inspector" aria-label="Viewer controls">
        {tuningOpen && <CalibrationPanel initial={tuning} status={status} gazeValid={gaze?.valid ?? false} centering={centering !== null} onPreview={applyTuning} onSave={value => closeTuning(value, true)} onCancel={value => closeTuning(value, false)} onStart={startTracking} onCenter={recenter}/>}
        <div className="normal-controls">
        <div className="inspector-title"><h1>Look into it.</h1><span className="subtle-icon"><Move3D size={20}/></span></div>
        <p className="intro">Your screen becomes a window.<br/>Your movement reveals the depth.</p>
        <section className="control-section tracking-section" aria-labelledby="tracking-title">
          <div className="section-heading"><h2 id="tracking-title"><Eye size={17}/> Head & eye tracking</h2><span className="small-tag">BETA</span></div>
          <div className={`camera-preview ${active ? 'camera-on' : ''}`}>
            <video ref={video} muted playsInline autoPlay aria-label="Your camera preview, processed only on this device" />
            {!active && <div className="camera-off"><ScanFace size={30}/><span>Make room for a little perspective.</span></div>}
            {active && <div className="camera-label"><i className={tracking ? 'dot-live' : ''}/>{statusLabel}</div>}
          </div>
          <p className="tracking-instruction">{status === 'starting' ? 'Allow the front camera. The tracker may take a few seconds to load.' : status === 'ready' ? 'Set your eye position, then look at the target during the countdown.' : status === 'lost' ? 'Bring both eyes back into view. The perspective is held until tracking returns.' : tracking ? 'Eye centers follow your head. Iris direction adds eye movement. Tune the effect below.' : 'Reconstructs your eye centers and gaze direction to update the 3D perspective.'}</p>
          <button className={`button ${active ? 'secondary' : 'primary'} full-width`} disabled={!ready} onClick={active ? () => tracker.current?.stop() : startTracking}>{status === 'starting' ? <><X size={17}/>Cancel camera setup</> : active ? <><CameraOff size={17}/>Stop tracking</> : <><Camera size={17}/>Enable head tracking<ArrowUpRight size={17}/></>}</button>
          {active && status !== 'starting' && <button className="button teal-action full-width" onClick={recenter} disabled={status === 'lost' || centering !== null}><Crosshair size={17}/>{centering !== null ? 'Look at the target…' : tracking ? 'Recenter eye position' : 'Set eye position'}</button>}
          <span className="privacy"><ShieldCheck size={13}/> Camera and files stay on this device</span>
          {tracking && <><div className="tracking-data"><span>X <b>{telemetry.x.toFixed(1)}</b></span><span>Y <b>{telemetry.y.toFixed(1)}</b></span><span>View Z <b>{telemetry.z.toFixed(0)}</b> cm</span></div><div className="depth-reading"><span>Estimated screen distance <b>{telemetry.measured.toFixed(0)} cm</b></span><span>{Math.abs(telemetry.measured - telemetry.neutral) < 1.5 ? 'At your centered distance' : `${telemetry.measured < telemetry.neutral ? 'Closer' : 'Farther'} by ${Math.abs(telemetry.measured - telemetry.neutral).toFixed(0)} cm`}</span></div></>}
          {tracking && gaze && <div className={`gaze-reading ${gaze.valid ? '' : 'is-uncertain'}`}><svg viewBox="0 0 100 38" aria-label="Estimated left and right eye orientation">{([gaze.right, gaze.left]).map((ray, i) => <g key={i} transform={`translate(${25 + i * 50} 19)`}><circle r="14"/><path d="M-18 0H18M0-18V18"/><line x1="0" y1="0" x2={-ray.x * 25} y2={ray.y * 25}/><circle className="iris-dot" cx={-ray.x * 12} cy={ray.y * 12} r="3"/></g>)}</svg><span>{gaze.valid ? <>Raw iris direction<br/><b>{gaze.yaw.toFixed(0)}° horizontal · {gaze.pitch.toFixed(0)}° vertical</b></> : 'Eye direction uncertain'}</span></div>}
          {tracking && faceFit !== null && <p className="calibration-hint">Face reprojection error: {faceFit.toFixed(1)} camera px</p>}
          <button ref={gazeButton} className="button teal-action full-width tune-entry" disabled={!tracking || centering !== null} onClick={() => { setNote(''); if (tracker.current && engine.current) { if (!tracker.current.hasGazeProfile) tracker.current.setScreenGeometry(engine.current.getScreenGeometry()); setGazeCalibrationTracker(tracker.current); } }}><Crosshair size={17}/>{gazeCalibrated ? 'Recheck gaze calibration' : 'Calibrate gaze with targets'}<ArrowUpRight size={17}/></button>
          <p className="calibration-hint">{gazeCalibrated ? 'Personal gaze mapping active for this camera session.' : 'Learn nine positions. Check accuracy at five new targets.'}</p>
          <button ref={tuneButton} className="button secondary full-width tune-entry" disabled={!tracking || centering !== null} onClick={() => { setNote(''); setTuningOpen(true); }}><SlidersHorizontal size={17}/>Tune the depth effect<ArrowUpRight size={17}/></button>
          <p className="calibration-hint">{tracking ? 'We vary each setting. You choose what looks best.' : 'Enable tracking and set your eye position to calibrate.'}</p>
        </section>
        <section className="control-section" aria-labelledby="view-title">
          <div className="section-heading"><h2 id="view-title"><SlidersHorizontal size={17}/> View</h2></div>
          <ToggleGroup className="view-mode" aria-label="View mode" value={[mode]} onValueChange={values => { const value = values[0]; if (value === 'window' || value === 'orbit') changeMode(value); }}><ToggleGroupItem value="window" aria-label="Window view"><Maximize size={16}/>Window</ToggleGroupItem><ToggleGroupItem value="orbit" aria-label="Orbit view"><Move3D size={16}/>Orbit</ToggleGroupItem></ToggleGroup>
          {mode === 'window' && <div className="toggle-row"><label htmlFor="preview">Pointer preview</label><Switch id="preview" checked={preview} disabled={active} onCheckedChange={changePreview}/></div>}
          {mode === 'window' && <><div className="toggle-row"><label htmlFor="reverse-depth">Grow when closer</label><Switch id="reverse-depth" checked={tuning.depthDirection === -1} onCheckedChange={reverseDepth}/></div><p className="calibration-hint depth-hint">{tuning.depthDirection === -1 ? 'Leaning closer enlarges the model on screen. Turn off for physical window scaling.' : 'Physical window scaling. Turn on if you want the model to grow on screen as you approach.'}</p></>}
          <div className="toggle-row"><label htmlFor="room">Depth box</label><Switch id="room" checked={room} onCheckedChange={v => { setRoom(v); engine.current?.setRoom(v); }}/></div>
          <div className="range-label"><span id="depth-label">Box depth</span><output>{depth} cm</output></div>
          <Slider aria-labelledby="depth-label" min={8} max={60} step={1} value={[depth]} onValueChange={v => { const n = Array.isArray(v) ? v[0] : v; applyTuning({ ...tuning, boxDepth: n }); }}/>
        </section>
        <section className="control-section" aria-labelledby="model-title">
          <div className="section-heading"><h2 id="model-title"><FileBox size={17}/> Model</h2><button className="text-button" disabled={!ready || !!loading} onClick={() => input.current?.click()}>Open file<ArrowUpRight size={14}/></button></div>
          <Select value={source} onValueChange={v => { if (v === 'cube') showCube(); if (v === 'usdz') void load(); }}><SelectTrigger className="model-select" aria-label="Choose demo model" disabled={!ready || !!loading}><SelectValue>{source === 'cube' ? 'Depth cube' : source === 'usdz' ? 'USDZ test model' : info.name}</SelectValue></SelectTrigger><SelectContent><SelectItem value="cube">Depth cube</SelectItem><SelectItem value="usdz">USDZ test model</SelectItem>{source === 'local' && <SelectItem value="local">{info.name}</SelectItem>}</SelectContent></Select>
          <dl className="model-stats"><div><dt>Vertices</dt><dd>{formatNumber(info.vertices)}</dd></div><div><dt>{info.points ? 'Type' : 'Triangles'}</dt><dd>{info.points ? 'Points' : formatNumber(info.triangles)}</dd></div><div><dt>{source === 'cube' ? 'Source' : 'File size'}</dt><dd>{source === 'cube' ? 'Built in' : `${(info.bytes / 1048576).toFixed(1)} MB`}</dd></div></dl>
          <div className="toggle-row"><label htmlFor="wireframe">Wireframe</label><Switch id="wireframe" checked={wireframe} disabled={info.points} onCheckedChange={v => { setWireframe(v); engine.current?.setWireframe(v); }}/></div>
          {source !== 'cube' && <div className="rotate-actions"><span>Rotate 90°</span>{(['x', 'y', 'z'] as const).map(axis => <button className="axis-button" key={axis} aria-label={`Rotate model 90 degrees around ${axis}`} onClick={() => engine.current?.rotateModel(axis)}>{axis.toUpperCase()}</button>)}</div>}
          {arUrl && arAvailable && <a className="button secondary full-width ar-link" href={arUrl} rel="ar"><img src={assetUrl('/favicon.svg')} width="18" height="18" alt=""/>View in your space<ArrowUpRight size={16}/></a>}
        </section>
        <details className="control-section calibration"><summary><span><Crosshair size={17}/> Physical calibration</span><Plus size={15}/></summary>
          <p>Measure the width of this browser’s visible page, then your eye-to-screen distance. Center your face on the 3D window before tracking.</p>
          <span className="eye-label" id="geometry-label">Head reconstruction</span><Select value={geometryMode} onValueChange={v => { if (v === 'metric' || v === 'legacy') { setGeometryMode(v); tracker.current?.setGeometryMode(v); setGazeCalibrated(false); setFaceFit(null); } }}><SelectTrigger className="model-select" aria-labelledby="geometry-label"><SelectValue>{geometryMode === 'metric' ? 'Face reprojection' : 'Original nose scale'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="metric">Face reprojection</SelectItem><SelectItem value="legacy">Original nose scale</SelectItem></SelectContent></Select>
          <p className="small-copy">Face reprojection fits a calibrated face shape to camera landmarks. Switch to the original estimate to compare. Changing methods clears gaze calibration.</p>
          <PhysicalNumber key={`width-${screenWidth}`} label="Page width" ariaLabel="Visible browser page width in centimeters" value={screenWidth} min={5} max={200} unit="cm" onCommit={n => { setScreenWidth(n); engine.current?.setPhysicalWidth(n); calibrationChanged(); }}/>
          <PhysicalNumber key={`distance-${distance}`} label="Viewing distance" ariaLabel="Eye to screen distance in centimeters" value={distance} min={15} max={150} unit="cm" onCommit={n => { setDistance(n); if (tracker.current) tracker.current.distance = n / 100; if (engine.current) { engine.current.distance = n / 100; engine.current.center(); } calibrationChanged(); }}/>
          <PhysicalNumber key={`ipd-${ipd}`} label="Pupil distance" ariaLabel="Interpupillary distance in millimeters" value={ipd} min={40} max={85} unit="mm" onCommit={n => { setIpd(n); if (tracker.current) tracker.current.ipd = n / 1000; calibrationChanged(); }}/>
          <span className="eye-label" id="eye-label">Viewpoint</span><Select value={eye} onValueChange={v => { if (v === 'center' || v === 'left' || v === 'right') { setEye(v); if (tracker.current) { tracker.current.eye = v; tracker.current.clearGazeProfile(); } setGazeCalibrated(false); } }}><SelectTrigger className="model-select" aria-labelledby="eye-label"><SelectValue>{eye === 'center' ? 'Between both eyes' : eye === 'left' ? 'Left eye' : 'Right eye'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="center">Between both eyes</SelectItem><SelectItem value="left">Left eye</SelectItem><SelectItem value="right">Right eye</SelectItem></SelectContent></Select>
          <p className="small-copy">These are starting estimates, not device measurements. You can use your dominant eye as the viewpoint. Keep both eyes visible and open for tracking.</p>
        </details>
        <details className="control-section help"><summary><span><Info size={17}/> How to get the depth effect</span><Plus size={15}/></summary><ol><li>Try the cube first. Put your device on a stable surface in good light.</li><li>Check Physical calibration, enable tracking, then look at the target to set your eye position.</li><li>Calibrate gaze with the screen targets. Then open Tune the depth effect, move as instructed, choose “This looks best,” then keep each setting.</li></ol><p>The webcam estimates head-anchored eye centers and iris direction. Eye rotation shifts the viewpoint subtly; Depth tuning can amplify that motion. The front of the box stays anchored to the screen. A normal display still shows one perspective to both eyes.</p><p>On iPhone or iPad, use Safari over HTTPS and allow the front camera. Full view works without native fullscreen. Tracking pauses when the app is backgrounded.</p><p>Keyboard: focus the canvas, use arrow keys to preview perspective, +/− to zoom, R to reset, and Escape to leave full view.</p><a className="text-button" href={assetUrl('/research.html')} target="_blank" rel="noreferrer">Research & implementation notes<ArrowUpRight size={14}/></a></details>
        </div>
      </aside>
    </div>
    <footer className="status-bar"><span><i className={ready ? 'dot-live' : ''}/>{ready ? 'Renderer ready' : 'Starting renderer'}<span className="status-separator">/</span>{fps > 0 ? `${fps} fps` : '—'}</span><span>{source === 'cube' ? 'Geometric depth test' : `${info.format} · ${info.textures} texture${info.textures === 1 ? '' : 's'}`}<span className="status-separator">/</span>Processed locally</span></footer>
    {(error || note) && <div className={`notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <Info size={19}/> : <Check size={19}/>}<p>{error || note}</p><button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNote(''); }}><X size={17}/></button></div>}
    <input ref={input} type="file" className="sr-only" accept=".ply,.usdz" aria-label="Open PLY or USDZ model" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ''; }}/>
    {gazeCalibrationTracker && <GazeCalibration tracker={gazeCalibrationTracker} status={status} onClose={() => { setGazeCalibrationTracker(null); requestAnimationFrame(() => gazeButton.current?.focus()); }} onApply={(profile, revision, result) => { if (!tracker.current?.applyGazeProfile(profile, revision)) return false; setGazeCalibrated(true); setGazeCalibrationTracker(null); setNote(`Gaze calibration applied. Average check error: ${result.meanPx.toFixed(0)} CSS px. Try moving gently, then tune the depth effect.`); requestAnimationFrame(() => gazeButton.current?.focus()); return true; }}/ >}
  </main>;
}
