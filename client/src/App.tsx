import React, { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import * as ort from "onnxruntime-web";
import { AlertTriangle, Clock } from "lucide-react";

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

    if (alertType && webcamRef.current && ws && ws.readyState === WebSocket.OPEN) {
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
      <div className="min-h-screen bg-[#F6F3EC] flex items-center justify-center p-6 font-sans text-[#1C2430]">
        <div className="w-full max-w-md bg-white border border-[#1C2430]/10 rounded-lg p-8 text-center space-y-6 shadow-sm">
          {/* Animated Wax-Seal Stamp */}
          <div className="w-24 h-24 mx-auto relative">
            <svg viewBox="0 0 100 100" className="w-full h-full seal-animated">
              <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-[#8C2F39] stroke-[#73222A] stroke-[1.5]" />
              <circle cx="50" cy="50" r="33" className="fill-none stroke-[#B8912F] stroke-[1.5] stroke-dasharray-[1, 1]" />
              <circle cx="50" cy="50" r="31" className="fill-none stroke-[#B8912F] stroke-[0.75]" />
              <text x="50" y="58" className="font-serif text-2xl font-bold fill-[#F6F3EC]" textAnchor="middle">EG</text>
              <path id="seal-text-path-sub" d="M 22 50 A 28 28 0 1 1 78 50" className="fill-none stroke-none" />
              <text className="font-sans text-[6px] fill-[#B8912F] tracking-[0.2em] font-semibold">
                <textPath href="#seal-text-path-sub" startOffset="50%" textAnchor="middle">
                  EXAMGUARD • VERIFIED
                </textPath>
              </text>
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-serif font-bold text-[#1C2430]">
              Exam Submitted
            </h1>
            <p className="text-slate-500 text-xs">
              Your session logs and answer metrics have been securely compiled and recorded in the invigilator ledger.
            </p>
          </div>
          <div className="bg-[#F6F3EC]/80 border border-[#1C2430]/10 rounded-lg p-5 text-left text-xs font-mono text-slate-700 space-y-2">
            <div><span className="text-slate-400">Student ID:</span> {studentId}</div>
            <div><span className="text-slate-400">Session ID:</span> {sessionId}</div>
            <div><span className="text-slate-400">Submission Time:</span> {new Date().toLocaleTimeString()}</div>
            <div><span className="text-slate-400">Security Index:</span> Cleared</div>
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
            className="w-full bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white font-medium py-3 rounded-lg transition-all text-xs focus-oxford"
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

  const currentQuestion = MOCK_QUESTIONS[currentQuestionIdx];

  return (
    <div className="min-h-screen bg-[#F6F3EC] flex flex-col justify-between font-sans text-[#1C2430]">
      {/* Top Banner Warnings Overlay */}
      {warnings.length > 0 && (
        <div className="fixed top-20 right-6 z-50 w-full max-w-sm space-y-3 print-hidden">
          {warnings.map((warn, index) => (
            <div
              key={index}
              className="bg-white border border-[#1C2430]/10 rounded p-4 flex gap-3 shadow-md relative overflow-hidden animate-slide-in"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-[#8C2F39]"></div>
              <AlertTriangle className="w-4 h-4 text-[#8C2F39] shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <h4 className="text-[10px] font-bold text-[#8C2F39] uppercase tracking-wider">
                  System Notification
                </h4>
                <p className="text-xs text-slate-700 leading-normal">{warn}</p>
              </div>
              <button
                onClick={() => dismissWarning(index)}
                className="text-[9px] font-bold text-slate-400 hover:text-slate-600 self-start uppercase px-1.5 py-0.5 rounded border border-slate-200"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 border-b border-[#1C2430]/10 bg-white sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 22, height: 22, flexShrink: 0 }}>
            <path d="M20 2 L23.5 6.5 L29 5 L29.5 10.7 L35 12.5 L32 17.5 L35 22.5 L29.5 24.3 L29 30 L23.5 28.5 L20 33 L16.5 28.5 L11 30 L10.5 24.3 L5 22.5 L8 17.5 L5 12.5 L10.5 10.7 L11 5 L16.5 6.5 Z"
              stroke="#1E3A5F" strokeWidth="1.4" fill="#F6F3EC"/>
            <text x="20" y="21.5" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="10" fontWeight="600" fill="#1E3A5F">EG</text>
          </svg>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '0.14em', color: '#5B6472', fontWeight: 500 }}>
            EXAMGUARD SECURE PORTAL
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-[#F6F3EC] border border-[#1C2430]/10 px-3.5 py-1.5 rounded text-xs font-mono font-bold text-[#1E3A5F] tracking-wider">
            <Clock className="w-3.5 h-3.5 text-[#1E3A5F]" />
            <span>{formatTime(timeLeft)}</span>
          </div>

          <span className="text-[10px] font-bold font-mono text-slate-550">
            Student: {studentId}
          </span>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left/Center: MCQ Questions Panel */}
        <section className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-[#1C2430]/10 rounded-lg p-6 space-y-6 shadow-sm">
            {/* Index Tracker */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                Question {currentQuestionIdx + 1} of {MOCK_QUESTIONS.length}
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                General Knowledge Section
              </span>
            </div>

            {/* Question Text */}
            <h3 className="text-lg font-serif font-bold text-[#1C2430] leading-relaxed">
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
                    className={`w-full text-left px-5 py-4 rounded border text-xs font-medium transition-all flex items-center justify-between ${
                      isSelected
                        ? "bg-[#1E3A5F]/5 border-[#1E3A5F] text-[#1E3A5F]"
                        : "bg-white border-[#1C2430]/10 hover:bg-[#F6F3EC]/50 text-slate-700"
                    }`}
                  >
                    <span>{opt}</span>
                    <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected ? "border-[#1E3A5F]" : "border-[#1C2430]/20"
                    }`}>
                      {isSelected && <span className="w-1.5 h-1.5 bg-[#1E3A5F] rounded-full" />}
                    </span>
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
              className="px-5 py-2 rounded border border-[#1C2430]/15 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-oxford"
            >
              Previous
            </button>

            {currentQuestionIdx < MOCK_QUESTIONS.length - 1 ? (
              <button
                onClick={() => setCurrentQuestionIdx((prev) => prev + 1)}
                className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white px-6 py-2 rounded text-xs font-semibold transition-all focus-oxford"
              >
                Next Question
              </button>
            ) : (
              <button
                onClick={submitExam}
                className="bg-[#4B7A6B] hover:bg-[#4B7A6B]/90 text-white px-7 py-2 rounded text-xs font-semibold transition-all focus-oxford"
              >
                Submit Exam
              </button>
            )}
          </div>
        </section>

        {/* Right Panel: Active Camera Proctor Feed */}
        <section className="lg:col-span-1 space-y-6">
          {/* Webcam Preview Widget */}
          <div className="bg-white border border-[#1C2430]/10 rounded-lg p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-xs font-bold text-[#1C2430]/80 uppercase tracking-wider flex items-center gap-1.5">
                Webcam Feed
              </h4>
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-[#8C2F39] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8C2F39]"></span>
                RECORDING
              </div>
            </div>

            {/* Webcam video window - passport framed style */}
            <div className="bg-slate-100 rounded border border-[#1C2430]/10 overflow-hidden aspect-[4/3] max-w-[200px] mx-auto relative flex items-center justify-center">
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
            </div>
            
            <p className="text-[10px] text-slate-500 leading-relaxed font-sans bg-[#F6F3EC]/50 p-3 rounded border border-[#1C2430]/5">
              This exam is verified on the local client ledger. AI evaluations (yaw/pitch angles, speech spectrogram ratio) are executed in real time in-browser.
            </p>
          </div>

          {/* Quick Stats Panel */}
          <div className="bg-white border border-[#1C2430]/10 rounded-lg p-5 space-y-3 font-mono text-[10px] text-slate-500 leading-loose shadow-sm">
            <h5 className="font-sans font-bold text-xs text-[#1C2430]/80 uppercase tracking-wider mb-1">
              Ledger Metrics
            </h5>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span>Status:</span>
              <span className="text-[#4B7A6B] font-bold font-sans">INVIGILATION_ACTIVE</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span>Acoustic Engine:</span>
              <span>FFT Filter</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span>Vision Engine:</span>
              <span>ONNX + FaceMesh</span>
            </div>
            <div className="flex justify-between">
              <span>Evidence Highlight:</span>
              <span>Rolling WebM</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center border-t border-[#1C2430]/10 bg-white">
        <p className="text-[9px] text-[#1C2430]/40 font-mono uppercase tracking-widest">
          ExamGuard AI • Ledgers of Academic Integrity
        </p>
      </footer>
    </div>
  );
}
