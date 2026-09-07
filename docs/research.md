# Head-coupled window rendering
Reviewed 6 September 2026. The requested effect is head-coupled perspective (often called fish-tank VR): a physical screen is a fixed window into a rendered scene.

## Sources and decisions

See the [newer implementation shortlist](sota-tracking.md) for WebEyeTrack, OpenSeeFace, MobileGaze, EyeTrax, RealEye Light Open, and the March 2026 EMC-Gaze preprint, with inspected source paths and a recommended evaluation order.

- [JEOresearch/EyeTracker — Webcam3DTracker](https://github.com/JEOresearch/EyeTracker/tree/main/Webcam3DTracker). Inspected `MonitorTracking.py`: a nose-derived 3D head frame, scale-aware eye sphere offsets frozen at center calibration, per-eye iris-minus-sphere gaze vectors, and a combined gaze ray. This is the primary reference for the revised webcam model. Its README calls it a prototype. We adapted the head-local sphere method in TypeScript, with anatomical axes instead of PCA, explicit metric priors, confidence gating and off-axis rendering. [Attribution and MIT license](../THIRD_PARTY_NOTICES.md).
- [JEOresearch/EyeTracker — 3DTracker](https://github.com/JEOresearch/EyeTracker/tree/main/3DTracker). Inspected the pupil ellipse, normal-line intersection and ray/sphere gaze reconstruction. This version targets close-up infrared eye cameras; its image segmentation is not used on our full-face RGB feed.

- [Real-time 3D Light-field Viewing with Eye-tracking on Conventional Displays, Pham et al., 22 August 2025](https://arxiv.org/abs/2508.16535). Uses an RGB webcam, MediaPipe eye landmarks and anaglyph view selection. Supports the feasibility of commodity-camera eye-position driven views; its light-field renderer and reported performance are not our mesh renderer or benchmarks.
- [MindDock/off-axis-demo](https://github.com/MindDock/off-axis-demo). Inspected its current `index.html`: iris centers 468/473 drive camera position and asymmetric `makePerspective` bounds. It uses approximate fixed gains. This project instead captures a neutral pose and derives pixel-to-meter scale from viewing distance and interpupillary distance. Our implementation is original, not copied source.
- [icurtis1/off-axis-sneaker](https://github.com/icurtis1/off-axis-sneaker). Reference for a webcam viewer and physical calibration UX. Its README explicitly distinguishes its parallax implementation from a future geometrically correct off-axis upgrade. We do not assume every head-tracked demo implements a fixed screen plane.
- [DisplayXR/displayxr-common](https://github.com/DisplayXR/displayxr-common). Current native generalized off-axis/Kooima projection math reference. Its multiview hardware integration is outside the scope of an ordinary web display.
- [RuView ADR-324, 16 August 2026](https://github.com/ruvnet/RuView/blob/main/docs/adr/ADR-324-off-axis-head-coupled-perspective-demo.md). Recent implementation note proposing webcam-based fine tracking plus off-axis projection and One Euro filtering. Its RF positioning claims are not needed or adopted here.
- [Casiez, Roussel & Vogel, One Euro Filter, CHI 2012](https://gery.casiez.net/1euro/). Established adaptive filtering method used to suppress small jitter while reducing lag during faster movement.
- [Google MediaPipe Face Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js). Official implementation API. Camera inference runs in a worker, separate from rendering. WASM and model files are self-hosted.
- [Three.js USDLoader](https://threejs.org/docs/pages/USDLoader.html). Current loader handles ASCII and binary USD inside USDZ. The supplied Scaniverse file contains binary USDC and an 8192 × 8192 JPEG.

## Geometry

All scene units are meters. The screen is the XY plane at Z=0. The viewer is at `(ex,ey,ez)`, `ez>0`, looking along negative Z. The model and box are behind the screen.

With physical viewport width W and height H, near plane n:

```
l = (-W/2 - ex) * n/ez
r = ( W/2 - ex) * n/ez
b = (-H/2 - ey) * n/ez
t = ( H/2 - ey) * n/ez
```

Set an asymmetric perspective projection from these bounds, translate the camera to the eye position, and keep its orientation fixed. Do not call `lookAt` in Window mode. Tests project the four physical screen corners to the same NDC coordinates over multiple X/Y/Z eye positions and verify front/back parallax signs.

For an object of width `S` at depth `D` behind the screen, its width on the physical screen is `S * ez / (ez + D)`. Leaning closer reduces its pixel width, even though its visual angle from the closer eye grows. This can feel like reverse zoom when judging only the pixels. The tracker estimates decreasing distance as observed face scale increases; synthetic forward-motion tests verify that sign, but do not verify a particular physical camera's behavior.

The **Grow when closer** control negates the mapped head-depth displacement about the centered distance, leaving measured distance and lateral movement unchanged. This produces on-screen growth when approaching and is explicitly a perceptual preference, not physical head-coupled Z geometry. Both directions keep the screen plane fixed. The UI now displays **Estimated screen distance** separately from **View Z**, so camera-estimation errors can be distinguished from projection or tuning choices. Approach-growth is enabled by default, including for older saved settings without a direction preference. Turning it off restores the original physical direction; explicit preferences survive reload.

## Eye position and orientation

Centering shows a three-second fixation target at the viewport center. The last approximately half-second of observations is averaged; substantial movement rejects calibration. The frame uses 24 nose-region landmarks for its origin and average pairwise scale, with deterministic anatomical horizontal/vertical axes. Eye spheres are placed one estimated 12 mm radius behind each iris and frozen in head-local coordinates. Each frame reconstructs those centers with the current head rotation, origin and scale. Unlike the previous iris-midpoint tracker, pupil movement does not directly translate the head or alter its distance.

With neutral distance `d0`, neutral pupil separation `s0`, and physical interpupillary distance `ipd`, effective focal length is `f=s0*d0/ipd`. Current eye depth is `d0 * neutralNoseScale/currentNoseScale`. Current and neutral eye centers are reconstructed relative to the approximate image optical center before subtraction, compensating for a camera above or beside the screen during forward motion. MediaPipe relative landmark depth helps estimate orientation and scale; it is not metric depth from a sensor.

Each gaze ray is the normalized vector from its reconstructed sphere center to its observed 3D iris. Rays are rejected for implausible radius, direction or binocular disagreement. Head position remains usable when gaze is uncertain. A blink or hidden eye holds the last pose; prolonged loss pauses tracking. A 6 mm optical-viewpoint offset along the gaze direction models the small viewpoint change from eye rotation; the neutral offset is subtracted. Radius and optical offset are approximate anatomical priors, not measurements of the user's eyes. Camera images are unmirrored for inference; X/Y signs convert them into screen coordinates. The preview is mirrored.

The screen-plane projection remains fixed in orientation. Eye motion adjusts the viewpoint rather than orbiting the model. A gaze contribution of 1× uses the small optical offset; settings above 1× deliberately amplify it for perception and depart from physical eye geometry. This remains an experimental monocular webcam estimate. Lens calibration, face shape, glasses, lighting and landmark noise affect accuracy; this is not a validated gaze measurement instrument or a claim of parity with the research implementation.

## Guided calibration

The app automatically tries values every 1.8 seconds, changing only the current parameter: lateral head gain, leaning/depth gain, gaze contribution, One Euro filter response, then box depth. All other parameters remain fixed. “This looks best” freezes a value for fine adjustment; “Keep this setting” advances. Pause/resume, back and cancel are available. Missing tracking pauses the sweep, and missing gaze pauses the eye-movement step. The user judges the result; this flow does not infer a quality score or implement multi-point screen-gaze regression.

Save stores only bounded numeric settings in local browser storage. Cancel restores the starting settings. The separate gaze-calibration flow can now save multi-distance mappings and their sparse neutral face reference locally per webcam; camera images and raw fixation recordings are not persisted. Physical browser width and viewing distance remain measured inputs in Physical calibration. A One Euro filter smooths the combined viewpoint before rendering. Left/right eye selection can help evaluate the single-view illusion, although the tracker still needs both eyes visible and open.

## Platform and capability boundaries

The core effect uses WebGL 2, WASM, a front RGB camera and off-axis projection, not WebXR. It is designed for modern desktop browsers and iOS Safari over HTTPS. It does not require Safari to expose native eye-gaze or an immersive WebXR session. Full view has a CSS fallback on iOS. USDZ Quick Look is shown only when supported. Local model files and camera frames are not uploaded. The bundled demo asset is served with the app.

An ordinary panel displays one image to both eyes. This implementation provides motion parallax and perspective, not glasses-free binocular stereopsis. PLY meshes and colored point clouds are supported; Gaussian splat PLY files are displayed as points, not ellipsoidal splats. Complex USD features unsupported by Three.js may need a flattened mesh export.

## Verification boundaries

Automated tests cover off-axis invariants, head-local eye reconstruction under rigid rotation, iris-only gaze motion without head/depth drift, landmark/blink gating, calibration sweep isolation and freezing, settings validation, filtering, ASCII/binary PLY and the supplied binary USDZ geometry/material binding. The Node USDZ test stubs image load completion and verifies JPEG bytes; it does not validate GPU texture rendering. Camera lifecycle tests additionally simulate permission cancellation, denial, camera revocation, worker stalls, calibration and tracking loss/recovery. Hardware camera tracking, iOS Safari and Quick Look require physical-device testing. Optional WebMCP registration has no supported validation context in this environment and is not claimed as verified.

## Metric reconstruction and known-target calibration

The viewer now defaults to WebEyeTrack-style face reconstruction and radial refinement, with a robust 27-landmark XYZ reprojection fit. The original nose-scale method remains available under Physical calibration. A separate gaze calibration learns nine known targets and checks five unseen targets at each of three viewing distances. It reports error for each distance before saving a webcam-specific mapping and blends predictions as measured depth changes. See [the calibration method and validation limits](gaze-calibration.md) and [WebEyeTrack attribution](../THIRD_PARTY_NOTICES.md).

## Hand manipulation

[MediaPipe Hand Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) supplies 21 landmarks per hand. We use the existing `@mediapipe/tasks-vision` package and the official float16 Hand Landmarker model bundle, version 1, hosted with the app. The bundle contains palm and landmark models. The [official worker example](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/hand-landmarker.worker.ts) is the API/workflow reference; our worker follows the existing app's ESM WASM initialization and GPU-to-CPU fallback. [MediaPipe Apache 2.0 license](../public/mediapipe-license.txt).

An opt-in hand worker reads ImageBitmaps from the same video element as the face tracker. It never requests or owns a second stream and can run before eye centering or while the face is temporarily occluded. At most one hand frame is in flight, at a maximum of roughly 15 Hz, with no queue. Workers keep synchronous inference off the UI thread; simultaneous inference still adds CPU/GPU cost. We have not measured combined real-device performance.

Pinch distance between thumb tip (4) and index tip (8) is normalized by palm span. Image Y is corrected for aspect ratio and X is mirrored to match the preview. A pinch closes below 0.30 palm spans and opens above 0.48, with a 150 ms dwell before motion. Landmark continuity matches hands across frames without depending on array order or left/right labels. Grip positions use exponential smoothing. Tiny/cropped/nonfinite hands, discontinuities, excessive deltas, overlapping grips and frame gaps release the grab. Opening the hand is required after a reset or loss. A one-to-two-pinch transition rebases without applying an immediate transform; dropping one of two pinches releases the two-hand manipulation.

A one-hand drag applies yaw and pitch about the model center. Two hands apply the ratio of their pinch separation and a wrapped twist angle. Model size is bounded to 20–250% of its fitted size. Rotations use quaternions in the viewing basis. The box, camera orientation, off-axis screen plane and gaze calibration are unaffected. Model reset restores the fitted size and initial orientation. All model types use the same transform group.

Hand input pauses during eye centering, known-target gaze calibration, depth tuning and model loading. Pausing, reset and camera changes invalidate in-flight gesture results. Detection older than 300 ms cannot apply a transform. Worker errors/stalls disable hand processing with a retry action while leaving the shared webcam under the face tracker's ownership. Turning off hand controls keeps the camera and eye tracker running. No hand images, landmarks or gestures are stored or uploaded.

Synthetic gesture tests cover mirrored motion, pinch hysteresis/dwell, two-hand scale/twist, reordered detections, release, loss, stale frames, resets and transition rebasing. Worker lifecycle tests cover shared camera ownership, frame backpressure, pauses, late results/bitmaps, failure and retry. Transform tests check model-center rotation, scale limits and unchanged screen projection. These tests do not establish actual desktop/iOS detection accuracy or gesture feel.

Model bundle SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` (7,819,105 bytes). [Official version 1 model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task).
