# Gaze
A local-first PLY/USDZ web viewer with head-coupled perspective: your screen acts as a fixed window into a 3D box. Built with React, Three.js and MediaPipe, using the Stridemind theme.

## Run

```sh
npm install
npm run dev -- --host 0.0.0.0
npm run typecheck
npm test
npm run build
```

Camera access requires HTTPS or localhost. To use a phone, open the deployed HTTPS site; plain HTTP on a LAN IP will not enable its camera. Use modern Safari on iOS, Chrome/Edge/Safari/Firefox on desktop with WebGL 2 enabled.

## Try it

1. Start with the geometric cube. Enable **Pointer preview** for an immediate camera-free demonstration of the off-axis projection.
2. Open **Physical calibration**. Enter the measured width of the visible browser page, viewing distance, and pupil distance if known. Defaults are estimates.
3. Place the device on a stable surface, enable head tracking, center your eyes directly in front of the 3D viewport, and click **Set eye position**. Look at the center target during the three-second countdown.
4. Open **Calibrate gaze with targets**. Keep your head still and look at nine learning dots, followed by five different check dots. Review the error and choose **Use calibration** if the check passes. Then open **Tune the depth effect**. Follow each movement prompt while values change automatically. Choose **This looks best**, optionally fine-adjust, then **Keep this setting**. Save after all five steps. Use **Recenter** after moving the screen/camera.
5. Choose **USDZ test model** for the supplied Scaniverse model, or open/drop a `.ply` or `.usdz`. Use **Orbit** to inspect normally; Window remains physically anchored.

Full view supports a CSS fallback on iOS. Camera access is opt-in and the stream is stopped on cancel, stop, backgrounding, page exit and mode changes. Face inference runs in a worker; its model and WASM are served from the same origin. No camera or imported model data is transmitted. The supplied demo is bundled as a site asset.

**View → Grow when closer** is enabled by default: leaning in enlarges the model on screen. Turn it off for physical window scaling. This changes virtual depth only and saves the preference. **Estimated screen distance** should fall when you lean closer; **View Z** includes your rendering settings. The physical window projection can shrink an object's pixel footprint as you approach. See the [depth explanation](docs/research.md) and [newer tracking implementation shortlist](docs/sota-tracking.md).

## Scope

- True asymmetric projection with a fixed physical screen plane, calibrated head-local eye spheres and per-eye gaze directions, adaptive filtering, tracking loss handling, and pointer/touch/keyboard preview.
- WebEyeTrack-style metric face reconstruction: a frozen neutral 3D shape, robust radial depth refinement and a 27-landmark reprojection fit. **Physical calibration → Head reconstruction** lets you compare the original nose-scale estimator.
- Personal gaze mapping from known targets, with settling time, invalid-eye rejection and five held-out validation targets. Reports average, 95th-percentile and worst-target errors in CSS pixels before applying. Gaze calibration is session-only and resets with recentering, camera restart, screen resize, viewpoint or geometry changes.
- Guided one-parameter sweeps for lateral/depth movement, eye contribution, motion response and box depth. Saved settings stay in this browser; cancel restores the previous settings.
- ASCII/binary PLY meshes and colored point clouds; ASCII/binary USD inside USDZ; embedded textures; fit/reset/zoom, wireframe and model orientation.
- Single-view motion parallax, not binocular stereoscopy on an ordinary screen. The clarified VR requirement is the window effect, so no headset or WebXR is required.
- Camera tracking is a monocular estimate, not a metric depth sensor. Gaussian splat attributes are not rendered as splats. Advanced USD composition/animation may need export as a static mesh.

See [research and implementation notes](docs/research.md) for current papers, GitHub references, projection derivation and verification limits. Automated checks do not substitute for testing camera motion and Quick Look on physical iOS/desktop devices.

## GitHub Pages

The live app is published at https://cyclicalVentures.github.io/gaze/. The `pages.yml` workflow checks types and tests, builds with `npm run build:pages`, then deploys `dist/pages`. A dedicated static Vite entry renders the same app component without requiring a server on GitHub Pages. `NEXT_PUBLIC_BASE_PATH` defaults to `/gaze` for this build; set it to an empty string for a root-hosted static build.

Eye orientation adapts the [JEOresearch Webcam3DTracker](https://github.com/JEOresearch/EyeTracker/tree/main/Webcam3DTracker) head-local sphere method. See [attribution](THIRD_PARTY_NOTICES.md). The default eye effect is subtle; amplification above 1× is an experimental perceptual adjustment, not literal eye geometry.

The geometry adaptation and local polynomial ridge mapping are implemented without the BlazeGaze neural model. Results from the WebEyeTrack paper are not accuracy or runtime claims for this app. See [the implemented calibration method](docs/gaze-calibration.md).
