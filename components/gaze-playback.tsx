'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import { analyze, formatTime, intervals, lowerBound, MAX_HOLD_MS, onScreen, pointAt, sessionCsv, type GazeSession } from '@/lib/recorder/session';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function GazePlayback({ session, videoBlob, active }: { session: GazeSession; videoBlob: Blob | null; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [start, setStart] = useState(0), [end, setEnd] = useState(session.duration);
  const [heat, setHeat] = useState(true), [trail, setTrail] = useState(true), [videoError, setVideoError] = useState('');
  const [url, setUrl] = useState('');
  const heatLayer = useRef<HTMLCanvasElement | null>(null), pendingSeek = useRef(0);
  useEffect(() => { if (!active) { video.current?.pause(); void Promise.resolve().then(() => setPlaying(false)); } }, [active]);
  const stats = useMemo(() => analyze(session.points, start, end), [session.points, start, end]);
  const timeline = useMemo(() => {
    const bins = new Float32Array(160), size = session.duration / bins.length;
    if (size > 0) intervals(session.points, 0, session.duration, (p, ms, from) => {
      if (!onScreen(p)) return;
      const to = from + ms;
      for (let i = Math.floor(from / size); i < bins.length && i * size < to; i++) bins[i] += Math.max(0, Math.min(to, (i + 1) * size) - Math.max(from, i * size)) / size;
    });
    return bins;
  }, [session]);
  useEffect(() => {
    let canceled = false; const next = videoBlob ? URL.createObjectURL(videoBlob) : '';
    void Promise.resolve().then(() => { if (!canceled) setUrl(next); });
    return () => { canceled = true; if (next) URL.revokeObjectURL(next); };
  }, [videoBlob]);
  useEffect(() => {
    const element = video.current;
    if (!element || !url || videoError) return;
    element.playbackRate = speed;
    if (playing && active) void element.play().catch(() => { setPlaying(false); setVideoError('Video playback failed. Gaze-only playback and downloads are available.'); });
    else element.pause();
  }, [playing, speed, url, videoError, active]);
  useEffect(() => {
    if (!playing || !active) return;
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - last) * speed; last = now;
      setTime(previous => {
        const next = url && !videoError && video.current ? video.current.currentTime * 1000 : previous + elapsed;
        if (next >= end) { setPlaying(false); return end; }
        return Math.max(start, next);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, speed, start, end, url, videoError, active]);
  useEffect(() => {
    heatLayer.current = null;
    if (stats.peak) {
      const layer = document.createElement('canvas'); layer.width = stats.cols; layer.height = stats.rows;
      const c = layer.getContext('2d')!, pixels = c.createImageData(stats.cols, stats.rows);
      for (let i = 0; i < stats.grid.length; i++) {
        const v = Math.sqrt(stats.grid[i] / stats.peak), k = i * 4;
        pixels.data[k] = Math.round(47 + v * 208); pixels.data[k + 1] = Math.round(214 - v * 122); pixels.data[k + 2] = Math.round(196 - v * 110); pixels.data[k + 3] = Math.round(Math.min(.8, v) * 230);
      }
      c.putImageData(pixels, 0, 0); heatLayer.current = layer;
    }
  }, [stats]);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const w = 1280, h = Math.round(w * session.height / session.width);
    if (element.width !== w) element.width = w; if (element.height !== h) element.height = h;
    ctx.clearRect(0, 0, w, h);
    if (heat && heatLayer.current) ctx.drawImage(heatLayer.current, 0, 0, w, h);
    if (trail) {
      ctx.strokeStyle = '#2fd6c4'; ctx.lineWidth = 2; ctx.beginPath();
      let last = -Infinity;
      for (let i = lowerBound(session.points, Math.max(start, time - 1200)); i < session.points.length && session.points[i].t <= time; i++) {
        const p = session.points[i];
        if (!onScreen(p)) { last = -Infinity; continue; }
        if (p.t - last > MAX_HOLD_MS) ctx.moveTo(p.x! * w, p.y! * h); else ctx.lineTo(p.x! * w, p.y! * h);
        last = p.t;
      }
      ctx.stroke();
    }
    const p = pointAt(session.points, time);
    if (p) {
      ctx.beginPath(); ctx.arc(p.x! * w, p.y! * h, 12, 0, Math.PI * 2); ctx.fillStyle = '#0d0a1f'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x! * w, p.y! * h, 3, 0, Math.PI * 2); ctx.fillStyle = '#2fd6c4'; ctx.fill();
    }
  }, [time, heat, trail, stats, session, start]);
  const seek = (next: number) => { setTime(next); pendingSeek.current = next; if (video.current && video.current.readyState >= 1 && url && !videoError) video.current.currentTime = next / 1000; };
  const toggle = () => { if (time >= end || time < start) seek(start); setPlaying(!playing); };
  const exportName = `gaze-${new Date(session.startedAt).toISOString().replace(/[:.]/g, '-')}`;
  const trackedPercent = end > start ? stats.tracked / (end - start) * 100 : 0;
  return <section className="gaze-review" aria-label="Gaze session playback">
    <div className="review-heading"><div><h1>{session.name}</h1><p>{new Date(session.startedAt).toLocaleString()} · {session.scope === 'screen' ? 'Full screen' : 'Browser page'} · {session.width} × {session.height}</p></div><span className="review-duration">{formatTime(session.duration)}</span></div>
    {!session.ended && <p className="recorder-notice">Recovered from the last autosave. The page closed before recording finished.</p>}
    <div className="gaze-map" style={{ aspectRatio: `${session.width} / ${session.height}` }}>
      {url && !videoError && <video ref={video} src={url} muted playsInline preload="auto" onLoadedMetadata={() => { if (video.current) video.current.currentTime = pendingSeek.current / 1000; }} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setVideoError('This browser could not play the screen video. Download it or use gaze-only playback.'); }} />}
      <div className="screen-guides" aria-hidden="true"><i/><i/></div>
      <canvas ref={canvas} aria-label="Gaze heatmap and playback cursor. The region table below gives time spent in each area."/>
      <span className="map-label">{url && !videoError ? 'Screen recording' : 'Screen coordinates'} · {pointAt(session.points, time) ? 'Gaze observed' : 'No on-screen gaze at this time'}</span>
    </div>
    {videoError && <p className="recorder-notice" aria-live="polite">{videoError}</p>}
    <div className="playback-controls"><button className="button teal-action" disabled={end <= start} onClick={toggle}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? 'Pause' : 'Play'}</button><button className="icon-button" aria-label="Restart selected range" onClick={() => { setPlaying(false); seek(start); }}><RotateCcw size={17}/></button><output>{formatTime(time)} / {formatTime(session.duration)}</output><label>Speed<select value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 4].map(n => <option key={n} value={n}>{n}×</option>)}</select></label></div>
    <div className="gaze-timeline"><svg viewBox="0 0 160 12" preserveAspectRatio="none" aria-hidden="true">{Array.from(timeline, (v, i) => <rect key={i} x={i} y={12 - v * 12} width=".8" height={Math.max(.5, v * 12)} fill={v > .01 ? '#2fd6c4' : '#594a72'}/>)}</svg><input type="range" aria-label="Playback position" aria-valuetext={formatTime(time)} min={0} max={session.duration} step={10} value={time} onChange={e => seek(Math.min(end, Math.max(start, Number(e.target.value))))}/></div>
    <p className="timeline-caption">Teal shows recorded on-screen gaze. Empty intervals include blinks, off-screen looks and browser pauses.</p>
    <div className="review-options"><label><input type="checkbox" checked={heat} onChange={e => setHeat(e.target.checked)}/>Hotspot map</label><label><input type="checkbox" checked={trail} onChange={e => setTrail(e.target.checked)}/>Gaze trail</label><span className="heat-legend"><i/>Less time <b/>More time</span></div>
    <div className="review-analysis"><div><h2>Review a time range</h2><label className="range-control">From <output>{formatTime(start)}</output><input type="range" aria-label="Range start" aria-valuetext={formatTime(start)} min={0} max={session.duration} step={100} value={start} onChange={e => { const next = Math.min(Number(e.target.value), end); setStart(next); setPlaying(false); seek(next); }}/></label><label className="range-control">To <output>{formatTime(end)}</output><input type="range" aria-label="Range end" aria-valuetext={formatTime(end)} min={0} max={session.duration} step={100} value={end} onChange={e => { const next = Math.max(start, Number(e.target.value)); setEnd(next); setPlaying(false); seek(Math.min(time, next)); }}/></label><p>{trackedPercent.toFixed(0)}% on-screen coverage · {formatTime(stats.offscreen)} off-screen · {formatTime(stats.missing)} unobserved</p><p>Calibration check: {Math.round(session.calibrationError)} CSS px average error. Hotspots show dwell time, with no gaze filled in across gaps.</p></div><table className="hotspot-table"><caption>Most viewed areas · selected range</caption><thead><tr><th scope="col">Area</th><th scope="col">Time</th><th scope="col">Share</th></tr></thead><tbody>{stats.zones.filter(z => z.ms > 0).slice(0, 5).map(z => <tr key={z.name}><th scope="row">{z.name}</th><td>{(z.ms / 1000).toFixed(1)} s</td><td>{(z.ms / stats.tracked * 100).toFixed(0)}%</td></tr>)}{stats.tracked === 0 && <tr><td colSpan={3}>No on-screen gaze in this range.</td></tr>}</tbody></table></div>
    <div className="recording-exports"><button className="button secondary" onClick={() => downloadBlob(new Blob([JSON.stringify(session)], { type: 'application/json' }), `${exportName}.json`)}><Download size={16}/>Session JSON</button><button className="button secondary" onClick={() => downloadBlob(new Blob([sessionCsv(session)], { type: 'text/csv' }), `${exportName}.csv`)}>Gaze CSV</button><button className="button secondary" onClick={() => { setPlaying(false); canvas.current?.toBlob(blob => { if (blob) downloadBlob(blob, `${exportName}-map.png`); }); }}>Map PNG</button>{videoBlob && <button className="button secondary" onClick={() => downloadBlob(videoBlob, `${exportName}.${session.videoType.includes('mp4') ? 'mp4' : 'webm'}`)}>Screen video</button>}</div>
  </section>;
}
