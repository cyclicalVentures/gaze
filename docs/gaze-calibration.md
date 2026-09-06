# Face reconstruction and personal gaze calibration

Implemented 6 September 2026. The browser processes camera landmarks and calibration locally. No camera frames, landmarks, targets or learned coefficients are uploaded or persisted. Rendering preferences may still be saved in local storage.

## Face geometry

[WebEyeTrack source](https://github.com/RedForestAI/WebEyeTrack/blob/main/js/src/utils/mathUtils.ts) motivates the metric reconstruction and radial depth refinement. Our adaptation uses the measured neutral viewing distance and pupil distance to estimate effective camera focal length. At centering, it freezes 27 upper-face landmarks as a head-local 3D shape. MediaPipe supplies anatomical orientation axes each frame. Median radial scale initializes depth, then a Huber-weighted projection Jacobian refines XYZ translation. A poor residual or too few inliers holds the last view. The residual shown in the inspector is in camera-image pixels, not screen pixels.

This is a calibrated monocular estimate. It still depends on entered distance/IPD, approximate MediaPipe landmark depth, a rigid face model and an undistorted pinhole camera assumption. Rotation comes from anatomical landmark axes; this is not a full six-degree-of-freedom PnP solve. Facial expression, glasses, unusual camera placement and extreme pose can still cause errors. Select Original nose scale under Physical calibration to compare methods. See [MIT attribution](../THIRD_PARTY_NOTICES.md).

## Gaze mapping

The JEOresearch head-local eye spheres still supply two raw iris-direction vectors. We intersect their average ray with the screen using measured head position, before perceptual gains or depth reversal. Nine known targets provide a personal correction for bias and nonlinear distortion. The regression uses standardized horizontal and vertical intersections plus quadratic terms, with an intercept and ridge regularization. Each target contributes equally through robust median features.

Each fixation settles for 800 ms, then collects for at least 800 ms and at least 15 unique valid frames. Invalid or closed eyes supply no sample. A gap over 220 ms restarts the current fixation. Pause/resume restarts that fixation, while completed targets remain. Camera reset, recentering or a changed screen invalidates an in-progress session. The target sequence never displays predicted gaze during collection, so users cannot chase the prediction.

The candidate is fitted once, after the nine learning positions. Five spatially different positions are collected afterward and never used to train or refit the model. The check reports mean per-frame Euclidean error, the 95th percentile and the worst target's average-position error, all in CSS pixels. The diagram joins each target to its average prediction.

## Applying and resetting

Use calibration is available only when all five checks have enough samples and errors pass a basic guard: mean below 12% of screen diagonal, 95th percentile below 22%, and worst target-average below 20%. These are permissive application guards, not research benchmarks or medical accuracy thresholds. Large errors require another attempt. The previous mapping remains until a new candidate is explicitly applied; cancel does not replace it.

The calibrated screen point determines the iris-direction contribution to a 6 mm optical-viewpoint offset. It does not rotate the projection or orbit the model. Depth tuning can amplify this contribution. The measured distance remains separate from the Grow when closer preference, which intentionally reverses virtual Z displacement around the neutral distance.

The mapping is valid only for the current camera/centering/geometry/viewpoint and browser viewport. Stopping, backgrounding, recentering, resizing, changing orientation or changing reconstruction/viewpoint clears it. Changing the physical measurements requires restarting and centering. Calibration is checked near a stationary centered head, not across a validated range of head movement; recalibrate after repositioning the device.

## Verification and remaining limits

Numerical tests recover synthetic forward and sideways translation, reject inconsistent geometry, tolerate isolated landmark outliers, and keep synthetic rigid rotation from becoming depth motion. Gaze tests recover a known sensor bias on unseen targets, reject constant/invalid signals, verify held-out isolation and ensure duplicate frames do not count. Tracker integration tests cover calibration application, invalidation, subscription cleanup, metric/legacy comparison and the retained approach-growth behavior. Existing PLY and supplied textured USDZ tests still pass.

These checks validate code and mathematical cases. They do not establish real-camera accuracy, latency or a convincing visual effect on physical desktop/iOS hardware. This adaptation does not include the BlazeGaze CNN, TensorFlow.js personalization or the full WebEyeTrack pipeline. No upstream benchmark result is claimed for this implementation.

## Sources

- [WebEyeTrack / BlazeGaze repository](https://github.com/RedForestAI/WebEyeTrack/tree/main/js)
- [WebEyeTrack paper](https://arxiv.org/abs/2508.19544)
- [JEOresearch Webcam3DTracker](https://github.com/JEOresearch/EyeTracker/tree/main/Webcam3DTracker)
- [EyeTrax calibration workflow reference](https://github.com/ck-zhang/EyeTrax/blob/master/src/eyetrax/calibration/adaptive.py)
- [Other evaluated tracking implementations](sota-tracking.md)
