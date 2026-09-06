# Gaze
A browser-based PLY and USDZ viewer for desktop and iOS, with camera-based eye navigation and immersive viewing on capable devices.

The primary task is to open a local model, inspect it with mouse/touch, and optionally use camera tracking. User-supplied demo: /tmp/USDZ-test.usdz (Scaniverse textured binary USD).

Visual reference: ~/stridemind. Inherit Space Grotesk, deep violet surfaces, teal signals, coral primary actions, restrained angular details.

Confirmed user direction: reconstruct the view from the head/eye position so the screen looks like a box with depth. Use fixed-screen off-axis projection; eye rotation must not orbit the scene. Start with a cube, retain PLY/USDZ import and bundled Scaniverse demo. Research current papers and GitHub implementations. Webcam estimates are approximate. No native continuous eye-gaze API is assumed. Browser support is detected. iOS has touch and Quick Look; the clarified window effect does not require WebXR or a headset. Local model and camera processing stays in the browser. No account is needed. User-chosen numeric tuning settings can be saved in local browser storage; images and eye calibration are never persisted.

Eye orientation follows the JEOresearch Webcam3DTracker approach: calibrated head-local eye spheres plus iris direction. Guided calibration sweeps one setting at a time; the user freezes their preferred value, reviews, and saves. Preserve the fixed screen plane.
