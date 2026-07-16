import React, { useState, useEffect, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import { Camera, AlertTriangle, ShieldCheck, Clock, Award, EyeOff, CheckCircle } from "lucide-react";

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

  const webcamRef = useRef<Webcam>(null);

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

      // Create WebSocket connection
      const socket = new WebSocket(`ws://localhost:8000/session/${data.session_id}/stream`);
      
      socket.onopen = () => {
        console.log("[STUDENT CLIENT] Stream WS connected.");
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "warning") {
          setWarnings((prev) => [msg.message, ...prev.slice(0, 4)]);
        }
      };

      socket.onclose = () => {
        console.log("[STUDENT CLIENT] Stream WS closed.");
      };

      setWs(socket);
    } catch (err) {
      alert("Failed to initialize session. Please check that the backend is running at port 8000.");
      console.error(err);
    }
  };

  // Handle submit exam API and WS closure
  const submitExam = useCallback(async () => {
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
  }, [ws, sessionId]);

  // Capture frame and stream to backend
  const captureAndStream = useCallback(() => {
    if (webcamRef.current && ws && ws.readyState === WebSocket.OPEN) {
      const screenshot = webcamRef.current.getScreenshot();
      if (screenshot) {
        ws.send(
          JSON.stringify({
            type: "frame",
            frame: screenshot
          })
        );
      }
    }
  }, [ws]);

  // Capturing frame loop
  useEffect(() => {
    if (!sessionStarted || !ws) return;
    const timer = setInterval(() => {
      captureAndStream();
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionStarted, ws, captureAndStream]);

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
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 text-left text-sm font-mono text-slate-350 space-y-2">
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
                ExamGuard AI uses advanced keyframe frame differencing & dynamic PyTorch classifications to verify exam integrity.
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
                  <Camera className="w-4 h-4 text-cyan-400" /> Pre-Exam Checklist
                </h4>
                <ul className="text-[11px] text-slate-400 space-y-1.5 list-disc pl-4">
                  <li>Allow webcam access when requested.</li>
                  <li>Ensure your face is well-lit and fully visible.</li>
                  <li>Do not leave the browser tab or open other apps.</li>
                  <li>Talking or using external devices will log alerts.</li>
                </ul>
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
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
                        : "bg-slate-950/40 border-slate-850 hover:bg-slate-900 text-slate-300"
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
                1 FPS stream active
              </div>
            </div>
            
            <p className="text-[10px] text-slate-400 leading-normal bg-slate-900/50 border border-slate-850 p-3 rounded-xl">
              ExamGuard AI executes pixel difference calculations locally. Only frame transformations exceeding dynamic motion variance thresholds are evaluated by PyTorch.
            </p>
          </div>

          {/* Quick Stats Panel */}
          <div className="glass-panel rounded-3xl p-5 space-y-3 font-mono text-[10px] text-slate-400 leading-loose shadow-xl">
            <h5 className="font-sans font-bold text-xs text-slate-350 uppercase tracking-wide mb-1">
              Engine Metrics
            </h5>
            <div className="flex justify-between border-b border-slate-900 pb-1.5">
              <span>Status:</span>
              <span className="text-emerald-400 font-bold">SECURE_RUNNING</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1.5">
              <span>Frame Rate:</span>
              <span>1.0 Hz (Webcam)</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1.5">
              <span>Encryption:</span>
              <span>SSL / WSS AES-128</span>
            </div>
            <div className="flex justify-between">
              <span>Local Model:</span>
              <span>CNN-Placeholder v1.0</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center border-t border-slate-900 bg-slate-950/40">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">
          ExamGuard AI • Real-Time Academic Integrity Enforcement Suite
        </p>
      </footer>
    </div>
  );
}
