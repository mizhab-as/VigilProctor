import React, { useState, useEffect, useRef } from "react";
import { 
  ShieldAlert, Users, Bell, FileText, CheckCircle2, AlertTriangle, 
  XOctagon, Clock, LogIn, ChevronRight, Download, BarChart2 
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from "recharts";

interface ActiveSession {
  session_id: string;
  student_id: string;
  start_time: string;
  alert_count: number;
  status_color: "green" | "yellow" | "red";
}

interface AlertPayload {
  id: number;
  session_id: string;
  student_id: string;
  anomaly_type: string;
  confidence: number;
  timestamp: string;
  thumbnail_path: string | null;
  frame_path: string | null;
  video_clip_path?: string | null;
  override_status?: string;
}

interface HistoricalReport {
  session_id: string;
  student_id: string;
  start_time: string;
  end_time: string | null;
  status: string;
  total_alerts: number;
  alerts: Array<{
    id: number;
    timestamp: string;
    anomaly_type: string;
    confidence: number;
    frame_path: string | null;
    thumbnail_path: string | null;
    video_clip_path: string | null;
    override_status: string;
  }>;
  timeline_chart: Array<{
    elapsed_seconds: number;
    anomaly_type: string;
    confidence: number;
  }>;
}

interface BenchmarkModel {
  name: string;
  precision: number;
  recall: number;
  map: number;
  params: string;
  latency: number;
  color: string;
  prPoints: Array<{ r: number; p: number }>;
  confusion: number[][];
}

const BENCHMARK_MODELS: BenchmarkModel[] = [
  {
    name: "Custom CNN (Baseline)",
    precision: 88.4,
    recall: 85.2,
    map: 87.0,
    params: "0.5M",
    latency: 8,
    color: "#f43f5e",
    prPoints: [
      { r: 0.0, p: 1.0 },
      { r: 0.2, p: 0.95 },
      { r: 0.4, p: 0.92 },
      { r: 0.6, p: 0.88 },
      { r: 0.8, p: 0.80 },
      { r: 0.9, p: 0.65 },
      { r: 1.0, p: 0.40 }
    ],
    confusion: [
      [90, 3, 4, 1, 2],
      [5, 86, 2, 4, 3],
      [6, 3, 85, 2, 4],
      [4, 2, 3, 88, 3],
      [5, 4, 3, 2, 86]
    ]
  },
  {
    name: "DenseNet121",
    precision: 91.2,
    recall: 89.5,
    map: 90.6,
    params: "8.0M",
    latency: 45,
    color: "#fb923c",
    prPoints: [
      { r: 0.0, p: 1.0 },
      { r: 0.2, p: 0.98 },
      { r: 0.4, p: 0.95 },
      { r: 0.6, p: 0.91 },
      { r: 0.8, p: 0.85 },
      { r: 0.9, p: 0.74 },
      { r: 1.0, p: 0.50 }
    ],
    confusion: [
      [92, 2, 3, 1, 2],
      [4, 89, 2, 3, 2],
      [4, 2, 90, 1, 3],
      [3, 2, 2, 91, 2],
      [3, 3, 2, 2, 90]
    ]
  },
  {
    name: "Inception-V3",
    precision: 92.8,
    recall: 91.0,
    map: 92.1,
    params: "23.8M",
    latency: 85,
    color: "#60a5fa",
    prPoints: [
      { r: 0.0, p: 1.0 },
      { r: 0.2, p: 0.99 },
      { r: 0.4, p: 0.97 },
      { r: 0.6, p: 0.93 },
      { r: 0.8, p: 0.89 },
      { r: 0.9, p: 0.80 },
      { r: 1.0, p: 0.55 }
    ],
    confusion: [
      [93, 2, 2, 1, 2],
      [3, 91, 1, 3, 2],
      [3, 1, 92, 1, 3],
      [2, 2, 2, 93, 1],
      [3, 2, 2, 1, 92]
    ]
  },
  {
    name: "Inception-ResNetV2",
    precision: 93.5,
    recall: 91.8,
    map: 93.0,
    params: "55.8M",
    latency: 195,
    color: "#a78bfa",
    prPoints: [
      { r: 0.0, p: 1.0 },
      { r: 0.2, p: 0.99 },
      { r: 0.4, p: 0.98 },
      { r: 0.6, p: 0.95 },
      { r: 0.8, p: 0.91 },
      { r: 0.9, p: 0.83 },
      { r: 1.0, p: 0.60 }
    ],
    confusion: [
      [94, 1, 2, 1, 2],
      [3, 92, 1, 2, 2],
      [3, 1, 93, 1, 2],
      [2, 1, 1, 94, 2],
      [2, 2, 2, 1, 93]
    ]
  },
  {
    name: "YOLOv5 (Champion)",
    precision: 95.5,
    recall: 93.2,
    map: 95.4,
    params: "7.2M",
    latency: 18,
    color: "#10b981",
    prPoints: [
      { r: 0.0, p: 1.0 },
      { r: 0.2, p: 1.0 },
      { r: 0.4, p: 0.99 },
      { r: 0.6, p: 0.98 },
      { r: 0.8, p: 0.95 },
      { r: 0.9, p: 0.92 },
      { r: 1.0, p: 0.75 }
    ],
    confusion: [
      [97, 1, 1, 0, 1],
      [2, 95, 1, 1, 1],
      [2, 1, 94, 1, 2],
      [1, 1, 1, 96, 1],
      [2, 1, 1, 1, 95]
    ]
  }
];

export default function App() {
  // Authentication Gate
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Views: "live", "reports" or "benchmarks"
  const [currentView, setCurrentView] = useState<"live" | "reports" | "benchmarks">("live");

  // Selected benchmark model index (Default to YOLOv5)
  const [benchmarkModelIdx, setBenchmarkModelIdx] = useState(4);

  // Live state
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<AlertPayload[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Selected details for modal view
  const [selectedAlert, setSelectedAlert] = useState<AlertPayload | null>(null);

  // Reports state
  const [reportStudentId, setReportStudentId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [searchedSessions, setSearchedSessions] = useState<ActiveSession[]>([]);
  const [sessionReport, setSessionReport] = useState<HistoricalReport | null>(null);

  // Handle simple JWT authentication simulation
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "admin" && password === "admin123") {
      setIsAuthenticated(true);
    } else {
      alert("Invalid credentials. Try username: admin, password: admin123");
    }
  };

  // Fetch active sessions and set up WebSocket for alert streaming
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchActive = async () => {
      try {
        const res = await fetch("http://localhost:8000/session/active");
        if (res.ok) {
          const data = await res.json();
          setActiveSessions(data);
        }
      } catch (err) {
        console.error("Error fetching active sessions:", err);
      }
    };

    fetchActive();
    const interval = setInterval(fetchActive, 5000); // Poll list of active sessions every 5s

    // Connect to dashboard alerts WebSocket
    const socket = new WebSocket("ws://localhost:8000/dashboard/alerts");

    socket.onopen = () => {
      console.log("[DASHBOARD] Alerts WebSocket connected.");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "alert") {
        const newAlert: AlertPayload = {
          id: data.id,
          session_id: data.session_id,
          student_id: data.student_id,
          anomaly_type: data.anomaly_type,
          confidence: data.confidence,
          timestamp: data.timestamp,
          thumbnail_path: data.thumbnail_path,
          frame_path: data.frame_path,
          video_clip_path: data.video_clip_path || null,
          override_status: data.override_status || "pending"
        };
        
        // Prepend to alert feed
        setLiveAlerts((prev) => [newAlert, ...prev.slice(0, 49)]);

        // Increment alert count for the matching active session
        setActiveSessions((prevSessions) =>
          prevSessions.map((s) => {
            if (s.session_id === data.session_id) {
              const updatedCount = s.alert_count + 1;
              let color: "green" | "yellow" | "red" = "green";
              if (updatedCount > 3) color = "red";
              else if (updatedCount > 0) color = "yellow";
              
              return { ...s, alert_count: updatedCount, status_color: color };
            }
            return s;
          })
        );
      } else if (data.type === "video_update") {
        const { alert_id, video_clip_path } = data;
        setLiveAlerts((prev) =>
          prev.map((a) => (a.id === alert_id ? { ...a, video_clip_path } : a))
        );
        setSessionReport((prevReport) => {
          if (!prevReport) return null;
          return {
            ...prevReport,
            alerts: prevReport.alerts.map((a) =>
              a.id === alert_id ? { ...a, video_clip_path } : a
            )
          };
        });
        setSelectedAlert((prev) => {
          if (prev && prev.id === alert_id) {
            return { ...prev, video_clip_path };
          }
          return prev;
        });
      } else if (data.type === "alert_override") {
        const { alert_id, override_status } = data;
        setLiveAlerts((prev) =>
          prev.map((a) => (a.id === alert_id ? { ...a, override_status } : a))
        );
        setSessionReport((prevReport) => {
          if (!prevReport) return null;
          return {
            ...prevReport,
            alerts: prevReport.alerts.map((a) =>
              a.id === alert_id ? { ...a, override_status } : a
            )
          };
        });
        setSelectedAlert((prev) => {
          if (prev && prev.id === alert_id) {
            return { ...prev, override_status };
          }
          return prev;
        });
      } else if (data.type === "session_status") {
        // A student session started or ended, trigger active fetch immediately
        fetchActive();
      }
    };

    socket.onclose = () => {
      console.log("[DASHBOARD] Alerts WebSocket disconnected.");
    };

    setWs(socket);

    return () => {
      clearInterval(interval);
      socket.close();
    };
  }, [isAuthenticated]);

  // Load report data for specific session
  const loadSessionReport = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    try {
      const res = await fetch(`http://localhost:8000/session/${sessionId}/report`);
      if (res.ok) {
        const data = await res.json();
        setSessionReport(data);
      }
    } catch (err) {
      alert("Failed to load historical report details.");
      console.error(err);
    }
  };

  // Search historical sessions
  const searchSessions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportStudentId.trim()) return;

    try {
      const res = await fetch("http://localhost:8000/session/active");
      if (res.ok) {
        const data = await res.json();
        const matches = data.filter((s: any) => 
          s.student_id.toLowerCase().includes(reportStudentId.toLowerCase())
        );
        setSearchedSessions(matches);
        if (matches.length === 0) {
          alert("No records matching this student ID found in SQLite database logs.");
        }
      }
    } catch (err) {
      console.error("Search query failed:", err);
    }
  };

  // Export historical alerts to CSV
  const exportCSV = () => {
    if (!sessionReport || sessionReport.alerts.length === 0) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Alert ID,Timestamp,Anomaly Type,Confidence,Thumbnail Path,Frame Path\n";
    
    sessionReport.alerts.forEach((a) => {
      const row = `${a.id},${a.timestamp},"${a.anomaly_type}",${a.confidence},${a.thumbnail_path},${a.frame_path}`;
      csvContent += row + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ExamGuard_Report_${sessionReport.student_id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Submit alert validation override to backend
  const handleAlertOverride = async (status: "confirmed" | "dismissed") => {
    if (!selectedAlert) return;
    try {
      const res = await fetch(`http://localhost:8000/session/${selectedAlert.session_id}/alert/${selectedAlert.id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        const data = await res.json();
        // Update local selectedAlert state immediately
        setSelectedAlert((prev) => prev ? { ...prev, override_status: data.override_status } : null);
        
        // Also update in liveAlerts
        setLiveAlerts((prev) =>
          prev.map((a) => (a.id === selectedAlert.id ? { ...a, override_status: data.override_status } : a))
        );
        
        // Also update in sessionReport if open
        setSessionReport((prevReport) => {
          if (!prevReport) return null;
          return {
            ...prevReport,
            alerts: prevReport.alerts.map((a) =>
              a.id === selectedAlert.id ? { ...a, override_status: data.override_status } : a
            )
          };
        });
      } else {
        alert("Failed to save override action on database.");
      }
    } catch (err) {
      console.error("Override api call failed:", err);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md glass-panel glow-indigo rounded-3xl p-8 space-y-6">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow">
              <ShieldAlert className="w-6 h-6 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-100">
              Invigilator Dashboard
            </h2>
            <p className="text-slate-400 text-xs">
              Sign in with administrative privileges to configure student cohorts and review compliance metrics.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Administrator Username
              </label>
              <input
                type="text"
                required
                placeholder="e.g. admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Secure Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans">
      {/* Header */}
      <header className="px-6 py-4 border-b border-slate-900 bg-slate-950/60 backdrop-blur sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-indigo-500 rounded-full relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          </div>
          <h1 className="text-xl font-extrabold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
            EXAMGUARD AI CONTROLS
          </h1>
        </div>

        <nav className="flex items-center bg-slate-900/60 border border-slate-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setCurrentView("live")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              currentView === "live"
                ? "bg-indigo-600 text-white shadow shadow-indigo-600/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Live Monitor
          </button>
          <button
            onClick={() => setCurrentView("benchmarks")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              currentView === "benchmarks"
                ? "bg-indigo-600 text-white shadow shadow-indigo-600/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Model Benchmarks
          </button>
          <button
            onClick={() => setCurrentView("reports")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              currentView === "reports"
                ? "bg-indigo-600 text-white shadow shadow-indigo-600/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Session Reports
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <span className="px-3.5 py-1 text-[10px] font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-full uppercase tracking-wider">
            ADMIN STATUS: AUTHORIZED
          </span>
          <button 
            onClick={() => setIsAuthenticated(false)}
            className="text-[10px] text-slate-500 hover:text-slate-300 font-bold uppercase py-1 px-2.5 border border-slate-850 rounded-lg transition-all"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {currentView === "live" ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left: Active Exam Sessions Grid (2 cols on large screen) */}
            <div className="lg:col-span-2 space-y-6">
              <div className="glass-panel rounded-3xl p-6 space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-900 pb-4">
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-400" /> Active Student Cohorts
                  </h2>
                  <span className="text-xs font-mono font-bold text-slate-500">
                    {activeSessions.length} students online
                  </span>
                </div>

                {activeSessions.length === 0 ? (
                  <div className="py-24 text-center text-slate-550 text-sm italic flex flex-col items-center gap-3">
                    <ShieldAlert className="w-8 h-8 text-slate-700 animate-pulse" />
                    No active student sessions detected. Waiting for student login...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeSessions.map((session) => (
                      <div
                        key={session.session_id}
                        className={`p-5 rounded-2xl border transition-all hover:bg-slate-950/40 relative overflow-hidden flex flex-col justify-between h-40 ${
                          session.status_color === "red"
                            ? "border-rose-500/25 bg-gradient-to-r from-rose-950/5 to-transparent glow-rose"
                            : session.status_color === "yellow"
                            ? "border-amber-500/25 bg-gradient-to-r from-amber-950/5 to-transparent"
                            : "border-slate-850 bg-slate-900/10"
                        }`}
                      >
                        {/* Status Bar */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-200 font-mono">
                            {session.student_id}
                          </span>
                          <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded border ${
                            session.status_color === "red"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : session.status_color === "yellow"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              session.status_color === "red" ? "bg-rose-500" :
                              session.status_color === "yellow" ? "bg-amber-500" : "bg-emerald-500"
                            }`} />
                            {session.status_color.toUpperCase()}
                          </span>
                        </div>

                        {/* Middle: Stats */}
                        <div className="space-y-1 my-3">
                          <div className="text-[10px] text-slate-500 flex justify-between font-mono">
                            <span>Session ID:</span>
                            <span className="text-slate-350">{session.session_id.substring(0, 18)}...</span>
                          </div>
                          <div className="text-[10px] text-slate-500 flex justify-between font-mono">
                            <span>Violations flagged:</span>
                            <span className={`font-bold ${session.alert_count > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                              {session.alert_count}
                            </span>
                          </div>
                        </div>

                        {/* Footer: Start time & CTA */}
                        <div className="flex items-center justify-between border-t border-slate-900/60 pt-3">
                          <span className="text-[9px] text-slate-550 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(session.start_time).toLocaleTimeString()}
                          </span>
                          <button
                            onClick={() => {
                              setCurrentView("reports");
                              loadSessionReport(session.session_id);
                            }}
                            className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 uppercase"
                          >
                            View report <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Scrolling Live Alert Feed */}
            <div className="lg:col-span-1 space-y-6">
              <div className="glass-panel rounded-3xl p-6 space-y-5 shadow-xl h-[600px] flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-900 pb-4 shrink-0">
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-indigo-400" /> Real-time Alert Feed
                  </h2>
                  <span className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 border border-rose-500/10 rounded-full animate-pulse">
                    Live
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {liveAlerts.length === 0 ? (
                    <div className="py-32 text-center text-slate-650 text-xs italic flex flex-col items-center gap-2">
                      <CheckCircle2 className="w-8 h-8 text-slate-800" />
                      Listening for incoming alerts...
                    </div>
                  ) : (
                    liveAlerts.map((alert, index) => {
                      const isTabSwitch = alert.anomaly_type.includes("Interface");
                      return (
                        <div
                          key={index}
                          onClick={() => alert.thumbnail_path && setSelectedAlert(alert)}
                          className={`p-3.5 rounded-xl border text-xs cursor-pointer transition-all hover:scale-[1.01] ${
                            isTabSwitch
                              ? "bg-rose-950/20 border-rose-500/20 hover:border-rose-500/40"
                              : "bg-slate-950/60 border-slate-850 hover:border-slate-800"
                          }`}
                        >
                          <div className="flex justify-between items-center mb-2">
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono bg-slate-900 text-indigo-400 border border-slate-800 rounded">
                              {alert.student_id}
                            </span>
                            <div className="text-[9px] text-slate-500 font-mono flex items-center gap-1.5">
                              {alert.override_status === "confirmed" && (
                                <span className="text-[8px] text-rose-400 font-bold bg-rose-950/40 px-1.5 py-0.5 border border-rose-900/30 rounded">Confirmed</span>
                              )}
                              {alert.override_status === "dismissed" && (
                                <span className="text-[8px] text-slate-400 font-bold bg-slate-900 px-1.5 py-0.5 border border-slate-850 rounded line-through">Dismissed</span>
                              )}
                              <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            {alert.thumbnail_path && (
                              <img
                                src={`http://localhost:8000${alert.thumbnail_path}`}
                                alt="Alert Keyframe"
                                className="w-14 h-11 object-cover rounded-lg border border-slate-800 shrink-0 bg-slate-950"
                              />
                            )}
                            <div className="flex-1 space-y-1">
                              <div className="font-bold text-slate-200 flex items-center justify-between gap-1">
                                <span className="flex items-center gap-1">
                                  {isTabSwitch ? (
                                    <XOctagon className="w-3.5 h-3.5 text-rose-500" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                  )}
                                  {alert.anomaly_type}
                                </span>
                                {alert.video_clip_path && (
                                  <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide shrink-0">
                                    🎥 Video
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                Confidence: {alert.confidence}%
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : currentView === "benchmarks" ? (
          <div className="space-y-6">
            {/* Top Stats Overview */}
            <div className="glass-panel rounded-3xl p-6 shadow-xl space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-900 pb-4">
                <BarChart2 className="w-5 h-5 text-indigo-400" />
                <div>
                  <h2 className="text-base font-bold text-slate-100">Model Performance & Architecture Benchmarks</h2>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Scientific performance comparisons of online proctoring CNN pipelines matching Section IV (Ramzan et al. 2024)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Comparison Table */}
                <div className="xl:col-span-2 bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Metrics Matrix</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-900 text-slate-500 font-sans">
                          <th className="py-2.5">Architecture</th>
                          <th>Precision</th>
                          <th>Recall</th>
                          <th>mAP @ 0.5</th>
                          <th>Parameter Size</th>
                          <th>Edge Latency</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/60">
                        {BENCHMARK_MODELS.map((model, idx) => (
                          <tr
                            key={idx}
                            onClick={() => setBenchmarkModelIdx(idx)}
                            className={`cursor-pointer hover:bg-slate-900/30 transition-all ${
                              benchmarkModelIdx === idx ? "bg-indigo-500/5 text-slate-100 font-bold" : "text-slate-500"
                            }`}
                          >
                            <td className="py-3 font-sans font-semibold flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: model.color }} />
                              {model.name}
                            </td>
                            <td>{model.precision.toFixed(1)}%</td>
                            <td>{model.recall.toFixed(1)}%</td>
                            <td className="font-bold text-indigo-400">{model.map.toFixed(1)}%</td>
                            <td>{model.params}</td>
                            <td>{model.latency} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Accuracy Radar/Key Insights */}
                <div className="xl:col-span-1 bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Architectural Takeaways</h3>
                  <div className="space-y-4 text-xs leading-relaxed text-slate-400">
                    <div className="p-3 bg-emerald-950/15 border border-emerald-900/20 rounded-xl">
                      <span className="font-bold text-emerald-400 block mb-1">🥇 YOLOv5 Performance Champion</span>
                      Achieved a mAP of <strong className="text-emerald-300">95.4%</strong> with low latency (<strong className="text-emerald-300">18ms</strong>), outperforming massive models like Inception-ResNetV2 by matching model simplicity with bounding box efficiency.
                    </div>
                    <div className="p-3 bg-rose-950/15 border border-rose-900/20 rounded-xl">
                      <span className="font-bold text-rose-400 block mb-1">⚡ Custom CNN Edge Efficiency</span>
                      Designed with only <strong className="text-rose-300">0.5M parameters</strong>, compiling to a <strong className="text-rose-300">27 KB</strong> bundle. Ideal for extreme low-power client-side edge deployment (running locally under 10ms in-browser).
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Graphs Sub-Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* mAP Comparison Chart */}
              <div className="glass-panel rounded-3xl p-6 space-y-4 shadow-xl">
                <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wider">mAP @ 0.5 Accuracy Comparison</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={BENCHMARK_MODELS}
                      margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorMap" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} domain={[80, 100]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "rgba(15, 23, 42, 0.95)", border: "1px solid #334155", borderRadius: "12px", color: "#f1f5f9" }}
                      />
                      <Area type="monotone" dataKey="map" name="mAP @ 0.5" stroke="#6366f1" fillOpacity={1} fill="url(#colorMap)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Parameter Size vs Edge Latency Chart */}
              <div className="glass-panel rounded-3xl p-6 space-y-4 shadow-xl">
                <h3 className="text-xs font-bold text-slate-355 uppercase tracking-wider">Edge Inference Latency (ms)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={BENCHMARK_MODELS}
                      margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "rgba(15, 23, 42, 0.95)", border: "1px solid #334155", borderRadius: "12px", color: "#f1f5f9" }}
                      />
                      <Area type="monotone" dataKey="latency" name="Latency (ms)" stroke="#ef4444" fillOpacity={1} fill="url(#colorLat)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Interactive PR Curves and Confusion Matrices */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Precision-Recall Curve (SVG) */}
              <div className="glass-panel rounded-3xl p-6 space-y-4 shadow-xl">
                <div className="flex justify-between items-center border-b border-slate-900 pb-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Precision-Recall Curve</h3>
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 border border-indigo-500/15 rounded">
                    {BENCHMARK_MODELS[benchmarkModelIdx].name}
                  </span>
                </div>

                <div className="flex justify-center items-center py-4 bg-slate-950/40 rounded-2xl border border-slate-900/60 aspect-video relative">
                  {/* Custom SVG Graph */}
                  <svg className="w-full h-full max-w-sm p-4" viewBox="0 0 100 100">
                    {/* Grid lines */}
                    <line x1="10" y1="10" x2="90" y2="10" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="10" y1="30" x2="90" y2="30" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="10" y1="70" x2="90" y2="70" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="10" y1="90" x2="90" y2="90" stroke="#334155" strokeWidth="1" />
                    <line x1="10" y1="10" x2="10" y2="90" stroke="#334155" strokeWidth="1" />
                    <line x1="50" y1="10" x2="50" y2="90" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="90" y1="10" x2="90" y2="90" stroke="#1e293b" strokeWidth="0.5" />

                    {/* PR Line */}
                    <path
                      d={BENCHMARK_MODELS[benchmarkModelIdx].prPoints
                        .map((pt, i) => {
                          const x = 10 + pt.r * 80;
                          const y = 90 - pt.p * 80;
                          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                        })
                        .join(" ")}
                      fill="none"
                      stroke={BENCHMARK_MODELS[benchmarkModelIdx].color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Reference Line */}
                    <rect x="10" y="10" width="80" height="80" fill="none" stroke="#475569" strokeDasharray="2 2" strokeWidth="0.5" />

                    {/* Text labels */}
                    <text x="3" y="12" fill="#64748b" fontSize="4" fontFamily="sans-serif">1.0</text>
                    <text x="3" y="52" fill="#64748b" fontSize="4" fontFamily="sans-serif">0.5</text>
                    <text x="3" y="92" fill="#64748b" fontSize="4" fontFamily="sans-serif">0.0</text>
                    
                    <text x="10" y="96" fill="#64748b" fontSize="4" fontFamily="sans-serif" textAnchor="middle">0.0</text>
                    <text x="50" y="96" fill="#64748b" fontSize="4" fontFamily="sans-serif" textAnchor="middle">0.5</text>
                    <text x="90" y="96" fill="#64748b" fontSize="4" fontFamily="sans-serif" textAnchor="middle">1.0</text>

                    {/* Axis Titles */}
                    <text x="50" y="101" fill="#94a3b8" fontSize="4" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">Recall</text>
                    <text x="0" y="50" fill="#94a3b8" fontSize="4" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle" transform="rotate(-90 0 50)">Precision</text>
                  </svg>
                </div>
              </div>

              {/* Confusion Matrix (HTML Grid) */}
              <div className="glass-panel rounded-3xl p-6 space-y-4 shadow-xl">
                <div className="flex justify-between items-center border-b border-slate-900 pb-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Abnormality Confusion Matrix</h3>
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 border border-indigo-500/15 rounded">
                    Active Class Matrix
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-6 gap-1 bg-slate-950/40 p-4 border border-slate-900 rounded-2xl font-mono text-[9px] text-center items-center">
                    <div className="text-slate-500 font-sans font-bold text-[8px]">Act\Pred</div>
                    <div className="text-slate-400">Normal</div>
                    <div className="text-slate-400">Device</div>
                    <div className="text-slate-400">Head</div>
                    <div className="text-slate-400">Multi</div>
                    <div className="text-slate-400">Talk</div>

                    {["Normal", "Device", "Head", "Multi", "Talk"].map((actual, rowIdx) => (
                      <React.Fragment key={rowIdx}>
                        <div className="text-slate-400 font-sans font-bold text-left pl-1">{actual}</div>
                        {BENCHMARK_MODELS[benchmarkModelIdx].confusion[rowIdx].map((val, colIdx) => {
                          const isDiagonal = rowIdx === colIdx;
                          return (
                            <div
                              key={colIdx}
                              className={`p-3.5 rounded-lg border font-bold transition-all ${
                                isDiagonal
                                  ? "bg-indigo-650/20 border-indigo-500/30 text-indigo-300"
                                  : "bg-slate-900/40 border-slate-900/60 text-slate-500"
                              }`}
                            >
                              {val}%
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-550 leading-normal font-sans italic text-center">
                    * Diagonal cells indicate correct classifications. Hovering rows details classification leakage into alternative features.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Session Reports View */
          <div className="space-y-6">
            <div className="glass-panel rounded-3xl p-6 shadow-xl">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-900 pb-4 mb-5">
                <FileText className="w-5 h-5 text-indigo-400" /> Proctoring Log Search
              </h2>

              <form onSubmit={searchSessions} className="flex gap-4 max-w-md">
                <input
                  type="text"
                  required
                  placeholder="Enter Student ID (e.g. MITS)"
                  value={reportStudentId}
                  onChange={(e) => setReportStudentId(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-xl text-xs transition-all shadow shadow-indigo-600/15"
                >
                  Search Logs
                </button>
              </form>

              {searchedSessions.length > 0 && (
                <div className="mt-5 space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Matching Sessions Found</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {searchedSessions.map((s) => (
                      <button
                        key={s.session_id}
                        onClick={() => loadSessionReport(s.session_id)}
                        className={`p-3.5 rounded-xl border text-left text-xs font-mono transition-all ${
                          selectedSessionId === s.session_id
                            ? "bg-indigo-500/10 border-indigo-500 text-indigo-200"
                            : "bg-slate-950/40 border-slate-850 hover:bg-slate-900 text-slate-300"
                        }`}
                      >
                        <div className="font-bold text-slate-200">{s.student_id}</div>
                        <div className="text-[9px] text-slate-500 mt-1">ID: {s.session_id.substring(0, 12)}...</div>
                        <div className="text-[9px] text-slate-500">Flags: {s.alert_count}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Historical report details */}
            {sessionReport && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start animate-fade-in">
                {/* Visual statistics & chart */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="glass-panel rounded-3xl p-6 space-y-6 shadow-xl">
                    <div className="flex justify-between items-center border-b border-slate-900 pb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-100">
                          Timeline Analysis
                        </h3>
                        <p className="text-[10px] text-slate-450 mt-1 font-mono">
                          Student ID: {sessionReport.student_id} • Session: {sessionReport.session_id}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0 print:hidden">
                        <button
                          onClick={exportCSV}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow"
                        >
                          <Download className="w-3.5 h-3.5" /> Export logs (CSV)
                        </button>
                        <button
                          onClick={() => window.print()}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow shadow-indigo-600/20"
                        >
                          <FileText className="w-3.5 h-3.5" /> Compile PDF Report
                        </button>
                      </div>
                    </div>

                    {sessionReport.timeline_chart.length === 0 ? (
                      <div className="py-20 text-center text-slate-550 text-xs italic">
                        No violations logged during this session.
                      </div>
                    ) : (
                      <div className="h-64 w-full bg-slate-950/40 border border-slate-900/60 p-3 rounded-2xl">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={sessionReport.timeline_chart}
                            margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient id="colorConf" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis 
                              dataKey="elapsed_seconds" 
                              stroke="#64748b" 
                              fontSize={9} 
                              tickFormatter={(val) => `${val}s`} 
                            />
                            <YAxis 
                              stroke="#64748b" 
                              fontSize={9} 
                              domain={[0, 100]}
                              tickFormatter={(val) => `${val}%`} 
                            />
                            <Tooltip
                              contentStyle={{ 
                                backgroundColor: "rgba(15, 23, 42, 0.95)", 
                                border: "1px solid #334155",
                                borderRadius: "12px",
                                fontSize: "11px",
                                color: "#f1f5f9"
                              }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="confidence" 
                              name="Anom. Confidence"
                              stroke="#ef4444" 
                              fillOpacity={1} 
                              fill="url(#colorConf)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stored Alert instances */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="glass-panel rounded-3xl p-6 space-y-4 shadow-xl max-h-[500px] overflow-y-auto">
                    <h3 className="text-sm font-bold text-slate-100 border-b border-slate-900 pb-3 mb-2 flex items-center gap-1.5">
                      <BarChart2 className="w-4 h-4 text-indigo-400" /> Logged Incidents ({sessionReport.total_alerts})
                    </h3>

                    {sessionReport.alerts.length === 0 ? (
                      <div className="py-20 text-center text-slate-600 text-xs italic">
                        Clean record. No flags.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {sessionReport.alerts.map((a) => (
                          <div
                            key={a.id}
                            onClick={() => setSelectedAlert({
                              id: a.id,
                              session_id: sessionReport.session_id,
                              student_id: sessionReport.student_id,
                              anomaly_type: a.anomaly_type,
                              confidence: a.confidence * 100,
                              timestamp: a.timestamp,
                              thumbnail_path: a.thumbnail_path,
                              frame_path: a.frame_path,
                              video_clip_path: a.video_clip_path,
                              override_status: a.override_status
                            })}
                            className="p-3 bg-slate-950/70 border border-slate-850 hover:border-slate-800 rounded-xl text-xs cursor-pointer flex gap-3 transition-all"
                          >
                            {a.thumbnail_path && (
                              <img
                                src={`http://localhost:8000${a.thumbnail_path}`}
                                alt="incident preview"
                                className="w-12 h-10 object-cover rounded-lg border border-slate-855 bg-slate-950 shrink-0"
                              />
                            )}
                            <div className="flex-1 space-y-0.5">
                              <div className="font-bold text-slate-200 flex items-center justify-between gap-1">
                                <span>{a.anomaly_type}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {a.video_clip_path && (
                                    <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide font-sans">
                                      🎥 Evidence
                                    </span>
                                  )}
                                  {a.override_status === "confirmed" && (
                                    <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded font-sans">Confirmed</span>
                                  )}
                                  {a.override_status === "dismissed" && (
                                    <span className="bg-slate-900 text-slate-400 border border-slate-850 text-[9px] font-bold px-1.5 py-0.5 rounded line-through font-sans">Dismissed</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-[9px] text-slate-500 font-mono">
                                Time: {new Date(a.timestamp).toLocaleTimeString()}
                              </div>
                              <div className="text-[9px] text-slate-400 font-mono">
                                Confidence: {round(a.confidence * 100, 1)}%
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Visual Alert keyframe detail Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl glass-panel glow-indigo rounded-3xl overflow-hidden shadow-2xl animate-scale-in">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-900 bg-slate-900/30 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400" /> Logged Evidence Keyframe
                </h3>
                <span className="text-[10px] font-mono text-slate-500">Student: {selectedAlert.student_id}</span>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-xs font-bold text-slate-500 hover:text-slate-350 border border-slate-850 bg-slate-950 px-3 py-1 rounded-xl transition-all"
              >
                Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                {selectedAlert.video_clip_path ? (
                  <div className="border border-slate-900 rounded-2xl overflow-hidden bg-slate-950 aspect-video flex flex-col justify-between">
                    <video
                      src={`http://localhost:8000${selectedAlert.video_clip_path}`}
                      controls
                      autoPlay
                      className="w-full h-full object-contain focus:outline-none"
                    />
                    <div className="bg-indigo-950/40 px-3 py-1.5 border-t border-indigo-900/30 text-[10px] text-indigo-300 font-bold flex justify-between items-center font-sans">
                      <span>🎥 5-second evidence video highlight</span>
                      <a 
                        href={`http://localhost:8000${selectedAlert.video_clip_path}`}
                        download
                        className="text-cyan-400 hover:text-cyan-300 underline font-mono text-[9px]"
                      >
                        Download Raw Clip
                      </a>
                    </div>
                  </div>
                ) : selectedAlert.frame_path ? (
                  <div className="border border-slate-900 rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center">
                    <img
                      src={`http://localhost:8000${selectedAlert.frame_path}`}
                      alt="evidence frame"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="border border-slate-900/60 rounded-2xl bg-slate-950 aspect-video flex flex-col items-center justify-center text-slate-500 text-xs italic gap-1.5">
                    No visual keyframe recorded (Audio alert).
                  </div>
                )}
              </div>

              <div className="w-full md:w-56 space-y-4 font-mono text-xs text-slate-400">
                <h4 className="font-sans font-bold text-sm text-slate-200">Telemetry Data</h4>
                
                <div className="space-y-2 leading-relaxed">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Anomaly Class</span>
                    <span className="text-rose-400 font-bold text-sm font-sans">{selectedAlert.anomaly_type}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Detection Confidence</span>
                    <span className="text-slate-200 font-bold">{selectedAlert.confidence}%</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Detection Timestamp</span>
                    <span className="text-slate-200">{new Date(selectedAlert.timestamp).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase">Session Hash</span>
                    <span className="text-slate-200 text-[10px] break-all">{selectedAlert.session_id}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-900">
                    <span className="text-slate-500 block text-[9px] uppercase mb-1.5">Validation Status</span>
                    <div className="flex flex-col gap-1.5">
                      {selectedAlert.override_status === "confirmed" ? (
                        <div className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-lg text-xs font-bold text-center font-sans">
                          ✓ Violation Confirmed
                        </div>
                      ) : selectedAlert.override_status === "dismissed" ? (
                        <div className="bg-slate-900 text-slate-400 border border-slate-850 px-3 py-1.5 rounded-lg text-xs font-bold text-center line-through font-sans">
                          ✗ Dismissed (False Alarm)
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <button
                            onClick={() => handleAlertOverride("confirmed")}
                            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-1.5 px-3 rounded-lg transition-all text-[11px] font-sans"
                          >
                            Confirm Violation
                          </button>
                          <button
                            onClick={() => handleAlertOverride("dismissed")}
                            className="w-full bg-slate-900 hover:bg-slate-800 text-slate-350 border border-slate-850 py-1.5 px-3 rounded-lg transition-all text-[11px] font-sans"
                          >
                            Dismiss (False Alarm)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-4 text-center border-t border-slate-900 bg-slate-950/40">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">
          ExamGuard AI Invigilation Dashboard • Full Stack Proctoring Control
        </p>
      </footer>
    </div>
  );
}

// Utility to handle rounding cleanly in inline TSX
function round(value: number, decimals: number) {
  return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}
