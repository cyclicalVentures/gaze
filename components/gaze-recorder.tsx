'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Crosshair, Download, Eye, History, LoaderCircle, Monitor, Plus, Square, Trash2, X } from 'lucide-react';
import { GazeCalibration } from './gaze-calibration';
import { GazePlayback } from './gaze-playback';
import { HeadTracker, type ScreenGaze, type TrackingStatus } from '@/lib/viewer/tracker';
import { calibrationMismatch, cameraPreferenceKey, currentDisplay, forgetCalibration, loadCalibration, saveCalibration, type SavedCalibration } from '@/lib/viewer/calibration-storage';
import type { DistanceResult } from '@/lib/viewer/distance-calibration';
import { captureMismatch, fullScreenFits, recordingStorage, type RecordingScope } from '@/lib/recorder/calibration';
import { formatTime, MAX_SESSION_MS, SessionCapture, type GazeSession, type SessionMeta } from '@/lib/recorder/session';
import { SessionStore } from '@/lib/recorder/storage';
import { ScreenRecording } from '@/lib/recorder/screen-recording';

type Run = { capture: SessionCapture; meta: SessionMeta; video: ScreenRecording | null; lastSave: number; saving: Promise<void>; storageFailed: boolean };
export function GazeRecorder({ active, onBusy }: { active: boolean; onBusy: (busy: boolean) => void }) {
  const cameraVideo = useRef<HTMLVideoElement>(null), tracker = useRef<HeadTracker | null>(null), store = useRef<SessionStore | null>(null);
  const run = useRef<Run | null>(null), shared = useRef<MediaStream | null>(null), mounting = useRef(true), operation = useRef(0), finishing = useRef(false);
  const selectedScope = useRef<RecordingScope>('screen'), activeRef = useRef(active), busyRef = useRef(false);
  const stopRef = useRef<(message?: string) => Promise<void>>(async () => {});
  const [status, setStatus] = useState<TrackingStatus>('off'), [scope, setScope] = useState<RecordingScope>('screen');
  const [memoryOnly, setMemoryOnly] = useState(false);
  const centerDialog = useRef<HTMLDialogElement>(null), calibrationButton = useRef<HTMLButtonElement>(null);
  const [screenSupported, setScreenSupported] = useState(false), [storageReady, setStorageReady] = useState(false), [fullSupported, setFullSupported] = useState(false);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]), [cameraId, setCameraId] = useState('');
  const [distance, setDistance] = useState(55), [width, setWidth] = useState(34), [ipd, setIpd] = useState(63);
  const [mapAspect, setMapAspect] = useState('16 / 9'), [checkError, setCheckError] = useState(0);
  const [saved, setSaved] = useState<SavedCalibration | null>(null), [calibrated, setCalibrated] = useState(false), [calibrationMessage, setCalibrationMessage] = useState('');
  const [calibration, setCalibration] = useState<HeadTracker | null>(null), [centering, setCentering] = useState<number | null>(null);
  const [name, setName] = useState(''), [recording, setRecording] = useState(false), [preparing, setPreparing] = useState(false), [saving, setSaving] = useState(false);
  const [duration, setDuration] = useState(0), [count, setCount] = useState(0), [lastGaze, setLastGaze] = useState<ScreenGaze | null>(null);
  const [sharedLabel, setSharedLabel] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [sessions, setSessions] = useState<SessionMeta[]>([]), [review, setReview] = useState<GazeSession | null>(null), [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [loadingReview, setLoadingReview] = useState(false), [deleteId, setDeleteId] = useState('');
  const live = useRef<HTMLDivElement>(null), latest = useRef<ScreenGaze | null>(null);
  const busy = recording || preparing || saving;
  const refresh = useCallback(async () => { try { const items = await store.current?.list(); if (items && mounting.current) setSessions(items); } catch { if (mounting.current) setError('Session history could not be read. Reload to try again.'); } }, []);
  const unshare = useCallback(() => { shared.current?.getTracks().forEach(t => { t.onended = null; t.stop(); }); shared.current = null; if (mounting.current) setSharedLabel(''); }, []);
  const checkpoint = useCallback((current: Run, ended: boolean, at = performance.now()) => {
    const snapshot: GazeSession = { ...current.meta, duration: Math.min(MAX_SESSION_MS, Math.max(0, at - current.capture.origin)), sampleCount: current.capture.points.length, ended, points: [...current.capture.points] };
    if (store.current && !current.storageFailed) {
      const db = store.current;
      current.saving = current.saving.then(() => db.save(snapshot)).catch(() => {
        current.storageFailed = true;
        if (mounting.current) { setMemoryOnly(true); setError('Local saving failed. Keep this page open and export the session after stopping. Free browser storage before recording again.'); }
        if (!ended && current.video) void stopRef.current('Screen recording stopped because local storage is unavailable.');
      });
    }
    return snapshot;
  }, []);
  const stop = useCallback(async (reason = '') => {
    const current = run.current;
    if (!current || finishing.current) return;
    finishing.current = true; run.current = null; busyRef.current = true;
    tracker.current?.setContinuousCapture(false);
    const stoppedAt = performance.now();
    let session = checkpoint(current, false, stoppedAt);
    if (mounting.current) { setRecording(false); setSaving(true); if (reason) setMessage(reason); }
    try {
      await current.video?.stop(); await current.saving;
      session = checkpoint(current, true, stoppedAt); await current.saving;
      if (mounting.current) {
        setReview(session); setDuration(session.duration);
        if (current.video && store.current) {
          try { setVideoBlob(await store.current.video(session.id, session.videoType)); } catch { setError('The gaze session is available, but its screen video could not be opened. Try reopening it from history.'); }
        } else setVideoBlob(null);
        await refresh();
      }
    } finally { unshare(); finishing.current = false; busyRef.current = false; if (mounting.current) setSaving(false); }
  // oxlint-disable-next-line react/react-compiler -- unshare is used in finally; preserve all three stable callback dependencies.
  }, [checkpoint, refresh, unshare]);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => { activeRef.current = active; selectedScope.current = scope; busyRef.current = busy; onBusy(busy || !!calibration || centering !== null); }, [active, scope, busy, onBusy, calibration, centering]);
  useEffect(() => {
    mounting.current = true; let canceled = false;
    void Promise.resolve().then(() => {
    if (canceled) return;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const supported = !!document.documentElement.requestFullscreen && !ios;
    setFullSupported(supported); setScreenSupported(!!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined');
    if (!supported) { setScope('page'); selectedScope.current = 'page'; }
    if (window.innerWidth < 700) { setWidth(7); setDistance(40); }
    try { setCameraId(localStorage.getItem(cameraPreferenceKey) ?? ''); } catch { /* Optional preference. */ }
    });
    const t = new HeadTracker(cameraVideo.current!, s => {
      if (canceled) return;
      setStatus(s);
      if (s === 'off') { setCalibrated(false); latest.current = null; if (run.current) void stopRef.current('The camera stopped. Review and export the available session.'); }
    }, () => {}, text => setError(text));
    tracker.current = t;
    const unsubscribe = t.subscribeScreenGaze(sample => { latest.current = sample; run.current?.capture.push(sample); });
    const enumerate = async () => { try { const devices = await navigator.mediaDevices?.enumerateDevices(); if (!canceled && devices) setCameras(devices.filter(d => d.kind === 'videoinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))); } catch { /* Camera permission may be required. */ } };
    void enumerate(); navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    void SessionStore.open().then(db => { if (canceled) { db.close(); return; } store.current = db; setStorageReady(true); void refresh(); }).catch(() => { if (!canceled) { setMemoryOnly(true); setMessage('Local session storage is unavailable. Gaze-only recording and exports still work for this visit.'); } });
    const visibility = () => {
      if (!document.hidden) return;
      if (!busyRef.current) t.stop();
      // A page-only mapping is not a desktop mapping. Do not record it against other apps.
      if (run.current?.meta.scope === 'page') void stopRef.current('Page recording stopped when the app went into the background.');
    };
    const pagehide = () => { void stopRef.current('Recording interrupted by navigation.'); t.stop(); };
    const beforeunload = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); } };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide); window.addEventListener('beforeunload', beforeunload);
    const tick = window.setInterval(() => {
      const sample = latest.current, fresh = sample && performance.now() - sample.time < 250 ? sample : null;
      setLastGaze(fresh);
      if (live.current) {
        const p = fresh?.point;
        live.current.style.display = p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? 'block' : 'none';
        if (p) { live.current.style.left = `${p.x * 100}%`; live.current.style.top = `${p.y * 100}%`; }
      }
      const current = run.current;
      if (current) {
        const elapsed = performance.now() - current.capture.origin;
        setDuration(elapsed); setCount(current.capture.points.length);
        if (t.calibrationRevision !== current.capture.revision) { void stopRef.current('Calibration changed. The session has been stopped.'); return; }
        if (elapsed >= MAX_SESSION_MS) { void stopRef.current('The two-hour session limit was reached. Start a new session to continue.'); return; }
        if (elapsed - current.lastSave >= 5000) { current.lastSave = elapsed; checkpoint(current, false); }
      }
    }, 100);
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the latest async operation counter during cleanup.
      canceled = true; mounting.current = false; ++operation.current; unsubscribe(); t.stop(); tracker.current = null;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Stop the latest recording resources, not a DOM node.
      const db = store.current; void stopRef.current().finally(() => db?.close()); shared.current?.getTracks().forEach(track => track.stop());
      window.clearInterval(tick); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); window.removeEventListener('beforeunload', beforeunload); navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
    };
  }, [checkpoint, refresh]);
  useEffect(() => { let canceled = false; if (!active) { ++operation.current; tracker.current?.stop(); void Promise.resolve().then(() => { if (!canceled) unshare(); }); } return () => { canceled = true; }; }, [active, unshare]);
  useEffect(() => {
    const changed = () => {
      const c = tracker.current?.captureCalibration(); if (!c) return;
      const display = currentDisplay(), snapshot = saved?.display;
      const mismatch = scope === 'page' ? Math.abs(window.innerWidth - c.screen.width) > 2 || Math.abs(window.innerHeight - c.screen.height) > 2 : !fullScreenFits(c.screen.width, c.screen.height, display) || (snapshot && display.pixelRatio !== snapshot.pixelRatio);
      if (mismatch) { tracker.current?.clearGazeProfile(); setCalibrated(false); setCalibrationMessage('Display size or page zoom changed. Calibrate again.'); if (run.current) void stopRef.current('Display settings changed. The session has been stopped.'); }
    };
    window.addEventListener('resize', changed); window.addEventListener('orientationchange', changed);
    return () => { window.removeEventListener('resize', changed); window.removeEventListener('orientationchange', changed); };
  }, [scope, saved]);
  const restore = (entry: SavedCalibration) => {
    const t = tracker.current, camera = t?.camera; if (!camera || !t) return false;
    const display = currentDisplay(), viewport = scope === 'screen' ? display : { width: window.innerWidth, height: window.innerHeight };
    const mismatch = calibrationMismatch(entry, camera, display, viewport);
    if (mismatch) { setCalibrationMessage(mismatch); return false; }
    if (!t.restoreCalibration(entry.calibration)) { setCalibrationMessage('Recalibrate this webcam to restore your face reference.'); return false; }
    setMapAspect(`${entry.calibration.screen.width} / ${entry.calibration.screen.height}`); setCheckError(entry.checks.reduce((sum, c) => sum + c.meanPx, 0) / entry.checks.length);
    setCalibrated(true); setWidth(entry.calibration.screen.metersPerPixel * entry.calibration.screen.width * 100); setDistance(entry.calibration.distance * 100); setIpd(entry.calibration.ipd * 1000);
    setCalibrationMessage('Saved recording calibration restored for this webcam.'); return true;
  };
  const startCamera = async (id = cameraId) => {
    const token = ++operation.current; setError(''); setSaved(null); setCalibrationMessage('');
    await tracker.current?.start(id || undefined);
    if (token !== operation.current || !mounting.current || !activeRef.current) return;
    const camera = tracker.current?.camera; if (!camera) return;
    setCameraId(camera.deviceId);
    try {
      localStorage.setItem(cameraPreferenceKey, camera.deviceId);
      const entry = loadCalibration(recordingStorage(localStorage, scope), camera.deviceId);
      if (entry.kind === 'found') { setSaved(entry.value); restore(entry.value); }
      else if (entry.kind === 'invalid') setCalibrationMessage('The saved recording calibration could not be read. Calibrate again.');
    } catch { setCalibrationMessage('Calibration can be used this visit, but saving is unavailable.'); }
    try { const devices = await navigator.mediaDevices.enumerateDevices(); if (token === operation.current) setCameras(devices.filter(d => d.kind === 'videoinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))); } catch { /* Active camera works independently. */ }
  };
  const beginCalibration = async () => {
    setError(''); setReview(null); unshare();
    if (scope === 'screen') {
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); }
      catch { setError('Full-screen access was declined. Allow it to calibrate the game monitor, or choose This page.'); return; }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!fullScreenFits(window.innerWidth, window.innerHeight, currentDisplay())) { setError('The page does not cover this entire screen. Reset browser zoom and try full-screen calibration again.'); return; }
    }
    setCentering(3);
  };
  useEffect(() => {
    const element = centerDialog.current;
    if (centering !== null) { if (!element?.open) element?.showModal(); }
    else { if (element?.open) { element.close(); calibrationButton.current?.focus(); } }
  }, [centering]);
  useEffect(() => {
    if (centering === null) return;
    const timeout = window.setTimeout(() => {
      if (centering > 1) { setCentering(centering - 1); return; }
      setCentering(null); const t = tracker.current;
      if (!t) return;
      t.distance = distance / 100; t.ipd = ipd / 1000;
      if (!t.calibrate()) { setError('Keep your head still and both eyes visible, then try calibration again.'); return; }
      t.setScreenGeometry({ width: window.innerWidth, height: window.innerHeight, metersPerPixel: width / 100 / window.innerWidth, center: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
      setCalibrated(false); setCalibration(t);
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [centering, distance, width, ipd]);
  const apply = (result: DistanceResult, revision: number) => {
    const t = tracker.current; if (!result.usable || !t?.applyGazeProfile(result.profile, revision)) return false;
    const snapshot = t.captureCalibration(), camera = t.camera; let entry: SavedCalibration | null = null;
    if (snapshot && camera) { try { entry = saveCalibration(recordingStorage(localStorage, scope), camera, currentDisplay(), snapshot, result); } catch { /* Mapping still works in memory. */ } }
    if (snapshot) setMapAspect(`${snapshot.screen.width} / ${snapshot.screen.height}`); setCheckError(result.meanPx);
    setSaved(entry); setCalibrated(true); setCalibration(null); setCalibrationMessage(`${entry ? 'Saved for this webcam.' : 'Applied for this visit.'} Average check error: ${Math.round(result.meanPx)} CSS px.`);
    return true;
  };
  const shareScreen = async () => {
    setError(''); setPreparing(true); busyRef.current = true; const token = ++operation.current;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 15, max: 15 }, width: { ideal: 1280 } }, audio: false });
      if (token !== operation.current || !mounting.current || !activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getVideoTracks()[0], c = tracker.current?.captureCalibration();
      const mismatch = !c ? 'Calibrate before sharing the game monitor.' : captureMismatch(track.getSettings(), c.screen.width, c.screen.height);
      if (mismatch) { stream.getTracks().forEach(t => t.stop()); throw new Error(mismatch); }
      shared.current = stream; setSharedLabel(track.label || 'Entire screen');
      track.onended = () => { shared.current = null; setSharedLabel(''); };
    } catch (e) { if (mounting.current) setError((e as Error).name === 'NotAllowedError' ? 'Screen sharing was canceled. You can still record gaze without video.' : (e as Error).message || 'Screen sharing is unavailable. Record gaze only.'); }
    finally { busyRef.current = false; if (mounting.current) setPreparing(false); }
  };
  const startRecording = async () => {
    const t = tracker.current, c = t?.captureCalibration(); if (!c || !t || busyRef.current || centering !== null || calibration) return;
    setError(''); setMessage(''); setReview(null); setVideoBlob(null); setPreparing(true); busyRef.current = true;
    const id = crypto.randomUUID(), meta: SessionMeta = { version: 1, id, name: name.trim().slice(0, 120) || 'Untitled game session', startedAt: Date.now(), duration: 0, width: c.screen.width, height: c.screen.height, scope, camera: t.camera?.label ?? 'Webcam', calibrationError: checkError, ended: false, sampleCount: 0, videoType: '' };
    let screenVideo: ScreenRecording | null = null;
    try {
      if (shared.current && store.current) screenVideo = new ScreenRecording(shared.current, store.current, id, reason => { void stopRef.current(reason); });
      const origin = screenVideo ? await screenVideo.start() : performance.now();
      meta.videoType = screenVideo?.type ?? ''; meta.startedAt = Date.now();
      const current: Run = { capture: new SessionCapture(origin, t.calibrationRevision), meta, video: screenVideo, lastSave: 0, saving: Promise.resolve(), storageFailed: memoryOnly };
      run.current = current; t.setContinuousCapture(true); checkpoint(current, false);
      setDuration(0); setCount(0); setRecording(true); setMessage('Recording. Keep Gaze open and the webcam fixed. Return here to stop.');
    } catch (e) { await screenVideo?.stop(); unshare(); setError((e as Error).message || 'Recording could not start. Try gaze-only recording.'); busyRef.current = false; }
    finally { setPreparing(false); }
  };
  const openSession = async (meta: SessionMeta) => {
    if (!store.current) return;
    const token = ++operation.current; setLoadingReview(true); setError('');
    try {
      const session = await store.current.load(meta.id), blob = meta.videoType ? await store.current.video(meta.id, meta.videoType) : null;
      if (token !== operation.current) return;
      if (!session) throw new Error('This session is no longer available.');
      setReview(session); setVideoBlob(blob);
    } catch (e) { setError((e as Error).message || 'The session could not be opened. Try again.'); }
    finally { if (token === operation.current) setLoadingReview(false); }
  };
  const removeSession = async (id: string) => {
    try { await store.current?.remove(id); if (review?.id === id) { setReview(null); setVideoBlob(null); } setDeleteId(''); await refresh(); }
    catch { setError('The session could not be deleted. Try again.'); }
  };
  const switchScope = (value: RecordingScope) => { unshare(); tracker.current?.stop(); setScope(value); setSaved(null); setCalibrated(false); setCalibrationMessage(''); };
  const gazePoint = lastGaze?.point, gazeValid = !!gazePoint && gazePoint.x >= 0 && gazePoint.x <= 1 && gazePoint.y >= 0 && gazePoint.y <= 1;
  const canCalibrate = status === 'ready' || status === 'tracking' || status === 'lost';
  return <div className="recorder-workspace">
    <section className="recorder-main" aria-label="Recording and playback">
      {loadingReview ? <div className="recorder-empty"><LoaderCircle className="spin"/><p>Opening your session…</p></div> : review && !busy ? <><button className="text-button back-to-record" onClick={() => { setReview(null); setVideoBlob(null); }}><Plus size={16}/>New recording</button><GazePlayback key={review.id} session={review} videoBlob={videoBlob} active={active}/></> : <>
        <div className="recording-heading"><div><h1>Gaze recorder</h1><p>Record where you look. Replay the moments that matter.</p></div><span className={`recording-indicator ${recording ? 'is-recording' : ''}`}><i/>{saving ? 'Saving session' : recording ? 'Recording' : 'Ready when you are'}</span></div>
        <div className="live-screen-map" style={{ aspectRatio: mapAspect }}>
          <div className="screen-guides" aria-hidden="true"><i/><i/></div><div ref={live} className="live-gaze-dot" aria-hidden="true"/>
          <div className="live-map-center">{saving || preparing ? <><LoaderCircle size={28} className="spin"/><span>{saving ? 'Saving gaze and screen video…' : 'Preparing recording…'}</span></> : recording ? <><strong>{formatTime(duration)}</strong><span>{count.toLocaleString()} gaze samples · {gazeValid ? 'Gaze on screen' : 'Waiting for on-screen gaze'}</span></> : <><Eye size={32}/><strong>{calibrated ? 'Your screen, mapped.' : 'Start with your webcam.'}</strong><span>{calibrated ? 'Look around to check the live dot, then record.' : 'Enable the camera and calibrate before recording.'}</span></>}</div>
          <span className="map-label">{scope === 'screen' ? 'Entire monitor' : 'This page'} · {sharedLabel ? 'Screen video attached' : 'Gaze only'}</span>
        </div>
        <div className="recording-actions"><label className="session-name">Session name<input value={name} maxLength={120} disabled={busy} placeholder="e.g. Ranked match · evening" onChange={e => setName(e.target.value)}/></label>{recording ? <button className="button primary" onClick={() => void stop()}><Square size={17}/>Stop & review</button> : <button className="button primary" disabled={!calibrated || !gazeValid || busy || loadingReview || centering !== null || !!calibration} onClick={() => void startRecording()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Eye size={17}/>} {saving ? 'Saving…' : 'Start recording'}</button>}</div>
        <p className="recording-help">For games, calibrate and play on the same monitor. Keep Gaze in a visible window when possible; hidden or minimized browsers may pause tracking. Gaps remain visible in playback. iOS supports recording this page while it stays in front.</p>
        <p className="recording-help">{memoryOnly ? 'This session is held in memory. Export it after stopping, before leaving this page.' : 'Sessions autosave on this device every five seconds.'} Gaze-only sessions save coordinates. Screen video records everything visible on the selected monitor, including any camera preview, without audio. Limit: two hours or 512 MB of screen video per session.</p>
      </>}
      {memoryOnly && review && <p className="recorder-notice">This session may not be saved. Export its JSON and CSV before leaving this page.</p>}
      {(error || message) && <div className={`recorder-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}><p>{error || message}</p><button className="icon-button" aria-label="Dismiss recording message" onClick={() => { setError(''); setMessage(''); }}><X size={16}/></button></div>}
    </section>
    <aside className="recorder-sidebar" aria-label="Gaze recorder setup and history">
      <section className="recorder-setup"><h2><Camera size={17}/>Recording setup</h2>
        <div className={`camera-preview recorder-camera ${status !== 'off' ? 'camera-on' : ''}`}><video ref={cameraVideo} muted autoPlay playsInline aria-label="Recorder webcam preview"/>{status === 'off' && <div className="camera-off"><CameraOff size={24}/><span>Camera off</span></div>}<span className="camera-label">{({ off: 'Camera off', starting: 'Starting…', ready: 'Ready to calibrate', tracking: 'Eyes visible', lost: 'Eyes not visible' })[status]}</span></div>
        <label className="recorder-field">Webcam<select value={cameraId} disabled={busy || centering !== null || !!calibration || status === 'starting'} onChange={e => { const id = e.target.value; unshare(); setCameraId(id); setSaved(null); setCalibrated(false); if (status !== 'off') void startCamera(id); }}><option value="">Default front camera</option>{cameraId && !cameras.some(c => c.id === cameraId) && <option value={cameraId}>Previously selected webcam</option>}{cameras.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label className="recorder-field">Tracking area<select value={scope} disabled={busy || centering !== null || !!calibration} onChange={e => switchScope(e.target.value as RecordingScope)}><option value="screen" disabled={!fullSupported}>Entire monitor · for games</option><option value="page">This page · desktop or iOS</option></select></label>
        <button className="button secondary full-width" disabled={busy || centering !== null || !!calibration} onClick={() => { if (status === 'off') void startCamera(); else { ++operation.current; tracker.current?.stop(); unshare(); } }}>{status === 'off' ? <><Camera size={16}/>Enable camera</> : <><CameraOff size={16}/>{status === 'starting' ? 'Cancel camera setup' : 'Stop camera'}</>}</button>
        <details className="recorder-measurements"><summary>Physical measurements</summary><p>{scope === 'screen' ? 'Measure the entire monitor’s visible width.' : 'Measure the visible browser page width.'} Use your normal playing distance.</p>{([{ label: 'Screen width (cm)', value: width, set: setWidth, min: 5, max: 200 }, { label: 'Eye distance (cm)', value: distance, set: setDistance, min: 20, max: 130 }, { label: 'Pupil distance (mm)', value: ipd, set: setIpd, min: 40, max: 85 }]).map(field => <label key={field.label}>{field.label}<input type="number" value={field.value} min={field.min} max={field.max} disabled={busy || !!calibration || centering !== null} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) { field.set(Math.min(field.max, Math.max(field.min, n))); tracker.current?.clearGazeProfile(); setCalibrated(false); } }}/></label>)}</details>
        <button ref={calibrationButton} className="button teal-action full-width" disabled={busy || !canCalibrate || centering !== null} onClick={() => void beginCalibration()}><Crosshair size={16}/>{centering !== null ? 'Look at the center…' : calibrated ? 'Recalibrate gaze' : scope === 'screen' ? 'Calibrate full screen' : 'Calibrate this page'}</button>
        <p className="calibration-hint">Three distances, nine targets and five checks at each. Recording profiles are saved separately from the 3D viewer.</p>
        {calibrationMessage && <p className="calibration-hint" aria-live="polite">{calibrationMessage}</p>}
        {saved && <div className="saved-gaze-actions">{!calibrated && <button className="text-button" disabled={busy || !canCalibrate} onClick={() => restore(saved)}>Use saved profile</button>}<button className="text-button" disabled={busy} onClick={() => { try { if (!forgetCalibration(recordingStorage(localStorage, scope), saved.camera.deviceId)) throw new Error(); setSaved(null); tracker.current?.clearGazeProfile(); setCalibrated(false); setCalibrationMessage('Recording calibration forgotten for this webcam.'); } catch { setError('The saved calibration could not be removed. Try again.'); } }}>Forget profile</button></div>}
        <div className="screen-capture-setup"><h3><Monitor size={16}/>Game footage <span>Optional</span></h3>{sharedLabel ? <><p>{sharedLabel}. Confirm this is your calibrated game monitor.</p><button className="text-button" disabled={busy} onClick={unshare}>Remove screen video</button></> : <><p>{screenSupported ? 'Choose Entire screen and select the monitor you calibrated. Screen sharing begins now; recording starts with Start recording.' : 'Screen capture is unavailable in this browser. Gaze-only playback and heatmaps are available.'}</p><button className="button secondary full-width" disabled={!screenSupported || !storageReady || memoryOnly || !calibrated || scope !== 'screen' || busy} onClick={() => void shareScreen()}><Monitor size={16}/>Attach game screen</button></>}</div>
      </section>
      <section className="session-history"><h2><History size={17}/>Session history <span>{sessions.length}</span></h2>{sessions.length === 0 ? <p>{memoryOnly ? 'Local saving is unavailable. Export each session from its review before leaving.' : 'Your recordings will appear here, saved in this browser. Export sessions you want to keep.'}</p> : <ul>{sessions.map(s => <li key={s.id} className={s.id === review?.id ? 'is-selected' : ''}><button className="session-open" disabled={busy || loadingReview} onClick={() => void openSession(s)}><strong>{s.name}</strong><span>{new Date(s.startedAt).toLocaleDateString()} · {formatTime(s.duration)}{!s.ended ? ' · Recovered' : ''}</span></button>{deleteId === s.id ? <div className="session-delete"><span>Delete gaze and video?</span><button className="text-button" disabled={busy} onClick={() => void removeSession(s.id)}>Delete</button><button className="text-button" onClick={() => setDeleteId('')}>Keep</button></div> : <button className="icon-button" aria-label={`Delete ${s.name}`} disabled={busy || loadingReview} onClick={() => setDeleteId(s.id)}><Trash2 size={15}/></button>}</li>)}</ul>}<p className="local-session-note"><Download size={13}/>Review any session to export its data and map.</p></section>
    </aside>
    <dialog ref={centerDialog} className="recorder-centering" aria-label="Set your eye position" onCancel={event => { event.preventDefault(); setCentering(null); }}><div aria-live="polite"><Crosshair size={40}/><strong>{centering}</strong><span>Look here. Hold your head still.</span><button className="button secondary" onClick={() => setCentering(null)}>Cancel</button></div></dialog>
    {calibration && <GazeCalibration tracker={calibration} status={status} onClose={() => setCalibration(null)} onApply={apply}/>}
  </div>;
}
