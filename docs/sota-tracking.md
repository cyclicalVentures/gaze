# Tracking implementation shortlist

Reviewed 6 September 2026 against original papers and repository source. These systems solve different tasks: metric head position, gaze direction, or the point looked at on a screen. A gaze benchmark winner does not necessarily provide the eye position required for a convincing window. “SOTA” here means useful current research candidates, not a claim that every project leads the same benchmark.

## Best fit: WebEyeTrack / BlazeGaze

[Repository and browser implementation](https://github.com/RedForestAI/WebEyeTrack/tree/main/js) · [2025 paper](https://arxiv.org/abs/2508.19544)

Browser TypeScript, TensorFlow.js, worker inference, packaged weights, and on-device personalization. The paper reports 2.32 cm error on GazeCapture and 2.4 ms model inference on an iPhone 14; these are author results, not measurements of our combined tracker and renderer. Its error and runtime cannot be compared directly with different datasets or full camera pipelines.

Inspected `js/src/WebEyeTrack.ts`, `BlazeGaze.ts`, and `utils/mathUtils.ts`. `faceReconstruction` estimates translation and refines depth from projected-versus-detected radial scale, rather than relying only on nose spread. BlazeGaze combines an eye image with head direction and face origin. This is the strongest candidate for both a better geometry baseline and a learned gaze backend. Its metric reconstruction still needs a face-size and camera model. Code license: MIT.

## Head position reference: OpenSeeFace

[Repository](https://github.com/emilianavt/OpenSeeFace) · [depth estimation source](https://github.com/emilianavt/OpenSeeFace/blob/master/tracker.py)

An established CPU tracker, rather than a new 2026 gaze leaderboard model. Inspected `Tracker.estimate_depth`: iterative `solvePnP`, previous-pose initialization, a face model, camera projection and reprojection-error checks. These are directly useful for diagnosing whether head rotation is being mistaken for forward motion. Its Python/ONNX implementation and Unity integration need adaptation for our browser; simply installing it does not supply an iOS web tracker. The README specifies BSD-2-Clause for code and models.

## Learned gaze-direction candidate: MobileGaze

[Repository](https://github.com/yakhyo/gaze-estimation) · [ONNX inference](https://github.com/yakhyo/gaze-estimation/blob/main/onnx_inference.py)

An L2CS-Net-derived implementation with MobileOne, MobileNet and ResNet backbones, weights and ONNX export. Inspected its face preprocessing and separate yaw/pitch-logit decoding. A candidate for testing an appearance model against our iris-vector heuristic. It outputs gaze angles; metric eye position and screen calibration remain separate. Browser inference would require an ONNX Runtime Web port and device benchmarks. Do not transfer L2CS-Net's reported accuracy to every MobileGaze checkpoint. Check the chosen weight provenance in addition to the MIT code license.

## Calibration reference: EyeTrax

[Repository](https://github.com/ck-zhang/EyeTrax) · [adaptive calibration](https://github.com/ck-zhang/EyeTrax/blob/master/src/eyetrax/calibration/adaptive.py)

Python calibration and filtering infrastructure, not a validated SOTA claim. Inspected its adaptive routine: nine-point initialization, additional spatially distributed targets, a settling interval before collecting samples, blink rejection and periodic refitting. Its repository also exposes five-point, dense-grid and Lissajous routines. These are useful references for collecting actual target/eye correspondences; the separate depth-effect tuning only selects rendering preferences. Our new known-target calibration follows a settling/collection/check workflow. MIT code; the workflow would need a browser implementation.

## Browser calibration reference: RealEye Light Open

[Repository](https://github.com/RealEye-io/webcam-eyetracker-light-open) · [feature extraction](https://github.com/RealEye-io/webcam-eyetracker-light-open/blob/main/lib/features/FeatureExtractor.ts)

TypeScript, MediaPipe, ridge regression, 17-point calibration and head-pose features. Inspected its feature extractor and calibration API. Useful for studying normalization and explicit target collection. Its README recommends desktop and describes reduced mobile accuracy. Current licensing is AGPL/commercial, not the Apache license of its MediaPipe dependency. This review does not import its source or add a dependency.

## Newer research to watch: EMC-Gaze, March 2026

[Paper](https://arxiv.org/abs/2603.12388) · [methods and limitations](https://arxiv.org/html/2603.12388v1)

An equivariant landmark encoder with a small per-session ridge calibrator. The paper reports a 4.76 MB ONNX export and approximately 12.6 ms browser prediction in Chromium 145. It explicitly positions itself as a calibration/runtime tradeoff rather than universal SOTA. I could not verify a public repository or trained-model release for EMC-Gaze; the manuscript promises a release, and the author's public EyeTrax repository is not evidence that the EMC model is available. Treat it as a research design reference for now.

## Further research, lower deployment priority

[Idiap gaze3d, CVPR 2025](https://github.com/idiap/gaze3d) provides code and checkpoints for unconstrained 3D gaze with weak supervision. Its video-model pipeline and research/noncommercial dependencies make it less immediate for this client-only viewer. [GA3CE, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Kawana_GA3CE_Unconstrained_3D_Gaze_Estimation_with_Gaze-Aware_3D_Context_Encoding_CVPR_2025_paper.html) uses scene/body context when eyes may not be visible; that is a different operating point from a front-camera display viewer.

## Recommended implementation order

1. Improve and validate metric head translation with WebEyeTrack-style reprojection refinement or a PnP fit. Measure depth error under pure translation and rotation separately, plus reprojection residual and motion-to-render latency.
2. Collect gaze calibration at known targets with a settling period and blink rejection. Reserve separate targets for validation; report center and edge errors and repeat with head movement. Keep preference sweeps separate from accuracy calibration.
3. Compare the current sphere model with personalized BlazeGaze using the same camera clips, geometry, targets and device. Run both at the same input resolution and report the entire camera-to-render pipeline on desktop and physical iOS hardware.
4. Consider MobileGaze if it improves held-out angular accuracy within the phone's runtime budget. Keep model loading optional and processing local.

Implemented in this update: WebEyeTrack-style geometric reconstruction and radial depth refinement, followed by robust XYZ reprojection fitting, plus a local known-target polynomial ridge gaze map. Nine learning targets and five separate check targets keep fitting separate from validation. The original nose-scale estimator remains selectable. See [the method and limitations](gaze-calibration.md). BlazeGaze, OpenSeeFace, MobileGaze, EyeTrax and RealEye are not installed as backends; their benchmark results are not claims about this app. Physical-device motion and accuracy comparisons remain to be collected.
