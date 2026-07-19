import React, { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import * as ort from "onnxruntime-web";

interface Question {
  id: number;
  text: string;
  options: string[];
}

const MOCK_QUESTIONS: Question[] = [
  {
    id: 1,
    text: "According to Ramzan et al. (2024), which CNN/Object Detection architecture achieved the highest performance for online exam proctoring?",
    options: ["DenseNet121", "Inception-V3", "Inception-ResNetV2", "YOLOv5"]
  },
  {
    id: 2,
    text: "In motion-based keyframe extraction, what is the role of the frame differencing threshold?",
    options: [
      "To compress the video streams and reduce storage overhead on the server",
      "To eliminate redundant static frames and only pass high-motion transitions to the classification model",
      "To enhance image resolution and lighting levels using histogram models",
      "To track audio level anomalies and background voice cues"
    ]
  },
  {
    id: 3,
    text: "What is the primary benefit of deploying a WebSocket connection instead of HTTP polling in online proctoring systems?",
    options: [
      "Securing the database from SQL Injection",
      "Reducing connection establishment overhead and enabling low-latency, real-time alert broadcasts",
      "Avoiding the need for client-side webcam permissions",
      "Enabling off-grid local storage without network streams"
    ]
  },
  {
    id: 4,
    text: "Which of the following is a privacy-by-design policy recommended for proctoring systems?",
    options: [
      "Persisting 24/7 continuous video logs of students' rooms",
      "Storing only the keyframes classified as abnormal, and immediately discarding normal frames",
      "Uploading all user credentials directly to public clouds",
      "Disabling all local webcam warnings"
    ]
  }
];

const CLASS_LABELS: Record<number, string> = {
  0: "Normal",
  1: "External Device",
  2: "Head Movement",
  3: "Multiple Persons",
  4: "Talking to Others"
};

export default function App() {
  const [studentId, setStudentId] = useState("");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(2700); // 45 minutes in seconds
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(MOCK_QUESTIONS);
  const [showFeed, setShowFeed] = useState(false);
  const [proctorDebug, setProctorDebug] = useState({
    faces: 0,
    yaw: 1.0,
    pitch: 1.0,
    gazeL: 0.5,
    gazeR: 0.5,
    rms: 0.0,
    wsState: "CLOSED"
  });

  const webcamRef = useRef<Webcam>(null);
  const ortSessionRef = useRef<ort.InferenceSession | null>(null);
  
  // MediaPipe Face Mesh ref
  const faceMeshRef = useRef<any>(null);

  // Web Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // MediaRecorder refs for evidence highlight captures
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);

  // Temporal Debouncing Refs (sliding consecutive frame counters)
  const consecutiveCheekRef = useRef(0);
  const consecutivePitchRef = useRef(0);
  const consecutiveGazeRef = useRef(0);
  const consecutiveMissingRef = useRef(0);
  const consecutiveSpeechRef = useRef(0);
  const consecutiveMultipleRef = useRef(0);

  // Frame differencing tracking states in refs
  const prevFrameGrayRef = useRef<Uint8Array | null>(null);
  const diffHistoryRef = useRef<number[]>([]);

  // Sync state with refs to prevent stale closure in FaceMesh callback
  const sessionStartedRef = useRef(sessionStarted);
  const wsRef = useRef(ws);

  useEffect(() => {
    sessionStartedRef.current = sessionStarted;
  }, [sessionStarted]);

  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  // Load ONNX Model and Setup MediaPipe on start
  const initializeEngines = async () => {
    try {
      setModelLoading(true);
      setModelError(null);
      console.log("[ort] Loading model.onnx...");
      const session = await ort.InferenceSession.create("/model.onnx?v=2");
      ortSessionRef.current = session;
      setModelReady(true);
      console.log("[ort] Model loaded successfully.");

      // Setup MediaPipe Face Mesh from window object (CDN)
      const FaceMesh = (window as any).FaceMesh;
      if (FaceMesh) {
        console.log("[MediaPipe] Initializing FaceMesh...");
        const faceMesh = new FaceMesh({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
          maxNumFaces: 4,
          refineLandmarks: true, // required for iris tracking
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults(onFaceMeshResults);
        faceMeshRef.current = faceMesh;
        console.log("[MediaPipe] FaceMesh configuration completed.");
      } else {
        console.warn("[MediaPipe] FaceMesh script is not loaded from CDN.");
      }
    } catch (err: any) {
      console.error("[ort/MediaPipe] Engine initialization failed:", err);
      setModelError(err?.message || "Failed to load detection engine");
    } finally {
      setModelLoading(false);
    }
  };

  useEffect(() => {
    initializeEngines();
    return () => {
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
      }
      stopAudioAnalysis();
    };
  }, []);

  // Web Audio capture starter
  const startAudioAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioAnalyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      console.log("[AUDIO] Microphone input capture node active.");
    } catch (err) {
      console.error("[AUDIO] Error accessing default microphone:", err);
    }
  };

  // Rolling media recorder for video + audio
  const startVideoRecording = () => {
    if (!webcamRef.current || !webcamRef.current.stream) return;
    try {
      const videoStream = webcamRef.current.stream;
      const tracks = [...videoStream.getVideoTracks()];
      
      // Append microphone track if available
      if (audioStreamRef.current) {
        tracks.push(...audioStreamRef.current.getAudioTracks());
      }
      
      const combinedStream = new MediaStream(tracks);
      
      // Try preferred codecs, default fallback to browser standard
      let options = { mimeType: "video/webm;codecs=vp8,opus" };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: "video/webm" };
      }
      
      const recorder = new MediaRecorder(combinedStream, options);
      videoChunksRef.current = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          videoChunksRef.current.push(event.data);
          // Retain the last ~6-7 seconds in the rolling buffer
          if (videoChunksRef.current.length > 7) {
            videoChunksRef.current.shift();
          }
        }
      };

      recorder.start(1000); // 1-second chunks
      mediaRecorderRef.current = recorder;
      isRecordingRef.current = true;
      console.log("[RECORDER] Rolling 5-second evidence highlight capture active.");
    } catch (err) {
      console.error("[RECORDER] MediaRecorder initialization failed:", err);
    }
  };

  // Upload highlight clip REST call
  const uploadEvidenceClip = async (alertId: number) => {
    if (videoChunksRef.current.length === 0) {
      console.warn("[RECORDER] Evidence buffer is empty. Skipping upload.");
      return;
    }

    const blob = new Blob(videoChunksRef.current, { type: "video/webm" });
    const file = new File([blob], "evidence.webm", { type: "video/webm" });

    const formData = new FormData();
    formData.append("file", file);

    try {
      console.log(`[RECORDER] Uploading evidence clip for alert ${alertId}...`);
      const response = await fetch(`http://localhost:8000/session/${sessionId}/alert/${alertId}/video`, {
        method: "POST",
        body: formData
      });
      if (response.ok) {
        console.log(`[RECORDER] Evidence clip uploaded successfully.`);
      } else {
        console.error("[RECORDER] Evidence upload failed:", await response.text());
      }
    } catch (err) {
      console.error("[RECORDER] Evidence upload request crashed:", err);
    }
  };

  // Web Audio and MediaRecorder capture terminator
  const stopAudioAnalysis = () => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
      mediaRecorderRef.current = null;
    }
    isRecordingRef.current = false;
    videoChunksRef.current = [];

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioAnalyserRef.current = null;
  };

  // Callback triggered when MediaPipe Face Mesh evaluates landmarks
  const onFaceMeshResults = useCallback(async (results: any) => {
    const isStarted = sessionStartedRef.current;
    const socket = wsRef.current;
    if (!isStarted || !socket || socket.readyState !== WebSocket.OPEN) return;

    // A. Validate Face Visibility with Debouncing
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setProctorDebug((prev) => ({
        ...prev,
        faces: 0,
        wsState: socket.readyState === 1 ? "OPEN" : socket.readyState === 0 ? "CONNECTING" : "CLOSED"
      }));

      consecutiveMissingRef.current += 1;
      if (consecutiveMissingRef.current >= 3) { // 3 consecutive frames (~1s)
        console.warn("[PROCTOR] Face not visible — student left seat or camera blocked!");
        const screenshot = webcamRef.current?.getScreenshot() || null;
        socket.send(
          JSON.stringify({
            type: "anomaly",
            anomaly_type: "Camera Obstruction (Face Not Visible)",
            confidence: 1.0,
            frame: screenshot
          })
        );
        setWarnings((prev) => ["Face not visible to camera. Please look directly at the screen.", ...prev.slice(0, 4)]);
        consecutiveMissingRef.current = 0; // Reset
      }
      return;
    } else {
      consecutiveMissingRef.current = 0;
    }

    // B. Check for Multiple Persons (Class 3)
    let distinctFacesCount = 0;
    if (results.multiFaceLandmarks) {
      const distinctFaces: any[] = [];
      for (const face of results.multiFaceLandmarks) {
        const nose = face[4];
        if (!nose) continue;
        let isDuplicate = false;
        for (const existing of distinctFaces) {
          const dx = nose.x - existing.x;
          const dy = nose.y - existing.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // If the detected face is within 15% distance, it's the same face
          if (dist < 0.15) {
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) {
          distinctFaces.push(nose);
        }
      }
      distinctFacesCount = distinctFaces.length;
    }

    if (distinctFacesCount > 1) {
      consecutiveMultipleRef.current += 1;
      if (consecutiveMultipleRef.current >= 2) { // Require 2 consecutive frames (~700ms)
        console.warn("[PROCTOR] Multiple distinct faces detected in frame!");
        const screenshot = webcamRef.current?.getScreenshot() || null;
        socket.send(
          JSON.stringify({
            type: "anomaly",
            anomaly_type: "Multiple Persons Detected",
            confidence: 0.95,
            frame: screenshot
          })
        );
        setWarnings((prev) => ["Security Alert: Multiple persons detected in camera frame!", ...prev.slice(0, 4)]);
        consecutiveMultipleRef.current = 0; // Reset
      }
      return;
    } else {
      consecutiveMultipleRef.current = 0;
    }

    const landmarks = results.multiFaceLandmarks[0];

    // C. Head Pose Estimation (Yaw & Pitch)
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    const noseTip = landmarks[4];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    // Horizontal yaw ratio
    const distLeft = Math.abs(noseTip.x - leftCheek.x);
    const distRight = Math.abs(noseTip.x - rightCheek.x);
    const horizontalRatio = distLeft / (distRight + 1e-6);

    // Vertical pitch ratio
    const distUpper = Math.abs(forehead.y - noseTip.y);
    const distLower = Math.abs(chin.y - noseTip.y);
    const verticalRatio = distUpper / (distLower + 1e-6);

    let headViolation = false;
    let headLabel = "";
    let headConfidence = 0.85;

    // Debounce yaw movements (left/right) — sensitive threshold
    if (horizontalRatio < 0.68 || horizontalRatio > 1.45) {
      consecutiveCheekRef.current += 1;
      if (consecutiveCheekRef.current >= 2) { // 2 frames (~700ms)
        headViolation = true;
        headLabel = "Head turned sideways (Yaw Deviation)";
        consecutiveCheekRef.current = 0;
      }
    } else {
      consecutiveCheekRef.current = 0;
    }

    // Debounce pitch movements (up/down)
    if (verticalRatio < 0.75 || verticalRatio > 1.35) {
      consecutivePitchRef.current += 1;
      if (consecutivePitchRef.current >= 2) { // 2 frames (~700ms)
        headViolation = true;
        if (verticalRatio > 1.35) {
          // Looking down (e.g. smartphone/book usage)
          headLabel = "Suspected External Device (Looking Down)";
          headConfidence = 0.92;
        } else {
          headLabel = "Head tilted up or down (Pitch Deviation)";
        }
        consecutivePitchRef.current = 0;
      }
    } else {
      consecutivePitchRef.current = 0;
    }

    // D. Eye Gaze Iris Drift Tracking (Looking Off-Screen)
    const leftIris = landmarks[468];
    const rightIris = landmarks[473];
    const leftEyeOuter = landmarks[33];
    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    const rightEyeOuter = landmarks[263];

    const leftEyeWidth = Math.abs(leftEyeInner.x - leftEyeOuter.x);
    const leftGazeIndex = (leftIris.x - Math.min(leftEyeOuter.x, leftEyeInner.x)) / (leftEyeWidth + 1e-6);

    const rightEyeWidth = Math.abs(rightEyeOuter.x - rightEyeInner.x);
    const rightGazeIndex = (rightIris.x - Math.min(rightEyeInner.x, rightEyeOuter.x)) / (rightEyeWidth + 1e-6);

    let gazeViolation = false;
    if (leftGazeIndex < 0.32 || leftGazeIndex > 0.68 || rightGazeIndex < 0.32 || rightGazeIndex > 0.68) {
      consecutiveGazeRef.current += 1;
      if (consecutiveGazeRef.current >= 2) { // 2 frames (~700ms)
        gazeViolation = true;
        consecutiveGazeRef.current = 0;
      }
    } else {
      consecutiveGazeRef.current = 0;
    }

    // E. Visual CNN Classification (Device / Person detections)
    const video = webcamRef.current?.video;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = 224;
    canvas.height = 224;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, 224, 224);
    const imgData = ctx.getImageData(0, 0, 224, 224);
    const data = imgData.data;

    let cnnViolation = false;
    let cnnLabel = "";
    let cnnConfidence = 0.0;

    // Run CNN on every frame to be completely responsive (no motion restrictor)
    if (ortSessionRef.current) {
      const floatData = new Float32Array(3 * 224 * 224);
      const rOffset = 0;
      const gOffset = 224 * 224;
      const bOffset = 2 * 224 * 224;

      for (let i = 0; i < data.length; i += 4) {
        const pixelIdx = i / 4;
        floatData[rOffset + pixelIdx] = data[i] / 255.0;
        floatData[gOffset + pixelIdx] = data[i + 1] / 255.0;
        floatData[bOffset + pixelIdx] = data[i + 2] / 255.0;
      }

      const inputTensor = new ort.Tensor("float32", floatData, [1, 3, 224, 224]);

      try {
        const results = await ortSessionRef.current.run({ input: inputTensor });
        const outputTensor = results.output;
        const outputData = outputTensor.data as Float32Array;

        let classId = 0;
        let maxVal = -Infinity;
        for (let i = 0; i < outputData.length; i++) {
          if (outputData[i] > maxVal) {
            maxVal = outputData[i];
            classId = i;
          }
        }

        if (classId > 0) {
          // Sensor Fusion Validation: Cross-check the CNN's output against actual hardware sensors
          // (FaceMesh geometry, Audio amplitude) to prevent false positives from random weights.
          let isVerified = true;

          if (classId === 3 && distinctFacesCount <= 1) {
            // CNN thinks there are multiple people, but FaceMesh only tracks 1 face (or 0)
            isVerified = false;
          }
          if (classId === 2 && !headViolation) {
            // CNN thinks head is moving, but FaceMesh ratios are normal
            isVerified = false;
          }
          if (classId === 4 && consecutiveSpeechRef.current === 0) {
            // CNN thinks student is talking, but mic RMS / speech energy ratio is normal
            isVerified = false;
          }
          if (classId === 1 && verticalRatio <= 1.32 && leftGazeIndex >= 0.32 && rightGazeIndex >= 0.32) {
            // CNN thinks device is used, but student is looking straight at the screen
            isVerified = false;
          }

          if (isVerified) {
            cnnViolation = true;
            cnnLabel = CLASS_LABELS[classId];
            cnnConfidence = maxVal;
          }
        }
      } catch (ortErr) {
        console.error("[ort] CNN evaluate failed:", ortErr);
      }
    }

    // Update proctorDebug metrics
    setProctorDebug((prev) => ({
      ...prev,
      faces: distinctFacesCount,
      yaw: parseFloat(horizontalRatio.toFixed(2)),
      pitch: parseFloat(verticalRatio.toFixed(2)),
      gazeL: parseFloat(leftGazeIndex.toFixed(2)),
      gazeR: parseFloat(rightGazeIndex.toFixed(2)),
      wsState: socket.readyState === 1 ? "OPEN" : socket.readyState === 0 ? "CONNECTING" : "CLOSED"
    }));

    // F. Resolve Trigger Priority
    let alertType = "";
    let confidence = 0.0;

    if (cnnViolation) {
      alertType = cnnLabel;
      confidence = cnnConfidence;
    } else if (headViolation) {
      alertType = headLabel;
      confidence = headConfidence;
    } else if (gazeViolation) {
      alertType = "Gaze Deviation (Looking Off-Screen)";
      confidence = 0.80;
    }

    if (alertType && webcamRef.current) {
      const screenshot = webcamRef.current.getScreenshot();
      if (screenshot) {
        socket.send(
          JSON.stringify({
            type: "anomaly",
            anomaly_type: alertType,
            confidence: confidence,
            frame: screenshot
          })
        );
      }
    }
  }, []);

  // Handle start session API and WS setup
  const startExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim()) return;

    try {
      // Fetch dynamic questions from backend (fall back to MOCK_QUESTIONS if unavailable)
      try {
        const qRes = await fetch("http://localhost:8000/questions");
        if (qRes.ok) {
          const qData = await qRes.json();
          if (Array.isArray(qData) && qData.length > 0) {
            setQuestions(qData);
          }
        }
      } catch {
        // Backend unavailable — keep MOCK_QUESTIONS
      }

      const response = await fetch("http://localhost:8000/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId.trim() })
      });

      if (!response.ok) {
        throw new Error("Failed to start session on backend");
      }

      const data = await response.json();
      setSessionId(data.session_id);
      setSessionStarted(true);

      // Start client Web Audio analysis
      await startAudioAnalysis();
      
      // Start rolling video evidence recording once tracks are active
      setTimeout(() => {
        startVideoRecording();
      }, 1000);

      // Create WebSocket connection
      const socket = new WebSocket(`ws://localhost:8000/session/${data.session_id}/stream`);
      
      socket.onopen = () => {
        console.log("[STUDENT CLIENT] Stream WS connected.");
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "warning") {
          setWarnings((prev) => [msg.message, ...prev.slice(0, 4)]);
        } else if (msg.type === "alert_confirmation") {
          // Upload highlight clip matching this specific confirmation
          uploadEvidenceClip(msg.alert_id);
        }
      };

      setWs(socket);
    } catch (err) {
      alert("Failed to initialize session. Please check that backend is running at port 8000.");
      console.error(err);
    }
  };

  // Handle submit exam API and WS closure
  const submitExam = useCallback(async () => {
    stopAudioAnalysis();
    if (ws) {
      ws.close();
    }
    if (sessionId) {
      try {
        await fetch(`http://localhost:8000/session/${sessionId}/end`, {
          method: "POST"
        });
      } catch (err) {
        console.error("Failed to end session cleanly:", err);
      }
    }
    setSessionStarted(false);
    setExamSubmitted(true);
    // Reset motion states
    prevFrameGrayRef.current = null;
    diffHistoryRef.current = [];
  }, [ws, sessionId]);

  // Client-side video frame capture
  const captureAndEvaluate = useCallback(async () => {
    if (!webcamRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;

    const video = webcamRef.current.video;
    if (video && video.readyState === 4 && faceMeshRef.current) {
      // Send video element to MediaPipe Face Mesh. Results will trigger onFaceMeshResults.
      await faceMeshRef.current.send({ image: video });
    }
  }, [ws]);

  // Client-side audio check with debouncing
  const analyzeAudio = useCallback(() => {
    if (!audioAnalyserRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;

    const analyser = audioAnalyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    
    // RMS volume estimation
    const timeData = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(timeData);

    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      const val = (timeData[i] - 128) / 128.0;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / timeData.length);

    // Whisper/Speech threshold
    if (rms > 0.015) {
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      const sampleRate = audioContextRef.current?.sampleRate || 44100;
      const fftSize = analyser.fftSize;

      let voiceEnergy = 0;
      let totalEnergy = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const freq = (i * sampleRate) / fftSize;
        const energy = dataArray[i] * dataArray[i];
        totalEnergy += energy;
        
        if (freq >= 300 && freq <= 3000) {
          voiceEnergy += energy;
        }
      }

      const speechRatio = voiceEnergy / (totalEnergy + 1e-6);

      if (speechRatio > 0.35) {
        consecutiveSpeechRef.current += 1;
        if (consecutiveSpeechRef.current >= 1) { // 1 second is enough to flag
          console.log(`[AUDIO] Acoustic Violation flagged: Speech concentration ratio ${(speechRatio * 100).toFixed(1)}%`);
          const confidence = Math.min(0.60 + (rms - 0.015) * 4 + speechRatio * 0.2, 0.99);

          const socket = wsRef.current;
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "anomaly",
                anomaly_type: "Acoustic Violation (Speech/Whispering)",
                confidence: confidence,
                frame: null
              })
            );
          }
        }
      } else {
        consecutiveSpeechRef.current = 0;
      }
    } else {
      consecutiveSpeechRef.current = 0;
    }

    setProctorDebug((prev) => ({
      ...prev,
      rms: parseFloat(rms.toFixed(4))
    }));
  }, []);

  // Main 350ms capture loop — faster response to head/gaze violations
  useEffect(() => {
    if (!sessionStarted || !ws) return;
    const timer = setInterval(() => {
      captureAndEvaluate();
    }, 350);
    // Audio analysis at separate 1s cadence (FFT doesn't benefit from sub-second sampling)
    const audioTimer = setInterval(() => {
      analyzeAudio();
    }, 1000);

    return () => { clearInterval(timer); clearInterval(audioTimer); };
  }, [sessionStarted, ws, captureAndEvaluate, analyzeAudio]);

  // Heartbeat loop — send live camera frame to admin dashboard every 5s
  useEffect(() => {
    if (!sessionStarted || !ws) return;
    const heartbeat = setInterval(() => {
      if (webcamRef.current && ws.readyState === WebSocket.OPEN) {
        const frame = webcamRef.current.getScreenshot();
        if (frame) {
          ws.send(JSON.stringify({ type: "heartbeat", frame }));
        }
      }
    }, 5000);
    return () => clearInterval(heartbeat);
  }, [sessionStarted, ws]);

  // Countdown timer
  useEffect(() => {
    if (!sessionStarted) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          submitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionStarted, submitExam]);

  // Track tab changes and send logs
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "visibility_change",
            visible: false
          })
        );
        setWarnings((prev) => [
          "Security Warning: Leaving the exam screen is logged as a violation!",
          ...prev.slice(0, 4)
        ]);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [ws]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleSelectOption = (questionId: number, idx: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: idx }));
  };


  if (examSubmitted) {
    return (
      <div style={{ height: '100vh', background: '#F6F3EC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ width: '100%', maxWidth: 420, background: '#fff', border: '1px solid #E4DFD2', borderRadius: 12, padding: '32px 36px', textAlign: 'center' }}>
          {/* Compact wax seal */}
          <div style={{ width: 56, height: 56, margin: '0 auto 20px' }}>
            <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', overflow: 'visible' }} className="seal-animated">
              <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" fill="#8C2F39" stroke="#73222A" strokeWidth="1.5" />
              <circle cx="50" cy="50" r="33" fill="none" stroke="#B8912F" strokeWidth="1.5" />
              <text x="50" y="56" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="20" fontWeight="700" fill="#F6F3EC">EG</text>
            </svg>
          </div>
          <h1 style={{ fontFamily: "'Newsreader', serif", fontWeight: 700, fontSize: 22, margin: '0 0 8px', color: '#1C2430' }}>Exam Submitted</h1>
          <p style={{ fontSize: 12.5, color: '#5B6472', lineHeight: 1.6, margin: '0 0 20px' }}>
            Session logs recorded in the invigilator ledger.
          </p>
          <div style={{ background: '#F6F3EC', border: '1px solid #E4DFD2', borderRadius: 8, padding: '14px 16px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#5B6472', marginBottom: 20 }}>
            <div style={{ marginBottom: 4 }}><span style={{ color: '#A8A296' }}>Student:</span> {studentId}</div>
            <div style={{ marginBottom: 4 }}><span style={{ color: '#A8A296' }}>Session:</span> {sessionId.substring(0, 24)}…</div>
            <div><span style={{ color: '#A8A296' }}>Time:</span> {new Date().toLocaleTimeString()}</div>
          </div>
          <button
            onClick={() => {
              setExamSubmitted(false); setStudentId(''); setSessionId('');
              setAnswers({}); setCurrentQuestionIdx(0); setTimeLeft(2700); setWarnings([]);
            }}
            style={{ width: '100%', background: '#1E3A5F', color: '#F6F3EC', border: 'none', borderRadius: 8, padding: '12px', fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  if (!sessionStarted) {
    return (
      <div className="screen">
        {/* FORM PANEL — matches student-login.html exactly */}
        <div className="form-panel">
          <div className="brand">
            {/* Wax-seal brand mark */}
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 26, height: 26, flexShrink: 0 }}>
              <path d="M20 2 L23.5 6.5 L29 5 L29.5 10.7 L35 12.5 L32 17.5 L35 22.5 L29.5 24.3 L29 30 L23.5 28.5 L20 33 L16.5 28.5 L11 30 L10.5 24.3 L5 22.5 L8 17.5 L5 12.5 L10.5 10.7 L11 5 L16.5 6.5 Z"
                stroke="#1E3A5F" strokeWidth="1.4" fill="#F6F3EC"/>
              <text x="20" y="21.5" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="10" fontWeight="600" fill="#1E3A5F">EG</text>
            </svg>
            <span className="brand-word">EXAMGUARD AI</span>
          </div>

          <div className="form-body">
            <h1 style={{ fontFamily: "'Newsreader', serif", fontWeight: 600, fontSize: 40, lineHeight: 1.15, margin: '0 0 14px 0', letterSpacing: '-0.01em' }}>
              Enter the&nbsp;Exam&nbsp;Hall
            </h1>
            <p className="lede">
              Verify your registration credentials and confirm camera and microphone access to begin your session.
            </p>

            <form onSubmit={startExam}>
              <div className="field">
                <label htmlFor="student-id">Student registration ID</label>
                <input
                  id="student-id"
                  type="text"
                  required
                  placeholder="e.g. MITS-CS-2026-08"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                />
              </div>

              {/* Sensor readiness panel */}
              <div className="sensor-panel">
                <h4>Sensor readiness</h4>
                <div className="sensor-row">
                  <span>Local detection engine</span>
                  {modelLoading ? (
                    <span className="status" style={{ color: '#B8912F' }}>Loading…</span>
                  ) : modelReady ? (
                    <span className="status ready">Ready</span>
                  ) : (
                    <span className="status offline">Offline</span>
                  )}
                </div>
                <div className="sensor-row">
                  <span>Face tracking</span>
                  {modelLoading ? (
                    <span className="status" style={{ color: '#B8912F' }}>Loading…</span>
                  ) : faceMeshRef.current ? (
                    <span className="status ready">Connected</span>
                  ) : (
                    <span className="status offline">Disconnected</span>
                  )}
                </div>
                {modelError && (
                  <p className="sensor-note" style={{ color: '#8C2F39' }}>
                    Engine error: {modelError}. Exam will run without AI proctoring.
                  </p>
                )}
                <p className="sensor-note">
                  Analysis runs on your device. No continuous audio or video leaves your browser — only brief violation keyframes are sent for the record.
                </p>
              </div>

              <button
                type="submit"
                disabled={modelLoading}
                className="btn-primary"
              >
                {modelLoading ? 'Loading engines…' : 'Start exam'}
              </button>
            </form>
          </div>

          <div className="form-footer">Proctor Core v1.1 · Sealed Integrity</div>
        </div>

        {/* ILLUSTRATION PANEL — clock-eye SVG from student-login.html */}
        <div className="art-panel">
          <svg width="420" height="420" viewBox="0 0 420 420" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'relative', zIndex: 1 }}>
            {/* outer clock ring */}
            <circle cx="210" cy="210" r="150" stroke="#C7D4E3" strokeWidth="1" opacity="0.55"/>
            <circle cx="210" cy="210" r="128" stroke="#C7D4E3" strokeWidth="1" opacity="0.35"/>
            {/* tick marks */}
            <g stroke="#C7D4E3" strokeWidth="1.4" opacity="0.6">
              <line x1="210" y1="60" x2="210" y2="78"/>
              <line x1="210" y1="342" x2="210" y2="360"/>
              <line x1="60" y1="210" x2="78" y2="210"/>
              <line x1="342" y1="210" x2="360" y2="210"/>
              <line x1="104" y1="104" x2="117" y2="117"/>
              <line x1="303" y1="303" x2="316" y2="316"/>
              <line x1="104" y1="316" x2="117" y2="303"/>
              <line x1="303" y1="117" x2="316" y2="104"/>
            </g>
            {/* eye shape replacing clock hands */}
            <path d="M110 210 Q210 150 310 210 Q210 270 110 210 Z" stroke="#D9B65B" strokeWidth="1.6" fill="none"/>
            <circle cx="210" cy="210" r="34" stroke="#D9B65B" strokeWidth="1.6" fill="none"/>
            <circle cx="210" cy="210" r="10" fill="#D9B65B"/>
            {/* lash-like tick accents on the eye */}
            <g stroke="#D9B65B" strokeWidth="1.2" opacity="0.7">
              <line x1="150" y1="188" x2="142" y2="178"/>
              <line x1="270" y1="188" x2="278" y2="178"/>
              <line x1="130" y1="205" x2="120" y2="200"/>
              <line x1="290" y1="205" x2="300" y2="200"/>
            </g>
          </svg>

          <div className="art-caption">
            <strong>One seal. Every session.</strong>
            Local, on-device monitoring verifies your session without watching more than it needs to.
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIdx];

  return (
    <div style={{ height: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif", color: 'var(--ink)', overflow: 'hidden' }}>
      {/* FULLSCREEN VIOLATION BANNER — prominent, cannot be missed */}
      {warnings.length > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(140, 47, 57, 0.92)',
          backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Inter', sans-serif",
          animation: 'violation-in 0.2s ease-out forwards'
        }}>
          {/* Pulse ring */}
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 24,
            animation: 'pulse-ring 1.4s ease-out infinite'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.6)', marginBottom: 12
          }}>
            Exam Integrity Violation
          </div>

          <div style={{
            fontSize: 20, fontWeight: 700, color: '#fff',
            textAlign: 'center', maxWidth: 480, lineHeight: 1.4,
            marginBottom: 8, padding: '0 32px'
          }}>
            {warnings[0].replace(/Security Warning:\s*/i, '').replace(/!+$/, '')}
          </div>

          {warnings.length > 1 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 24 }}>
              +{warnings.length - 1} additional incident{warnings.length > 2 ? 's' : ''} recorded
            </div>
          )}

          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 32, textAlign: 'center' }}>
            This violation has been logged and sent to your invigilator.
          </div>

          <button
            onClick={() => setWarnings([])}
            style={{
              background: '#fff', color: '#8C2F39',
              border: 'none', borderRadius: 8,
              padding: '12px 36px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.02em',
              fontFamily: "'Inter', sans-serif"
            }}
          >
            I understand — Return to exam
          </button>
        </div>
      )}

      {/* HEADER */}
      <header>
        <div className="brand">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 20, height: 20, flexShrink: 0 }}>
            <path d="M20 2 L23.5 6.5 L29 5 L29.5 10.7 L35 12.5 L32 17.5 L35 22.5 L29.5 24.3 L29 30 L23.5 28.5 L20 33 L16.5 28.5 L11 30 L10.5 24.3 L5 22.5 L8 17.5 L5 12.5 L10.5 10.7 L11 5 L16.5 6.5 Z"
              stroke="#1E3A5F" strokeWidth="1.4" fill="#F6F3EC"/>
            <text x="20" y="21.5" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="10" fontWeight="600" fill="#1E3A5F">EG</text>
          </svg>
          <span className="brand-word">EXAMGUARD</span>
        </div>
        <div className="header-right">
          <div className="timer">
            <span>⏱</span> {formatTime(timeLeft)}
          </div>
          <div className="student-tag">{studentId}</div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main>
        {/* QUESTION CARD */}
        <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="card">
            <div className="q-meta">
              <span>Question {currentQuestionIdx + 1} of {questions.length}</span>
              <span>General Knowledge Section</span>
            </div>
            <p className="q-text">{currentQuestion.text}</p>

            <div>
              {currentQuestion.options.map((opt, idx) => {
                const isSelected = answers[currentQuestion.id] === idx;
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectOption(currentQuestion.id, idx)}
                    className={`option ${isSelected ? "selected" : ""}`}
                  >
                    <span className="dot"></span>
                    {opt}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="nav-row">
            <button
              onClick={() => setCurrentQuestionIdx((prev) => Math.max(0, prev - 1))}
              disabled={currentQuestionIdx === 0}
              className="btn btn-ghost"
            >
              Previous
            </button>

            {currentQuestionIdx < questions.length - 1 ? (
              <button
                onClick={() => setCurrentQuestionIdx((prev) => prev + 1)}
                className="btn btn-primary-exam"
              >
                Next question
              </button>
            ) : (
              <button
                onClick={submitExam}
                className="btn btn-submit-exam"
              >
                Submit exam
              </button>
            )}
          </div>
        </div>

        {/* SIDE COLUMN */}
        <div className="side-stack">
          {/* Hidden Webcam — needed for MediaPipe and ONNX processing but not shown to student */}
          <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{ width: 320, height: 240, facingMode: "user" }}
            />
          </div>

          {/* Compact camera status strip */}
          <div className="card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--verdigris)', display: 'inline-block' }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-soft)' }}>Camera active</span>
              </div>
              <button
                onClick={() => setShowFeed((v) => !v)}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--oxford)', background: 'none', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
              >
                {showFeed ? 'Hide' : 'Show feed'}
              </button>
            </div>
            {showFeed && (
              <div style={{ marginTop: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
                <Webcam
                  audio={false}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ width: 240, height: 180, facingMode: "user" }}
                  style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
                />
              </div>
            )}
          </div>

          {/* Ledger metrics */}
          <div className="card">
            <div className="panel-title"><span>Ledger metrics</span></div>
            <div className="ledger-rows" style={{ marginBottom: 12 }}>
              <div className="row"><span>Status</span><span className="val status-active">Active</span></div>
              <div className="row"><span>Websocket</span><span className="val" style={{ color: proctorDebug.wsState === 'OPEN' ? 'var(--verdigris)' : 'var(--seal)' }}>{proctorDebug.wsState}</span></div>
              <div className="row"><span>Audio</span><span className="val">FFT filter</span></div>
              <div className="row"><span>Vision</span><span className="val">ONNX + FaceMesh</span></div>
            </div>

            {/* Live telemetry diagnostic info */}
            <div style={{
              borderTop: '1px solid var(--line)',
              paddingTop: 12,
              marginTop: 12,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '9.5px',
              color: 'var(--ink-soft)'
            }}>
              <div style={{ textTransform: 'uppercase', fontSize: 8, letterSpacing: '0.08em', color: 'var(--gold)', fontWeight: 600, marginBottom: 8 }}>
                Live Proctoring Telemetry
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Faces Tracked</span>
                  <strong style={{ color: proctorDebug.faces === 1 ? 'var(--ink)' : 'var(--seal)' }}>{proctorDebug.faces}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Head Yaw Ratio</span>
                  <span style={{ color: (proctorDebug.yaw < 0.68 || proctorDebug.yaw > 1.45) ? 'var(--seal)' : 'var(--ink)' }}>{proctorDebug.yaw}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Head Pitch Ratio</span>
                  <span style={{ color: (proctorDebug.pitch < 0.75 || proctorDebug.pitch > 1.35) ? 'var(--seal)' : 'var(--ink)' }}>{proctorDebug.pitch}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Gaze L / R</span>
                  <span style={{ color: (proctorDebug.gazeL < 0.32 || proctorDebug.gazeL > 0.68) ? 'var(--seal)' : 'var(--ink)' }}>
                    {proctorDebug.gazeL} / {proctorDebug.gazeR}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Mic RMS Level</span>
                  <span style={{ color: proctorDebug.rms > 0.015 ? 'var(--seal)' : 'var(--ink)' }}>{proctorDebug.rms}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
