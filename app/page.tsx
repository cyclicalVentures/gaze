'use client';
import { useEffect, useState } from 'react';
import { Box, Eye, FolderOpen } from 'lucide-react';
import { assetUrl } from '@/lib/base';
import { SpatialViewer } from '@/components/spatial-viewer';
import { GazeRecorder } from '@/components/gaze-recorder';

export default function Home() {
  const [tab, setTab] = useState<'viewer' | 'recorder'>('viewer');
  const [visitedRecorder, setVisitedRecorder] = useState(false);
  const [viewerLocked, setViewerLocked] = useState(false), [recorderLocked, setRecorderLocked] = useState(false);
  const [openRequest, setOpenRequest] = useState(0);
  const locked = viewerLocked || recorderLocked;
  useEffect(() => { let canceled = false; void Promise.resolve().then(() => { if (!canceled && window.location.hash === '#recorder') { setTab('recorder'); setVisitedRecorder(true); } }); return () => { canceled = true; }; }, []);
  const select = (value: 'viewer' | 'recorder') => {
    if (locked) return;
    setTab(value); if (value === 'recorder') setVisitedRecorder(true);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${value === 'recorder' ? '#recorder' : ''}`);
  };
  return <main className={`app-shell tabbed-shell ${viewerLocked ? 'is-tuning' : ''}`}>
    <header className="app-header">
      <a className="brand" href={assetUrl('/')} aria-label="Gaze home"><svg viewBox="0 0 40 32" aria-hidden="true"><path d="M2 16 13 5h14l11 11-11 11H13Z"/><circle cx="20" cy="16" r="5"/></svg><span>gaze<span className="brand-dot">.</span></span></a>
      <div className="app-tabs" role="tablist" tabIndex={-1} aria-label="Gaze tools" onKeyDown={event => { if (locked || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'viewer' : event.key === 'End' ? 'recorder' : tab === 'viewer' ? 'recorder' : 'viewer'; select(next); document.getElementById(`${next}-tab`)?.focus(); }}>
        <button role="tab" id="viewer-tab" aria-controls="viewer-panel" aria-selected={tab === 'viewer'} tabIndex={tab === 'viewer' ? 0 : -1} disabled={locked && tab !== 'viewer'} onClick={() => select('viewer')}><Box size={17}/>3D viewer</button>
        <button role="tab" id="recorder-tab" aria-controls="recorder-panel" aria-selected={tab === 'recorder'} tabIndex={tab === 'recorder' ? 0 : -1} disabled={locked && tab !== 'recorder'} onClick={() => select('recorder')}><Eye size={17}/>Gaze recorder</button>
      </div>
      {tab === 'viewer' && <button className="button primary header-open" disabled={locked} onClick={() => setOpenRequest(n => n + 1)}><FolderOpen size={17}/><span>Open model</span></button>}
    </header>
    <div id="viewer-panel" className="app-tab-panel" role="tabpanel" aria-labelledby="viewer-tab" hidden={tab !== 'viewer'}><SpatialViewer visible={tab === 'viewer'} openRequest={openRequest} onLock={setViewerLocked}/></div>
    <div id="recorder-panel" className="app-tab-panel" role="tabpanel" aria-labelledby="recorder-tab" hidden={tab !== 'recorder'}>{visitedRecorder && <GazeRecorder active={tab === 'recorder'} onBusy={setRecorderLocked}/>}</div>
  </main>;
}
