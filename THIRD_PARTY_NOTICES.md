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
