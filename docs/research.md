# Head-coupled window rendering
Reviewed 6 September 2026. The requested effect is head-coupled perspective (often called fish-tank VR): a physical screen is a fixed window into a rendered scene.

## Sources and decisions

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

## Eye-position estimate

Average roughly half a second of iris observations while the user centers their eyes on the viewport. With neutral eye distance `d0`, pixel eye separation `s0`, and physical interpupillary distance `ipd`, derive effective focal length `f=s0*d0/ipd`. For each observed separation `s`, estimate `z=d0*s0/s`. The optical center is approximated by the image center. Both current and neutral eye locations are reconstructed in camera coordinates before subtraction; this compensates for the camera being above or beside the viewport during forward motion. Pixel displacement maps to meters via `z/f`. The normalized landmark depth difference approximately compensates for head yaw; it is not metric depth from a depth sensor. A One Euro filter is applied to each axis. Camera images are unmirrored for inference; the X sign converts them to viewer-centered coordinates. Preview is mirrored for the familiar camera UI.

This is a calibrated monocular estimate, not a camera-intrinsic calibration or research-grade 6DOF eye tracker. Pupil motion, face shape, camera lens distortion, head rotation, glasses, and lighting can affect accuracy. Translational head motion is the main input; looking around with a stationary head should not orbit the scene. Left/right eye selection can improve the illusion when the other eye is closed.

## Platform and capability boundaries

The core effect uses WebGL 2, WASM, a front RGB camera and off-axis projection, not WebXR. It is designed for modern desktop browsers and iOS Safari over HTTPS. It does not require Safari to expose native eye-gaze or an immersive WebXR session. Full view has a CSS fallback on iOS. USDZ Quick Look is shown only when supported. Local model files and camera frames are not uploaded. The bundled demo asset is served with the app.

An ordinary panel displays one image to both eyes. This implementation provides motion parallax and perspective, not glasses-free binocular stereopsis. PLY meshes and colored point clouds are supported; Gaussian splat PLY files are displayed as points, not ellipsoidal splats. Complex USD features unsupported by Three.js may need a flattened mesh export.

## Verification boundaries

Automated tests cover off-axis invariants, eye reconstruction, filtering, ASCII/binary PLY and the supplied binary USDZ geometry/material binding. The Node USDZ test stubs image load completion and verifies JPEG bytes; it does not validate GPU texture rendering. Camera lifecycle tests additionally simulate permission cancellation, denial, camera revocation, worker stalls, calibration and tracking loss/recovery. Hardware camera tracking, iOS Safari and Quick Look require physical-device testing. Optional WebMCP registration has no supported validation context in this environment and is not claimed as verified.
