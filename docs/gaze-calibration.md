# Face reconstruction and personal gaze calibration

Updated 7 September 2026. Camera processing and calibration run locally. The user can save a multi-distance gaze profile in local storage for the selected webcam. Saved data includes numeric coefficients, the sparse neutral face reference needed to reconstruct the same eye model, physical screen settings and accuracy summaries. Camera frames and fixation recordings are never uploaded or saved.

## Face geometry

[WebEyeTrack source](https://github.com/RedForestAI/WebEyeTrack/blob/main/js/src/utils/mathUtils.ts) motivates the metric reconstruction and radial depth refinement. Our adaptation uses the measured neutral viewing distance and pupil distance to estimate effective camera focal length. At centering, it freezes 27 upper-face landmarks as a head-local 3D shape. MediaPipe supplies anatomical orientation axes each frame. Median radial scale initializes depth, then a Huber-weighted projection Jacobian refines XYZ translation. A poor residual or too few inliers holds the last view. The residual shown in the inspector is in camera-image pixels, not screen pixels.

This is a calibrated monocular estimate. It still depends on entered distance/IPD, approximate MediaPipe landmark depth, a rigid face model and an undistorted pinhole camera assumption. Rotation comes from anatomical landmark axes; this is not a full six-degree-of-freedom PnP solve. Facial expression, glasses, unusual camera placement and extreme pose can still cause errors. Select Original nose scale under Physical calibration to compare methods. See [MIT attribution](../THIRD_PARTY_NOTICES.md).

## Gaze mapping

The JEOresearch head-local eye spheres still supply two raw iris-direction vectors. We intersect their average ray with the screen using measured head position, before perceptual gains or depth reversal. Nine known targets at each of three viewing distances provide personal corrections for bias and nonlinear distortion. The regression uses standardized horizontal and vertical intersections plus quadratic terms, with an intercept and ridge regularization. Each target contributes equally through robust median features.

Each fixation settles for 800 ms, then collects for at least 800 ms and at least 15 unique valid frames. Invalid or closed eyes supply no sample. A gap over 220 ms restarts the current fixation. Pause/resume restarts that fixation, while completed targets remain. Camera reset, recentering or a changed screen invalidates an in-progress session. The target sequence never displays predicted gaze during collection, so users cannot chase the prediction.

The normal, near and far sets each contain nine learning positions and five spatially different check positions: 27 learning fixations and 15 held-out fixations in total. Normal starts at the entered neutral distance, bounded to 25–130 cm so three bands fit within the tracker range. Near/far are offset by 22% of normal distance, bounded to 8–15 cm. The UI displays the requested and measured distances, waits for 600 ms of stable positioning, and requires the user to begin each set. A fixation must remain within 2.5 cm of its requested distance; drifting, blinks, pauses and frame gaps reset only that fixation.

Each distance gets its own quadratic map, anchored at the median measured training distance. Runtime predictions blend linearly between adjacent maps using measured head depth, before any depth reversal. Beyond the calibrated depth interval, use the nearest map without depth extrapolation. No accuracy is claimed beyond the sampled range.

The check positions never train or refit the maps. After all three sets, validate the final blended model using every held-out frame's measured distance. Each distance reports mean per-frame Euclidean error, the 95th percentile and the worst target's average-position error in CSS pixels. The result diagram can switch between distance sets.

## Applying and resetting

Save & use is available only when all five checks at every distance have enough samples and each distance passes a basic guard: mean below 12% of screen diagonal, 95th percentile below 22%, and worst target-average below 20%. These are permissive application guards, not research benchmarks or medical accuracy thresholds. Large errors require another attempt. The previous mapping remains until a new candidate is explicitly applied; cancel does not replace it.

The calibrated screen point determines the iris-direction contribution to a 6 mm optical-viewpoint offset. It does not rotate the projection or orbit the model. Depth tuning can amplify this contribution. The measured distance remains separate from the Grow when closer preference, which intentionally reverses virtual Z displacement around the neutral distance.

## Saving and reusing a webcam profile

The webcam selector requests a specific device. Profiles use the actual running track's origin-scoped `deviceId`, never its human-readable name or the default-camera alias. Two cameras with identical labels therefore keep separate profiles. One saved profile is kept per webcam; saving replaces only that webcam's previous profile after all checks pass. Cancel and failed checks preserve the old save. Forget saved calibration deletes that webcam's record and clears the active gaze mapping.

After the user enables a camera, a matching save restores the original neutral face reference, eye spheres, metric face model, screen origin, physical measurements, viewpoint and three gaze maps. It does not require recentering first: recentering would change the coordinate reference learned by the maps. Camera access is never enabled automatically on reload. Saving/restoring does not replace the subjective depth tuning.

Auto-restore checks camera identity, frame resolution, facing mode, reported lens zoom/crop mode, browser viewport dimensions, display dimensions and device pixel ratio. A mismatch preserves the save but blocks restoration and explains how to recalibrate or restore the previous layout. Version and shape validation reject malformed, incomplete or obsolete records. Storage denial/quota errors leave a newly applied mapping usable for that visit and explicitly report that it was not saved. Unknown/default camera identifiers cannot be saved. Camera names are display labels, not an identity fallback.

Stopping or backgrounding clears live tracking but retains local saves. Resizing, recentering and geometry/viewpoint changes invalidate the live mapping and any capture in progress. A user-edited physical setup is not automatically overwritten on the next start in the same visit; the user can explicitly restore a compatible save. A camera-resolution change during capture stops tracking. Restore is available again after returning to a compatible layout.

The app cannot identify the person in front of the camera or detect a physically moved webcam, a same-sized replacement monitor, lighting/glasses changes or every driver-level lens change. Recalibrate for another user or changed placement. Distance sampling improves depth coverage; it does not independently validate extreme head rotation or motion between fixation sets. Local saves belong to this browser and site; clearing site data or private browsing may remove them or change device IDs.

## Verification and remaining limits

Numerical tests recover synthetic forward and sideways translation, reject inconsistent geometry, tolerate isolated landmark outliers, and keep synthetic rigid rotation from becoming depth motion. Gaze tests recover a known sensor bias on unseen targets, reject constant/invalid signals, verify held-out isolation and ensure duplicate frames do not count. Tracker integration tests cover calibration application, invalidation, subscription cleanup, metric/legacy comparison, camera restart restoration, changed-resolution rejection and the retained approach-growth behavior. Multi-distance state-machine tests cover the entire 42-fixation sequence, distance drift, pause/gap gating, held-out isolation and one bad distance blocking application. Storage tests cover camera isolation, JSON round trips, compatibility checks, malformed records, blocked storage and per-camera deletion. Existing PLY and supplied textured USDZ tests still pass.

These checks validate code and mathematical cases. They do not establish real-camera accuracy, latency or a convincing visual effect on physical desktop/iOS hardware. This adaptation does not include the BlazeGaze CNN, TensorFlow.js personalization or the full WebEyeTrack pipeline. No upstream benchmark result is claimed for this implementation.

## Sources

- [WebEyeTrack / BlazeGaze repository](https://github.com/RedForestAI/WebEyeTrack/tree/main/js)
- [WebEyeTrack paper](https://arxiv.org/abs/2508.19544)
- [JEOresearch Webcam3DTracker](https://github.com/JEOresearch/EyeTracker/tree/main/Webcam3DTracker)
- [EyeTrax calibration workflow reference](https://github.com/ck-zhang/EyeTrax/blob/master/src/eyetrax/calibration/adaptive.py)
- [Other evaluated tracking implementations](sota-tracking.md)

- [MediaTrackSettings.deviceId and identity across sessions](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/deviceId)
- [Camera enumeration and permission-dependent device labels](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
- [Local storage lifetime and browser restrictions](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
