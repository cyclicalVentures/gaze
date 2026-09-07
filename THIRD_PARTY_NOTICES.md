# Eye-tracker attribution

The head-local eye sphere calibration and iris-to-center gaze vector in `lib/viewer/eye-model.ts` adapt the approach in JEOresearch/EyeTracker, Webcam3DTracker/MonitorTracking.py, reviewed 6 September 2026. The TypeScript implementation uses anatomical landmark axes in place of PCA, metric radius and optical-viewpoint priors, confidence gating, and off-axis rendering.

https://github.com/JEOresearch/EyeTracker/tree/main/Webcam3DTracker

MIT License

Copyright (c) 2024 JEOresearch

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


# WebEyeTrack geometry attribution

The metric reconstruction and bounded radial depth refinement in `lib/viewer/metric-face.ts` adapt the geometric approach in WebEyeTrack, `js/src/utils/mathUtils.ts` (`faceReconstruction` and `refineDepthByRadialMagnitude`), reviewed 6 September 2026. This implementation freezes a neutral landmark shape, uses distance/IPD priors, median radial correction and robust XYZ reprojection fitting. It does not import BlazeGaze weights or reproduce the full WebEyeTrack pipeline.

https://github.com/RedForestAI/WebEyeTrack/blob/main/js/src/utils/mathUtils.ts

MIT License

Copyright (c) 2025 (Eduardo Davalos, Yike Zhang, Amanda Goodwin, Gautam Biswas)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
## MediaPipe Hand Landmarker

Hand tracking uses @mediapipe/tasks-vision and the unmodified Google MediaPipe Hand Landmarker float16 model bundle, version 1 (hand_detector.tflite and hand_landmarks_detector.tflite).

Source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
Documentation: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
Reference worker: https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/hand-landmarker.worker.ts

MediaPipe is Copyright The MediaPipe Authors, licensed under Apache License 2.0. A copy ships in public/mediapipe-license.txt. The app's pinch-clutch, hand association, gesture mapping, transform handling and shared-camera lifecycle code are original implementation code.
