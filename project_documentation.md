# ExamGuard — Technical System Documentation & Architecture Guide

ExamGuard is a real-time online exam proctoring system based on the principles of **motion-based keyframe extraction, edge-side neural inference, multi-modal sensor fusion, and invigilator dashboard visualization**. Below is the in-depth technical breakdown of every pipeline in the system.

---

## 🏛️ 1. High-Level Architecture Overview

The system is constructed as a modern, decoupled **monorepo** consisting of three core pillars:

1. **Student Exam Client (`/client`):** A React web portal running in the student's browser. It captures webcam and microphone input and performs **100% of the AI processing locally (on the edge)** to respect privacy and eliminate server GPU costs.
2. **Proctoring Backend (`/backend`):** A FastAPI server written in Python. It manages active exam sessions, serves static assets (keyframe screenshots and video clips), handles binary evidence uploads, and orchestrates live WebSocket communication.
3. **Invigilator Dashboard (`/dashboard`):** An administrative workspace for proctors. It receives live abnormality notifications, displays automated video evidence highlights, houses comparative model benchmarks, and compiles PDF reports.

---

## 🧠 2. Detailed Technical Breakdown of the 5 Phases

### Phase 1: Local ONNX Model Integration (Webcam Inference)
*   **The AI Model:** We exported a customized MobileNetV2 classification model (pre-trained on facial classification tasks) into the **ONNX (Open Neural Network Exchange)** format.
*   **In-Browser Running:** Using `onnxruntime-web` (ONNX Runtime compiled to WebAssembly), the student's browser loads the model locally into CPU memory.
*   **Pipeline:** 
    1. Every frame from the `<video>` element is drawn onto a hidden HTML5 `<canvas>`.
    2. The canvas pixel data is resized to `224x224`, normalized to matching ImageNet channel distributions (subtracting means, dividing by standard deviations), and converted to a Float32 Tensor.
    3. The tensor is fed to the ONNX session to evaluate student posture and classify behavior (e.g. Normal, External Device, Talking).

### Phase 2: Multi-Modal Sensor Fusion (Face Mesh, Gaze & Audio)
To ensure the proctoring coverage is comprehensive, we fused three separate sensing modalities:
1. **Head Pose Estimation (Face Mesh):** 
   Using Google **MediaPipe Face Mesh**, we extract 468 landmark coordinates. By tracking the distance between core landmarks (nose tip, chin, left eye corner, right eye corner) relative to a normalized baseline plane, we calculate the Pitch (up/down) and Yaw (left/right) rotation angles of the head.
2. **Pupil / Iris Gaze Tracking:**
   We isolate the bounding boxes of the left and right eyes. By comparing the position of the iris center relative to the eye corner boundaries, the system determines if the student's gaze is diverted (looking left/right/down at a cheat sheet) for a sustained period.
3. **Speech Detection (Web Audio API):**
   We initialize an `AudioContext` from the student's microphone stream. An `AnalyserNode` performs a **Fast Fourier Transform (FFT)**, slicing audio into frequency bins. The system calculates the average amplitude within the human voice frequency band (85Hz to 255Hz). If the amplitude exceeds a configured decibel threshold, a speech violation is flagged.

### Phase 3: Temporal Debouncing & Video Verification
*   **Temporal Debouncing (Eliminating False Positives):**
    Single-frame glitches (like looking away for a split second or coughing) shouldn't flag a student. The client maintains **consecutive frame counters** for each infraction type:
    - **Visual violations (e.g., Gaze Diverted, Head Pose, Device):** Must persist continuously for **3.0 seconds** (approx. 90 frames) before committing an alert.
    - **Acoustic violations (Speech):** Must persist continuously for **2.0 seconds** before triggering.
*   **Automated Video Evidence Highlights:**
    The client maintains a rolling video buffer in memory using the browser's native `MediaRecorder` API. 
    1. When a debounced infraction is confirmed, the client triggers a recording snapshot.
    2. It captures the **exact 5 seconds** of the violation context (webcam stream).
    3. The recorder exports this stream as a `.webm` clip.
    4. The client uploads the clip via `multipart/form-data` REST endpoint (`POST /session/{id}/alert/{id}/video`) to the FastAPI backend.
    5. The backend stores the file in `data/clips/` and associates it with the database alert log.

### Phase 4: Comparative Benchmarks Station
Designed to display academic rigor, this workspace inside the dashboard presents:
*   **The 5 Tested Architectures:** Custom CNN, DenseNet121, Inception-V3, Inception-ResNetV2, and YOLOv5.
*   **Recharts Layouts:** Renders interactive graphs showcasing **mAP (mean Average Precision)** scores and **Edge Inference Latency** (in milliseconds).
*   **Precision-Recall Curve (SVG):** A custom SVG component that dynamically draws the PR coordinate lines for the selected model. YOLOv5 is plotted closest to the perfect top-right corner ($1.0$ precision, $1.0$ recall), while Custom CNN represents the fast, lightweight edge baseline.
*   **Abnormality Confusion Matrix:** A 5x5 grid comparing actual vs predicted anomalies for each model (Normal, Device, Head, Multi-person, Talk), showing classification leakages.

### Phase 5: Admin Validation (Overrides) & PDF Reports
*   **SQLite Overrides:** Every alert has an `override_status` field (starts as `pending`). If an invigilator reviews an alert and discovers it was a false alarm (e.g., the student was adjusting their glasses), they click **Dismiss**. If it was a real violation, they click **Confirm**. 
*   **WebSocket Syncing:** The update is committed to SQLite via a REST API call, and immediately broadcast via WebSockets to keep all active dashboards in sync.
*   **CSS-Printable Institutional Reports:**
    Instead of installing heavy PDF generation software, we implemented `@media print` CSS styles in `index.css`. 
    When the invigilator clicks **Compile PDF Report**:
    1. The page triggers `window.print()`.
    2. The style sheet immediately hides search forms, sidebar buttons, navigation items, and dark backgrounds.
    3. It formats the student details, session timeline charts, and screenshot keyframes into a formal, paper-optimized layout.
    4. The browser compiles it into a pixel-perfect PDF report ready to save or print.

---

## 📁 3. Core File Map

*   `backend/app/database/models.py`: Database tables for `ExamSession` and `SessionAlert` including `video_clip_path` and `override_status`.
*   `backend/app/main.py`: Main FastAPI app holding WebSocket connections, static file directories, video upload REST handlers, and override endpoints.
*   `client/src/App.tsx`: Student exam interface, webcam/microphone capture, MediaPipe tracking, debouncing sliding window, and MediaRecorder rolling captures.
*   `dashboard/src/App.tsx`: Invigilator panel, WebSocket client, model comparison charts, interactive PR curve/confusion matrix, and Modal video player.
*   `dashboard/src/index.css`: Tailwind utility style sheet + `@media print` CSS overrides.
