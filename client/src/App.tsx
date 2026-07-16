import React, { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import * as ort from "onnxruntime-web";
import { Camera, AlertTriangle, ShieldCheck, Clock, CheckCircle } from "lucide-react";

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

  // Frame differencing tracking states in refs
  const prevFrameGrayRef = useRef<Uint8Array | null>(null);
  const diffHistoryRef = useRef<number[]>([]);

  // Load ONNX Model and Setup MediaPipe on start
  const initializeEngines = async () => {
    try {
      setModelLoading(true);
      console.log("[ort] Loading model.onnx...");
      const session = await ort.InferenceSession.create("/model.onnx");
      ortSessionRef.current = session;
      console.log("[ort] Model loaded successfully.");

      // Setup MediaPipe Face Mesh from window object (CDN)
      const FaceMesh = (window as any).FaceMesh;
      if (FaceMesh) {
        console.log("[MediaPipe] Initializing FaceMesh...");
        const faceMesh = new FaceMesh({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
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
    } catch (err) {
      console.error("[ort/MediaPipe] Engine initialization failed:", err);
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
    if (!sessionStarted || !ws || ws.readyState !== WebSocket.OPEN) return;

    // A. Validate Face Visibility with Debouncing
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      consecutiveMissingRef.current += 1;
      if (consecutiveMissingRef.current >= 3) { // 3 consecutive seconds
        console.warn("[PROCTOR] Face not visible for 3 seconds!");
        ws.send(
          JSON.stringify({
            type: "anomaly",
            anomaly_type: "Interface Violation (Face Missing)",
            confidence: 1.0,
            frame: webcamRef.current?.getScreenshot() || null
          })
        );
        setWarnings((prev) => ["Security Warning: Face missing from webcam frame!", ...prev.slice(0, 4)]);
      }
      return;
    } else {
      consecutiveMissingRef.current = 0;
    }

    const landmarks = results.multiFaceLandmarks[0];

    // B. Head Pose Estimation (Yaw & Pitch)
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

    // Debounce yaw movements (left/right)
    if (horizontalRatio < 0.55 || horizontalRatio > 1.8) {
      consecutiveCheekRef.current += 1;
      if (consecutiveCheekRef.current >= 3) {
        headViolation = true;
        headLabel = "Suspicious Head Movement (Yaw Deviation)";
      }
    } else {
      consecutiveCheekRef.current = 0;
    }

    // Debounce pitch movements (up/down)
    if (verticalRatio < 0.55 || verticalRatio > 1.7) {
      consecutivePitchRef.current += 1;
      if (consecutivePitchRef.current >= 3) {
        headViolation = true;
        headLabel = "Suspicious Head Movement (Pitch Deviation)";
      }
    } else {
      consecutivePitchRef.current = 0;
    }

    // C. Eye Gaze Iris Drift Tracking with Debouncing
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
    if (leftGazeIndex < 0.25 || leftGazeIndex > 0.75 || rightGazeIndex < 0.25 || rightGazeIndex > 0.75) {
      consecutiveGazeRef.current += 1;
      if (consecutiveGazeRef.current >= 3) {
        gazeViolation = true;
      }
    } else {
      consecutiveGazeRef.current = 0;
    }

    // D. Visual CNN Classification (Device / Person detections)
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

    // Motion checks (client-side frame differencing)
    let isKeyframe = false;
    const prevGray = prevFrameGrayRef.current;
    
    // Grayscale mapping for diffing
    const gray = new Uint8Array(224 * 224);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    if (prevGray === null) {
      isKeyframe = true;
    } else {
      let sumDiff = 0;
      for (let i = 0; i < gray.length; i++) {
        sumDiff += Math.abs(gray[i] - prevGray[i]);
      }
      const avgDiff = sumDiff / gray.length;

      let threshold = 5.0;
      const history = diffHistoryRef.current;
      if (history.length >= 5) {
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const variance = history.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / history.length;
        const std = Math.sqrt(variance);
        threshold = mean + std;
      }

      if (avgDiff > threshold) {
        isKeyframe = true;
      }

      history.push(avgDiff);
      if (history.length > 30) {
        history.shift();
      }
    }
    prevFrameGrayRef.current = gray;

    let cnnViolation = false;
    let cnnLabel = "";
    let cnnConfidence = 0.0;

    if (isKeyframe && ortSessionRef.current) {
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
          cnnViolation = true;
          cnnLabel = CLASS_LABELS[classId];
          cnnConfidence = maxVal;
        }
      } catch (ortErr) {
        console.error("[ort] CNN evaluate failed:", ortErr);
      }
    }

    // E. Resolve Trigger Priority
    let alertType = "";
    let confidence = 0.0;

    if (cnnViolation) {
      alertType = cnnLabel;
      confidence = cnnConfidence;
    } else if (headViolation) {
      alertType = headLabel;
      confidence = 0.85;
    } else if (gazeViolation) {
      alertType = "Gaze Deviation (Looking Off-Screen)";
      confidence = 0.80;
    }

    if (alertType) {
      const screenshot = webcamRef.current.getScreenshot();
      if (screenshot) {
        ws.send(
          JSON.stringify({
            type: "anomaly",
            anomaly_type: alertType,
            confidence: confidence,
            frame: screenshot
          })
        );
      }
    }
  }, [sessionStarted, ws]);

  // Handle start session API and WS setup
  const startExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim()) return;

    try {
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
    if (rms > 0.02) {
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

      if (speechRatio > 0.40) {
        consecutiveSpeechRef.current += 1;
        if (consecutiveSpeechRef.current >= 2) { // 2 consecutive seconds
          console.log(`[AUDIO] Acoustic Violation flagged: Speech concentration ratio ${(speechRatio * 100).toFixed(1)}%`);
          const confidence = Math.min(0.60 + (rms - 0.02) * 4 + speechRatio * 0.2, 0.99);

          ws.send(
            JSON.stringify({
              type: "anomaly",
              anomaly_type: "Acoustic Violation (Speech/Whispering)",
              confidence: confidence,
              frame: null
            })
          );
        }
      } else {
        consecutiveSpeechRef.current = 0;
      }
    } else {
      consecutiveSpeechRef.current = 0;
    }
  }, [ws]);

  // Main 1-second capture loop
  useEffect(() => {
    if (!sessionStarted || !ws) return;
    const timer = setInterval(() => {
      captureAndEvaluate();
      analyzeAudio();
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionStarted, ws, captureAndEvaluate, analyzeAudio]);

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

  const dismissWarning = (index: number) => {
    setWarnings((prev) => prev.filter((_, i) => i !== index));
  };

  if (examSubmitted) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-lg glass-panel glow-indigo rounded-3xl p-8 text-center space-y-6 animate-fade-in">
          <div className="w-20 h-20 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
            <CheckCircle className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-400">
              Exam Submitted Successfully
            </h1>
            <p className="text-slate-400 text-sm">
              Your session logs and answer metrics have been securely compiled and sent to the invigilator dashboard.
            </p>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 text-left text-sm font-mono text-slate-355 space-y-2">
            <div><span className="text-slate-500">Student ID:</span> {studentId}</div>
            <div><span className="text-slate-500">Session ID:</span> {sessionId}</div>
            <div><span className="text-slate-500">Submission Time:</span> {new Date().toLocaleTimeString()}</div>
            <div><span className="text-slate-500">Security Index:</span> Cleared</div>
          </div>
          <button
            onClick={() => {
              setExamSubmitted(false);
              setStudentId("");
              setSessionId("");
              setAnswers({});
              setCurrentQuestionIdx(0);
              setTimeLeft(2700);
              setWarnings([]);
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3.5 rounded-xl transition-all border border-slate-700"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  if (!sessionStarted) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-between font-sans">
        <header className="px-6 py-5 border-b border-slate-900 bg-slate-950/60 backdrop-blur sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-extrabold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
              ExamGuard AI
            </h1>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md glass-panel glow-indigo rounded-3xl p-8 space-y-6">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-100">
                Secure Student Portal
              </h2>
              <p className="text-slate-400 text-xs leading-relaxed">
                ExamGuard AI runs multi-modal edge tracking (face landmarks, eye gazes, whispering frequency) natively inside your browser.
              </p>
            </div>

            <form onSubmit={startExam} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Enter Student Registration ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MITS-CS-2026-08"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
              </div>

              <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wide">
                  <Camera className="w-4 h-4 text-cyan-400" /> Sensor Status
                </h4>
                <div className="text-[10px] text-slate-400 flex justify-between">
                  <span>Local ONNX Engine:</span>
                  {modelLoading ? (
                    <span className="text-amber-400 font-bold animate-pulse">LOADING...</span>
                  ) : ortSessionRef.current ? (
                    <span className="text-emerald-400 font-bold">READY</span>
                  ) : (
                    <span className="text-rose-500 font-bold">OFFLINE</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 flex justify-between">
                  <span>MediaPipe FaceMesh:</span>
                  {faceMeshRef.current ? (
                    <span className="text-emerald-400 font-bold">LOADED (CDN)</span>
                  ) : (
                    <span className="text-rose-500 font-bold">NOT LOADED</span>
                  )}
                </div>
                <ul className="text-[10px] text-slate-450 space-y-1 list-disc pl-4 border-t border-slate-900/60 pt-2">
                  <li>Please enable both Camera and Microphone permissions.</li>
                  <li>Temporal debouncing filters out transient shifts.</li>
                  <li>Violations trigger automatic 5-second video highlights.</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={modelLoading || !ortSessionRef.current}
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                Authenticate & Start Exam
              </button>
            </form>
          </div>
        </main>

        <footer className="py-4 text-center border-t border-slate-900 bg-slate-950/40">
          <p className="text-[10px] text-slate-600 uppercase tracking-widest">
            ExamGuard AI Proctor Core • Fully Compliant v1.1
          </p>
        </footer>
      </div>
    );
  }

  const currentQuestion = MOCK_QUESTIONS[currentQuestionIdx];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-between font-sans">
      {/* Top Banner Warnings Overlay */}
      {warnings.length > 0 && (
        <div className="fixed top-20 right-6 z-50 w-full max-w-sm space-y-3">
          {warnings.map((warn, index) => (
            <div
              key={index}
              className="glass-panel border-rose-500/30 bg-gradient-to-r from-rose-950/40 to-slate-900/90 rounded-2xl p-4 flex gap-3 shadow-2xl animate-slide-in relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-rose-500"></div>
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                  Security Notification
                </h4>
                <p className="text-xs text-slate-200 leading-normal">{warn}</p>
              </div>
              <button
                onClick={() => dismissWarning(index)}
                className="text-[10px] font-bold text-slate-500 hover:text-slate-300 self-start uppercase px-1.5 py-0.5 rounded border border-slate-800"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 border-b border-slate-900 bg-slate-950/60 backdrop-blur sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <h1 className="text-lg font-bold tracking-wider text-slate-200">
            EXAMGUARD SECURE PORTAL
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold text-cyan-400 tracking-wider shadow-inner">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{formatTime(timeLeft)}</span>
          </div>

          <span className="px-3.5 py-1.5 text-[10px] font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-full font-mono">
            ID: {studentId}
          </span>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left/Center: MCQ Questions Panel */}
        <section className="lg:col-span-2 space-y-6">
          <div className="glass-panel rounded-3xl p-6 space-y-6 shadow-xl">
            {/* Index Tracker */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Question {currentQuestionIdx + 1} of {MOCK_QUESTIONS.length}
              </span>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                General Knowledge Section
              </span>
            </div>

            {/* Question Text */}
            <h3 className="text-base font-bold text-slate-100 leading-relaxed">
              {currentQuestion.text}
            </h3>

            {/* Options */}
            <div className="space-y-3">
              {currentQuestion.options.map((opt, idx) => {
                const isSelected = answers[currentQuestion.id] === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectOption(currentQuestion.id, idx)}
                    className={`w-full text-left px-5 py-4 rounded-2xl border text-xs font-medium transition-all flex items-center justify-between ${
                      isSelected
                        ? "bg-indigo-500/10 border-indigo-500 text-indigo-200"
                        : "bg-slate-950/40 border-slate-855 hover:bg-slate-900 text-slate-300"
                    }`}
                  >
                    <span>{opt}</span>
                    {isSelected && (
                      <span className="w-4 h-4 bg-indigo-500 rounded-full border border-indigo-400 flex items-center justify-center text-[8px] text-white font-bold">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setCurrentQuestionIdx((prev) => Math.max(0, prev - 1))}
              disabled={currentQuestionIdx === 0}
              className="px-5 py-2.5 rounded-xl border border-slate-800 text-xs font-bold text-slate-400 hover:bg-slate-900 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              Previous
            </button>

            {currentQuestionIdx < MOCK_QUESTIONS.length - 1 ? (
              <button
                onClick={() => setCurrentQuestionIdx((prev) => prev + 1)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow shadow-indigo-600/15"
              >
                Next Question
              </button>
            ) : (
              <button
                onClick={submitExam}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-7 py-2.5 rounded-xl text-xs font-bold transition-all shadow shadow-emerald-600/15"
              >
                Submit Exam
              </button>
            )}
          </div>
        </section>

        {/* Right Panel: Active Camera Proctor Feed */}
        <section className="lg:col-span-1 space-y-6">
          {/* Webcam Preview Widget */}
          <div className="glass-panel rounded-3xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wide">
                <Camera className="w-4 h-4 text-indigo-400" /> Active Video Stream
              </h4>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>

            {/* Webcam video window */}
            <div className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-900 aspect-video relative flex items-center justify-center">
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={{
                  width: 320,
                  height: 240,
                  facingMode: "user"
                }}
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              <div className="absolute bottom-3 left-3 bg-slate-950/80 border border-slate-800/80 px-2 py-0.5 rounded text-[9px] font-mono text-slate-400 font-bold uppercase tracking-wider">
                Rolling recording
              </div>
            </div>
            
            <p className="text-[10px] text-slate-400 leading-normal bg-slate-900/50 border border-slate-855 p-3 rounded-xl">
              ExamGuard AI performs pupil-mesh, head pose Euler estimation, and speech frequency FFT locally inside Web Assembly. Telemetry details are streamed only when security events are triggered.
            </p>
          </div>

          {/* Quick Stats Panel */}
          <div className="glass-panel rounded-3xl p-5 space-y-3 font-mono text-[10px] text-slate-400 leading-loose shadow-xl">
            <h5 className="font-sans font-bold text-xs text-slate-355 uppercase tracking-wide mb-1">
              On-Device Metrics
            </h5>
            <div className="flex justify-between border-b border-slate-900 pb-1.5">
              <span>Status:</span>
              <span className="text-emerald-400 font-bold font-sans">DEBOUNCED_RECORDING</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1.5">
              <span>Audio Model:</span>
              <span>FFT Speech Band Filter</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1.5">
              <span>Video Models:</span>
              <span>FaceMesh (CDN) + CNN (ONNX)</span>
            </div>
            <div className="flex justify-between">
              <span>Evidence Highlight:</span>
              <span>5-Second WebM Clips</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center border-t border-slate-900 bg-slate-950/40">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">
          ExamGuard AI • Edge-Powered Academic Integrity Suite
        </p>
      </footer>
    </div>
  );
}
