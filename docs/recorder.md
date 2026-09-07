# Gaze session recording

Implemented 7 September 2026. The second tab shares the established visual system and gaze reconstruction modules. The 3D viewer retains its model state when switching tabs; its camera/hand workers stop and its rendering is suspended while hidden. Only one tab can own camera tracking at a time. Tab changes are disabled while recording, saving or calibrating.

## Coordinates and calibration

The recorder subscribes to `HeadTracker.subscribeScreenGaze`. Predictions come from the three-distance personal gaze mapping, evaluated at **measured** head depth before the viewer's perceptual depth inversion or tuning. Missing face, invalid gaze and inference results older than 300 ms produce null points. Out-of-screen predictions remain off-screen; the recorder does not clamp them onto the edges.

A monitor session requests native fullscreen on the document before centering and calibration. The page must cover the screen, within two CSS pixels, and the neutral target lies at the full-screen center. The mapping remains anchored to those screen dimensions after leaving fullscreen; browser resize does not redefine the monitor origin. Display-size/zoom changes invalidate it. The page-only scope is calibrated to the current viewport and invalidates on resize.

The existing 27 learning targets and 15 held-out checks are reused. Screen and page recording profiles wrap the existing validated webcam-keyed localStorage format with distinct namespace prefixes. They cannot overwrite or incorrectly reuse the 3D viewer's coordinate-space calibration. Compatibility checks preserve the existing camera, resolution, display, DPR and calibration-dimension guards. A same-size different monitor or a moved webcam cannot be detected automatically; the user must keep the same physical setup.

## Timing and gaps

The face worker posts ticks every 50 ms while continuous recording is enabled. Main-thread bitmap capture accepts one frame at a time and timestamps it with the main thread's monotonic clock. Normal viewer tracking retains animation-frame scheduling. Worker pacing removes dependency on rendering visibility; it is not an exemption from OS/browser suspension.

`SessionCapture` stores timestamped normalized points relative to recording origin. Duplicate/out-of-order samples, invalid revisions, nonfinite values and samples beyond two hours are rejected. Playback holds an on-screen sample for at most 150 ms, until the next sample if sooner. Trails break across invalid samples and longer gaps. Heatmap weights are observed milliseconds, with clipped intervals at selected range boundaries. This prevents a slow or suspended camera from creating a false long fixation. Off-screen time is separate from missing time. The map uses a small Gaussian density grid; the region table sums unblurred dwell in nine equal screen areas. It is not a clinical fixation classifier or a hardware eye tracker.

## Optional game video

[Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia) gives the browser control over source selection and requires explicit user interaction. Capture is optional and silent (`audio:false`). This app accepts an entire monitor with matching aspect ratio; windows, tabs and unverifiable surfaces are rejected. It requests 15 fps and approximately 1280 px width, preserving the selected screen aspect. The user must select the calibrated monitor; aspect ratio cannot establish monitor identity.

MediaRecorder selects a supported WebM/MP4 codec and targets 1.5 Mbps. The recording-start event establishes the gaze origin. Playback uses the video's currentTime when footage is available, and a monotonic elapsed clock otherwise. This is approximate browser-level synchronization, not hardware timestamp alignment. Screen sharing ending, recorder errors or storage pressure stop the session. Chunks are persisted in order, including the final chunk, before the session is marked ended. There is a 512 MB video cap and a bounded pending-write limit.

## Local history and recovery

IndexedDB `gaze-recordings-v1` stores session metadata, gaze arrays and ordered screen-video chunks in separate stores. Five-second checkpoints atomically write metadata and gaze. Final metadata is written after video finalization; an abrupt exit leaves the previous checkpoint as a recoverable incomplete session. OS termination can happen without `pagehide`, so the newest unsaved interval can be lost.

Deleting a session removes its samples and all video chunks in one transaction. Session JSON and CSV preserve timing, normalized coordinates and loss markers. CSV also includes CSS-pixel coordinates in the calibrated frame. PNG exports the map overlay; video is a separate download. Downloads are initiated by user actions, and object URLs are revoked. No webcam frames, hand landmarks, audio, account or server storage are involved. When IndexedDB is unavailable, gaze-only capture remains in memory with persistent export reminders; screen video requires storage.

## Platform limits and verification

[Chrome's page lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) describes hidden, frozen and discarded pages. No ordinary web app can guarantee continuous camera work while minimized, occluded by a fullscreen game, suspended or placed in the background by iOS. Keep the recorder visible when possible and inspect its coverage after a short real-game trial. The app does not change browser flags, play fake audio or request unrelated permissions to evade lifecycle controls.

[MDN's browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/MediaDevices.json) marks `getDisplayMedia` unsupported in Safari iOS. The app uses page-only recording there and stops it on backgrounding. Gaze review, map/history and data exports remain available. Desktop capture is capability detected, and unsupported codecs fall back to gaze-only review with video download.

Automated checks cover timestamp and revision guards, density independence from sampling frequency, range clipping, gaps/off-screen accounting, CSV coordinates, persistence across database reopen, incomplete-session recovery, per-session deletion, ordered video finalization, storage failures, revoked screen sharing, screen-coordinate compatibility and worker-paced camera capture with backpressure. The IndexedDB tests use fake-indexeddb; MediaRecorder and camera lifecycle tests use controlled mocks. These do not verify MediaPipe accuracy, actual hidden-tab performance, codec output or timing on physical desktop/iOS devices. No browser interaction, screenshots or physical game session were performed for this change.
