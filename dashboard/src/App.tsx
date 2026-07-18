import React, { useState, useEffect } from "react";
import { 
  ShieldAlert, Users, Bell, FileText, CheckCircle2, AlertTriangle, 
  XOctagon, Clock, ChevronRight, Download, BarChart2 
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
      <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", color: '#1C2430', background: '#F6F3EC' }}>
        {/* LEFT: ILLUSTRATION PANEL (46%) — matches invigilator-login.html */}
        <div style={{
          width: '46%',
          background: '#152C48',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {/* Grid overlay */}
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'linear-gradient(rgba(246,243,236,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(246,243,236,0.035) 1px, transparent 1px)',
            backgroundSize: '64px 64px'
          }} />

          {/* Large wax-seal SVG with ribbon tails */}
          <svg width="360" height="360" viewBox="0 0 360 360" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'relative', zIndex: 1 }}>
            <path d="M180 18 L198 42 L228 34 L232 65 L262 76 L248 104 L266 130 L238 143 L235 174 L204 168 L184 192 L164 168 L133 174 L130 143 L102 130 L120 104 L106 76 L136 65 L140 34 L170 42 Z"
              stroke="#D9B65B" strokeWidth="1.6" fill="none" opacity="0.9"/>
            <circle cx="180" cy="103" r="46" stroke="#D9B65B" strokeWidth="1.6" fill="none" opacity="0.9"/>
            <text x="180" y="115" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="34" fontWeight="600" fill="#D9B65B">EG</text>
            {/* ribbon tails */}
            <path d="M155 250 L146 340 L172 322 L188 340 L179 250" stroke="#C7D4E3" strokeWidth="1.4" fill="none" opacity="0.5"/>
            <path d="M205 250 L214 340 L188 322" stroke="#C7D4E3" strokeWidth="1.4" fill="none" opacity="0.5"/>
          </svg>

          <div style={{
            position: 'absolute',
            left: 72,
            bottom: 64,
            maxWidth: 340,
            color: '#C7D4E3',
            fontSize: '13.5px',
            lineHeight: 1.6
          }}>
            <strong style={{ display: 'block', fontFamily: "'Newsreader', serif", fontWeight: 600, fontSize: 19, color: '#F6F3EC', marginBottom: 8 }}>
              Sealed integrity, verified by hand.
            </strong>
            Every confirmed violation carries your mark — a record the institution can stand behind.
          </div>
        </div>

        {/* RIGHT: FORM PANEL (54%) — matches invigilator-login.html */}
        <div style={{
          width: '54%',
          padding: '56px 80px',
          display: 'flex',
          flexDirection: 'column' as const,
          background: '#F6F3EC'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'auto' }}>
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 26, height: 26, flexShrink: 0 }}>
              <path d="M20 2 L23.5 6.5 L29 5 L29.5 10.7 L35 12.5 L32 17.5 L35 22.5 L29.5 24.3 L29 30 L23.5 28.5 L20 33 L16.5 28.5 L11 30 L10.5 24.3 L5 22.5 L8 17.5 L5 12.5 L10.5 10.7 L11 5 L16.5 6.5 Z"
                stroke="#1E3A5F" strokeWidth="1.4" fill="#F6F3EC"/>
              <text x="20" y="21.5" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="10" fontWeight="600" fill="#1E3A5F">EG</text>
            </svg>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, letterSpacing: '0.14em', color: '#5B6472', fontWeight: 500 }}>
              EXAMGUARD AI
            </span>
          </div>

          <div style={{ maxWidth: 420, marginTop: 96 }}>
            <p style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '10.5px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase' as const,
              color: '#B8912F',
              margin: '0 0 14px 0'
            }}>
              Administrator access
            </p>
            <h1 style={{
              fontFamily: "'Newsreader', serif",
              fontWeight: 600,
              fontSize: 38,
              lineHeight: 1.15,
              margin: '0 0 14px 0',
              letterSpacing: '-0.01em',
              color: '#1C2430'
            }}>
              Invigilator sign-in
            </h1>
            <p style={{
              fontSize: '14.5px',
              lineHeight: 1.6,
              color: '#5B6472',
              margin: '0 0 40px 0',
              maxWidth: '40ch'
            }}>
              Supervise active cohorts, review flagged sessions, and confirm violations for the academic record.
            </p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 26 }}>
                <label htmlFor="admin-user" style={{
                  display: 'block',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '10.5px',
                  letterSpacing: '0.12em',
                  color: '#5B6472',
                  textTransform: 'uppercase' as const,
                  marginBottom: 9
                }}>
                  Administrator username
                </label>
                <input
                  id="admin-user"
                  type="text"
                  required
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    borderBottom: '1px solid #CFC8B8',
                    background: 'transparent',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '14.5px',
                    color: '#1C2430',
                    padding: '8px 2px 12px 2px',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ marginBottom: 26 }}>
                <label htmlFor="admin-pass" style={{
                  display: 'block',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '10.5px',
                  letterSpacing: '0.12em',
                  color: '#5B6472',
                  textTransform: 'uppercase' as const,
                  marginBottom: 9
                }}>
                  Password
                </label>
                <input
                  id="admin-pass"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    border: 'none',
                    borderBottom: '1px solid #CFC8B8',
                    background: 'transparent',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '14.5px',
                    color: '#1C2430',
                    padding: '8px 2px 12px 2px',
                    outline: 'none'
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  background: '#1E3A5F',
                  color: '#F6F3EC',
                  border: 'none',
                  borderRadius: 8,
                  padding: '15px 20px',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: 6
                }}
              >
                Sign in
              </button>
            </form>
          </div>

          <div style={{
            marginTop: 'auto',
            paddingTop: 48,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase' as const,
            color: '#B4AD9C'
          }}>
            Proctor Dashboard v1.1 · Sealed Integrity
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#10161F] flex flex-col font-sans text-[#E9E4D8]">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[#E9E4D8]/10 bg-[#171F2A] sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 22, height: 22, flexShrink: 0 }}>
            <path d="M20 2 L23.5 6.5 L29 5 L29.5 10.7 L35 12.5 L32 17.5 L35 22.5 L29.5 24.3 L29 30 L23.5 28.5 L20 33 L16.5 28.5 L11 30 L10.5 24.3 L5 22.5 L8 17.5 L5 12.5 L10.5 10.7 L11 5 L16.5 6.5 Z"
              stroke="#D9B65B" strokeWidth="1.4" fill="none"/>
            <text x="20" y="21.5" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="10" fontWeight="600" fill="#D9B65B">EG</text>
          </svg>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', letterSpacing: '0.14em', color: '#E9E4D8', fontWeight: 500 }}>
            EXAMGUARD LEDGER
          </span>
          <div className="w-2 h-2 bg-[#7FAE9B] rounded-full ml-2" />
        </div>

        <nav className="flex items-center bg-[#10161F] border border-[#E9E4D8]/10 rounded p-1 gap-1">
          <button
            onClick={() => setCurrentView("live")}
            className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${
              currentView === "live"
                ? "bg-[#6E93BE]/10 text-[#E9E4D8] border border-[#6E93BE]/20"
                : "text-slate-450 hover:text-slate-200 border border-transparent"
            }`}
          >
            Live Monitor
          </button>
          <button
            onClick={() => setCurrentView("benchmarks")}
            className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${
              currentView === "benchmarks"
                ? "bg-[#6E93BE]/10 text-[#E9E4D8] border border-[#6E93BE]/20"
                : "text-slate-450 hover:text-slate-200 border border-transparent"
            }`}
          >
            Model Benchmarks
          </button>
          <button
            onClick={() => setCurrentView("reports")}
            className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${
              currentView === "reports"
                ? "bg-[#6E93BE]/10 text-[#E9E4D8] border border-[#6E93BE]/20"
                : "text-slate-450 hover:text-slate-200 border border-transparent"
            }`}
          >
            Session Reports
          </button>
        </nav>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">
            authorized invigilator
          </span>
          <button 
            onClick={() => setIsAuthenticated(false)}
            className="text-[10px] text-slate-400 hover:text-slate-200 font-mono uppercase py-1 px-2.5 border border-[#E9E4D8]/15 rounded transition-all"
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
              <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#E9E4D8]/10 pb-4">
                  <h2 className="text-sm font-bold text-[#E9E4D8] flex items-center gap-2 uppercase tracking-wide">
                    <Users className="w-4 h-4 text-[#6E93BE]" /> Active Exam Cohorts
                  </h2>
                  <span className="text-xs font-mono font-bold text-slate-450">
                    {activeSessions.length} students online
                  </span>
                </div>

                {activeSessions.length === 0 ? (
                  <div className="py-24 text-center text-slate-500 text-xs italic flex flex-col items-center gap-3">
                    <ShieldAlert className="w-6 h-6 text-slate-600" />
                    No students are in an active exam right now.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeSessions.map((session) => (
                      <div
                        key={session.session_id}
                        className={`p-5 rounded border transition-all hover:bg-[#10161F]/40 relative overflow-hidden flex flex-col justify-between h-40 ${
                          session.status_color === "red"
                            ? "border-[#E9E4D8]/10 border-l-[3px] border-l-[#C1616B]"
                            : session.status_color === "yellow"
                            ? "border-[#E9E4D8]/10 border-l-[3px] border-l-[#D9B65B]"
                            : "border-[#E9E4D8]/10 border-l-[3px] border-l-[#7FAE9B]"
                        }`}
                      >
                        {/* Status Bar */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#E9E4D8] font-mono">
                            {session.student_id}
                          </span>
                          <span className={`flex items-center gap-1.5 text-[9px] font-bold px-2 py-0.5 rounded border ${
                            session.status_color === "red"
                              ? "bg-[#C1616B]/10 text-[#C1616B] border-[#C1616B]/25"
                              : session.status_color === "yellow"
                              ? "bg-[#D9B65B]/10 text-[#D9B65B] border-[#D9B65B]/25"
                              : "bg-[#7FAE9B]/10 text-[#7FAE9B] border-[#7FAE9B]/25"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              session.status_color === "red" ? "bg-[#C1616B]" :
                              session.status_color === "yellow" ? "bg-[#D9B65B]" : "bg-[#7FAE9B]"
                            }`} />
                            {session.status_color.toUpperCase()}
                          </span>
                        </div>

                        {/* Middle: Stats */}
                        <div className="space-y-1 my-3">
                          <div className="text-[10px] text-slate-500 flex justify-between font-mono">
                            <span>Session:</span>
                            <span className="text-slate-400">{session.session_id.substring(0, 18)}...</span>
                          </div>
                          <div className="text-[10px] text-slate-500 flex justify-between font-mono">
                            <span>Flags:</span>
                            <span className={`font-bold ${session.alert_count > 0 ? "text-[#C1616B]" : "text-[#7FAE9B]"}`}>
                              {session.alert_count}
                            </span>
                          </div>
                        </div>

                        {/* Footer: Start time & CTA */}
                        <div className="flex items-center justify-between border-t border-[#E9E4D8]/5 pt-3">
                          <span className="text-[9px] text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(session.start_time).toLocaleTimeString()}
                          </span>
                          <button
                            onClick={() => {
                              setCurrentView("reports");
                              loadSessionReport(session.session_id);
                            }}
                            className="text-[9px] font-mono font-bold text-[#6E93BE] hover:text-[#6E93BE]/85 flex items-center gap-0.5 uppercase"
                          >
                            View ledger <ChevronRight className="w-3 h-3" />
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
              <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-5 shadow-sm h-[600px] flex flex-col">
                <div className="flex items-center justify-between border-b border-[#E9E4D8]/10 pb-4 shrink-0">
                  <h2 className="text-sm font-bold text-[#E9E4D8] flex items-center gap-2 uppercase tracking-wide">
                    <Bell className="w-4 h-4 text-[#6E93BE]" /> Incident Log Stream
                  </h2>
                  <span className="text-[9px] font-mono font-bold text-[#C1616B] bg-[#C1616B]/15 px-2 py-0.5 border border-[#C1616B]/25 rounded">
                    LIVE FEED
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {liveAlerts.length === 0 ? (
                    <div className="py-32 text-center text-slate-500 text-xs italic flex flex-col items-center gap-2">
                      <CheckCircle2 className="w-6 h-6 text-slate-600" />
                      Listening for incoming incidents...
                    </div>
                  ) : (
                    liveAlerts.map((alert, index) => {
                      const isTabSwitch = alert.anomaly_type.includes("Interface");
                      return (
                        <div
                          key={index}
                          onClick={() => alert.thumbnail_path && setSelectedAlert(alert)}
                          className={`p-3.5 rounded border text-xs cursor-pointer transition-all hover:bg-[#10161F]/40 ${
                            isTabSwitch
                              ? "bg-[#C1616B]/5 border-[#C1616B]/20"
                              : "bg-[#10161F]/20 border-[#E9E4D8]/10"
                          }`}
                        >
                          <div className="flex justify-between items-center mb-2">
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono bg-[#10161F] text-[#6E93BE] border border-[#E9E4D8]/5 rounded">
                              {alert.student_id}
                            </span>
                            <div className="text-[9px] text-slate-550 font-mono flex items-center gap-1.5">
                              {alert.override_status === "confirmed" && (
                                <svg viewBox="0 0 100 100" className="w-4.5 h-4.5">
                                  <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-[#C1616B] stroke-[#C1616B] stroke-[1]" />
                                  <circle cx="50" cy="50" r="30" className="fill-none stroke-[#E9E4D8] stroke-[0.75] stroke-dasharray-[1, 1]" />
                                  <text x="50" y="56" className="font-serif text-[18px] font-bold fill-[#E9E4D8]" textAnchor="middle">✓</text>
                                </svg>
                              )}
                              {alert.override_status === "dismissed" && (
                                <svg viewBox="0 0 100 100" className="w-4.5 h-4.5">
                                  <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-none stroke-[#E9E4D8]/40 stroke-[1.5]" />
                                  <circle cx="50" cy="50" r="30" className="fill-none stroke-[#E9E4D8]/20 stroke-[0.75] stroke-dasharray-[1, 1]" />
                                  <text x="50" y="56" className="font-serif text-[18px] font-bold fill-[#E9E4D8]/40" textAnchor="middle">✗</text>
                                </svg>
                              )}
                              <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            {alert.thumbnail_path && (
                              <img
                                src={`http://localhost:8000${alert.thumbnail_path}`}
                                alt="Incident Capture"
                                className="w-14 h-11 object-cover rounded border border-[#E9E4D8]/10 shrink-0 bg-[#10161F]"
                              />
                            )}
                            <div className="flex-1 space-y-1">
                              <div className="font-bold text-[#E9E4D8] flex items-center justify-between gap-1">
                                <span className="flex items-center gap-1 font-mono text-[11px]">
                                  {isTabSwitch ? (
                                    <XOctagon className="w-3.5 h-3.5 text-[#C1616B]" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5 text-[#D9B65B]" />
                                  )}
                                  {alert.anomaly_type}
                                </span>
                                {alert.video_clip_path && (
                                  <span className="bg-[#6E93BE]/10 text-[#6E93BE] border border-[#6E93BE]/20 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wide shrink-0">
                                    CLIP
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
            <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-6 shadow-sm">
              <div className="flex items-center gap-2 border-b border-[#E9E4D8]/10 pb-4">
                <BarChart2 className="w-4 h-4 text-[#6E93BE]" />
                <div>
                  <h2 className="text-sm font-bold text-[#E9E4D8] uppercase tracking-wide">Model Inference Matrix</h2>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                    Performance benchmarks of edge classification systems (YOLOv5, Custom CNN)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Comparison Table */}
                <div className="xl:col-span-2 bg-[#10161F]/20 border border-[#E9E4D8]/5 rounded-lg p-5 space-y-4">
                  <h3 className="text-[10px] font-mono font-bold text-[#E9E4D8]/70 uppercase tracking-wider">Statistical Matrix</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[#E9E4D8]/10 text-slate-450">
                          <th className="py-2.5">Pipeline</th>
                          <th>Precision</th>
                          <th>Recall</th>
                          <th>mAP @ 0.5</th>
                          <th>Size</th>
                          <th>Latency</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E9E4D8]/5">
                        {BENCHMARK_MODELS.map((model, idx) => (
                          <tr
                            key={idx}
                            onClick={() => setBenchmarkModelIdx(idx)}
                            className={`cursor-pointer hover:bg-[#171F2A]/30 transition-all ${
                              benchmarkModelIdx === idx ? "bg-[#6E93BE]/5 text-[#E9E4D8] font-bold" : "text-slate-450"
                            }`}
                          >
                            <td className="py-3 font-sans font-semibold flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: model.color }} />
                              {model.name}
                            </td>
                            <td>{model.precision.toFixed(1)}%</td>
                            <td>{model.recall.toFixed(1)}%</td>
                            <td className="font-bold text-[#6E93BE]">{model.map.toFixed(1)}%</td>
                            <td>{model.params}</td>
                            <td>{model.latency} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Accuracy Radar/Key Insights */}
                <div className="xl:col-span-1 bg-[#10161F]/20 border border-[#E9E4D8]/5 rounded-lg p-5 space-y-4">
                  <h3 className="text-[10px] font-mono font-bold text-[#E9E4D8]/70 uppercase tracking-wider">Analysis Summary</h3>
                  <div className="space-y-4 text-xs leading-relaxed text-slate-400">
                    <div className="p-3 border-l-2 border-l-[#D9B65B] bg-[#171F2A]/30 rounded">
                      <span className="font-mono text-[9px] font-bold text-[#D9B65B] uppercase tracking-wider block mb-1">Recommended Option</span>
                      <strong>YOLOv5 Champion:</strong> Highest mAP score at <span className="text-[#D9B65B] font-mono">95.4%</span> with low inference latency (<span className="text-[#D9B65B] font-mono">18ms</span>).
                    </div>
                    <div className="p-3 border-l-2 border-l-[#C1616B] bg-[#171F2A]/30 rounded">
                      <span className="font-mono text-[9px] font-bold text-[#C1616B] uppercase tracking-wider block mb-1">Edge Baselines</span>
                      <strong>Custom CNN:</strong> 0.5M parameter footprint with sub-10ms edge latency. Suited for low-spec student web portals.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Graphs Sub-Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* mAP Comparison Chart */}
              <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-4 shadow-sm">
                <h3 className="text-[10px] font-mono font-bold text-[#E9E4D8]/70 uppercase tracking-wider">mAP Accuracy Distribution</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={BENCHMARK_MODELS}
                      margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#253246" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} domain={[80, 100]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#171F2A", border: "1px solid rgba(233, 228, 216, 0.1)", borderRadius: "6px", color: "#E9E4D8" }}
                      />
                      <Area type="monotone" dataKey="map" name="mAP @ 0.5" stroke="#6E93BE" fill="#6E93BE" fillOpacity={0.08} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Parameter Size vs Edge Latency Chart */}
              <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-4 shadow-sm">
                <h3 className="text-[10px] font-mono font-bold text-[#E9E4D8]/70 uppercase tracking-wider">Edge Inference Latency (ms)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={BENCHMARK_MODELS}
                      margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#253246" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#171F2A", border: "1px solid rgba(233, 228, 216, 0.1)", borderRadius: "6px", color: "#E9E4D8" }}
                      />
                      <Area type="monotone" dataKey="latency" name="Latency (ms)" stroke="#C1616B" fill="#C1616B" fillOpacity={0.08} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Interactive PR Curves and Confusion Matrices */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Precision-Recall Curve (SVG) */}
              <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-4 shadow-sm">
                <div className="flex justify-between items-center border-b border-[#E9E4D8]/10 pb-3">
                  <h3 className="text-[10px] font-mono font-bold text-[#E9E4D8]/70 uppercase tracking-wider">Precision-Recall Curve</h3>
                  <span className="text-[9px] font-mono font-bold text-[#6E93BE] bg-[#6E93BE]/10 px-2 py-0.5 border border-[#6E93BE]/20 rounded">
                    {BENCHMARK_MODELS[benchmarkModelIdx].name}
                  </span>
                </div>

                <div className="flex justify-center items-center py-4 bg-[#10161F]/40 rounded border border-[#E9E4D8]/5 aspect-video relative">
                  <svg className="w-full h-full max-w-sm p-4" viewBox="0 0 100 100">
                    <line x1="10" y1="10" x2="90" y2="10" stroke="#253246" strokeWidth="0.5" />
                    <line x1="10" y1="30" x2="90" y2="30" stroke="#253246" strokeWidth="0.5" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke="#253246" strokeWidth="0.5" />
                    <line x1="10" y1="70" x2="90" y2="70" stroke="#253246" strokeWidth="0.5" />
                    <line x1="10" y1="90" x2="90" y2="90" stroke="#475569" strokeWidth="0.75" />
                    <line x1="10" y1="10" x2="10" y2="90" stroke="#475569" strokeWidth="0.75" />
                    <line x1="50" y1="10" x2="50" y2="90" stroke="#253246" strokeWidth="0.5" />
                    <line x1="90" y1="10" x2="90" y2="90" stroke="#253246" strokeWidth="0.5" />

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
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <rect x="10" y="10" width="80" height="80" fill="none" stroke="#334155" strokeDasharray="2 2" strokeWidth="0.5" />

                    <text x="3" y="12" fill="#64748b" fontSize="4" fontFamily="sans-serif">1.0</text>
                    <text x="3" y="52" fill="#64748b" fontSize="4" fontFamily="sans-serif">0.5</text>
                    <text x="3" y="92" fill="#64748b" fontSize="4" fontFamily="sans-serif">0.0</text>
                    
                    <text x="10" y="96" fill="#64748b" fontSize="4" fontFamily="sans-serif" textAnchor="middle">0.0</text>
                    <text x="50" y="96" fill="#64748b" fontSize="4" fontFamily="sans-serif" textAnchor="middle">0.5</text>
                    <text x="90" y="96" fill="#64748b" fontSize="4" fontFamily="sans-serif" textAnchor="middle">1.0</text>

                    <text x="50" y="101" fill="#94a3b8" fontSize="4" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">Recall</text>
                    <text x="0" y="50" fill="#94a3b8" fontSize="4" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle" transform="rotate(-90 0 50)">Precision</text>
                  </svg>
                </div>
              </div>

              {/* Confusion Matrix (HTML Grid) */}
              <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-4 shadow-sm">
                <div className="flex justify-between items-center border-b border-[#E9E4D8]/10 pb-3">
                  <h3 className="text-[10px] font-mono font-bold text-[#E9E4D8]/70 uppercase tracking-wider">Confusion Matrix</h3>
                  <span className="text-[9px] font-mono font-bold text-[#6E93BE] bg-[#6E93BE]/10 px-2 py-0.5 border border-[#6E93BE]/20 rounded">
                    Active Class Matrix
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-6 gap-1 bg-[#10161F]/30 p-4 border border-[#E9E4D8]/5 rounded font-mono text-[9px] text-center items-center">
                    <div className="text-slate-550 font-sans font-bold text-[8px]">Act\Pred</div>
                    <div className="text-slate-450">Normal</div>
                    <div className="text-slate-450">Device</div>
                    <div className="text-slate-450">Head</div>
                    <div className="text-slate-450">Multi</div>
                    <div className="text-slate-450">Talk</div>

                    {["Normal", "Device", "Head", "Multi", "Talk"].map((actual, rowIdx) => (
                      <React.Fragment key={rowIdx}>
                        <div className="text-slate-450 font-sans font-bold text-left pl-1">{actual}</div>
                        {BENCHMARK_MODELS[benchmarkModelIdx].confusion[rowIdx].map((val, colIdx) => {
                          const isDiagonal = rowIdx === colIdx;
                          return (
                            <div
                              key={colIdx}
                              className={`p-3.5 rounded border font-bold transition-all ${
                                isDiagonal
                                  ? "bg-[#7FAE9B]/10 border-[#7FAE9B]/30 text-[#7FAE9B]"
                                  : "bg-[#10161F]/20 border-transparent text-slate-500"
                              }`}
                            >
                              {val}%
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Session Reports View */
          <div className="space-y-6">
            <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 shadow-sm">
              <h2 className="text-sm font-bold text-[#E9E4D8] flex items-center gap-2 border-b border-[#E9E4D8]/10 pb-4 mb-5 uppercase tracking-wide">
                <FileText className="w-4 h-4 text-[#6E93BE]" /> Search Proctoring Ledger
              </h2>

              <form onSubmit={searchSessions} className="flex gap-4 max-w-md">
                <input
                  type="text"
                  required
                  placeholder="Enter Student ID"
                  value={reportStudentId}
                  onChange={(e) => setReportStudentId(e.target.value)}
                  className="flex-1 bg-[#10161F] border border-[#E9E4D8]/10 rounded px-4 py-2.5 text-[#E9E4D8] font-mono text-xs focus:outline-none focus:border-[#6E93BE]"
                />
                <button
                  type="submit"
                  className="bg-[#6E93BE] hover:bg-[#6E93BE]/90 text-[#10161F] font-bold px-5 py-2.5 rounded text-xs transition-all shadow focus-oxford"
                >
                  Search
                </button>
              </form>

              {searchedSessions.length > 0 && (
                <div className="mt-5 space-y-2">
                  <h4 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-3">Matching Sessions</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {searchedSessions.map((s) => (
                      <button
                        key={s.session_id}
                        onClick={() => loadSessionReport(s.session_id)}
                        className={`p-3.5 rounded border text-left text-xs font-mono transition-all ${
                          selectedSessionId === s.session_id
                            ? "bg-[#6E93BE]/10 border-[#6E93BE] text-[#E9E4D8]"
                            : "bg-[#10161F]/40 border-[#E9E4D8]/5 hover:bg-[#10161F] text-slate-350"
                        }`}
                      >
                        <div className="font-bold text-[#E9E4D8]">{s.student_id}</div>
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
                  <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-6 shadow-sm print-card">
                    <div className="flex justify-between items-center border-b border-[#E9E4D8]/10 pb-4">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-[#E9E4D8]">
                          Incident Timeline
                        </h3>
                        <p className="text-[9px] text-slate-500 mt-1 font-mono">
                          ID: {sessionReport.student_id} • Hash: {sessionReport.session_id}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0 print:hidden">
                        <button
                          onClick={exportCSV}
                          className="bg-[#10161F] hover:bg-[#10161F]/80 text-[#E9E4D8] border border-[#E9E4D8]/10 font-mono text-[9px] uppercase px-4 py-2 rounded transition-all focus-oxford"
                        >
                          <Download className="w-3 h-3 inline mr-1" /> Export CSV
                        </button>
                        <button
                          onClick={() => window.print()}
                          className="bg-[#6E93BE] hover:bg-[#6E93BE]/90 text-[#10161F] font-bold px-4 py-2 rounded text-xs transition-all shadow focus-oxford"
                        >
                          Print report
                        </button>
                      </div>
                    </div>

                    {sessionReport.timeline_chart.length === 0 ? (
                      <div className="py-20 text-center text-slate-500 text-xs italic">
                        No incidents logged for this student.
                      </div>
                    ) : (
                      <div className="h-64 w-full bg-[#10161F]/20 border border-[#E9E4D8]/5 p-3 rounded">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={sessionReport.timeline_chart}
                            margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#253246" />
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
                                backgroundColor: "#171F2A", 
                                border: "1px solid rgba(233, 228, 216, 0.1)",
                                borderRadius: "6px",
                                fontSize: "11px",
                                color: "#E9E4D8"
                              }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="confidence" 
                              name="Incident Conf."
                              stroke="#C1616B" 
                              fill="#C1616B" 
                              fillOpacity={0.08} 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stored Alert instances */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg p-6 space-y-4 shadow-sm max-h-[500px] overflow-y-auto print-card">
                    <h3 className="text-xs font-mono font-bold text-[#E9E4D8] border-b border-[#E9E4D8]/10 pb-3 mb-2 uppercase tracking-wider">
                      Incident Ledger ({sessionReport.total_alerts})
                    </h3>

                    {sessionReport.alerts.length === 0 ? (
                      <div className="py-20 text-center text-slate-550 text-xs italic">
                        Clean ledger. Zero flags.
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
                            className="p-3 bg-[#10161F]/70 border border-[#E9E4D8]/5 hover:border-[#E9E4D8]/10 rounded text-xs cursor-pointer flex gap-3 transition-all"
                          >
                            {a.thumbnail_path && (
                              <img
                                src={`http://localhost:8000${a.thumbnail_path}`}
                                alt="Incident thumbnail"
                                className="w-12 h-10 object-cover rounded border border-[#E9E4D8]/10 bg-[#10161F] shrink-0"
                              />
                            )}
                            <div className="flex-1 space-y-0.5">
                              <div className="font-bold text-[#E9E4D8] flex items-center justify-between gap-1">
                                <span className="font-mono text-[10px]">{a.anomaly_type}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {a.video_clip_path && (
                                    <span className="bg-[#6E93BE]/10 text-[#6E93BE] border border-[#6E93BE]/25 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wide">
                                      CLIP
                                    </span>
                                  )}
                                  {a.override_status === "confirmed" && (
                                    <svg viewBox="0 0 100 100" className="w-4 h-4">
                                      <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-[#C1616B] stroke-[#C1616B] stroke-[1]" />
                                      <circle cx="50" cy="50" r="30" className="fill-none stroke-[#E9E4D8] stroke-[0.75] stroke-dasharray-[1, 1]" />
                                      <text x="50" y="56" className="font-serif text-[18px] font-bold fill-[#E9E4D8]" textAnchor="middle">✓</text>
                                    </svg>
                                  )}
                                  {a.override_status === "dismissed" && (
                                    <svg viewBox="0 0 100 100" className="w-4 h-4">
                                      <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-none stroke-[#E9E4D8]/40 stroke-[1.5]" />
                                      <circle cx="50" cy="50" r="30" className="fill-none stroke-[#E9E4D8]/20 stroke-[0.75] stroke-dasharray-[1, 1]" />
                                      <text x="50" y="56" className="font-serif text-[18px] font-bold fill-[#E9E4D8]/40" textAnchor="middle">✗</text>
                                    </svg>
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
        <div className="fixed inset-0 bg-[#10161F]/85 backdrop-blur-sm z-50 flex items-center justify-center p-6 print-hidden">
          <div className="w-full max-w-2xl bg-[#171F2A] border border-[#E9E4D8]/10 rounded-lg overflow-hidden shadow-2xl animate-scale-in">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#E9E4D8]/10 bg-[#10161F]/30 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-mono font-bold text-[#E9E4D8] flex items-center gap-1.5 uppercase">
                  <AlertTriangle className="w-4 h-4 text-[#C1616B]" /> Ledger Item Evidence
                </h3>
                <span className="text-[10px] font-mono text-slate-550">Student: {selectedAlert.student_id}</span>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-xs font-mono font-bold text-slate-450 hover:text-slate-200 border border-[#E9E4D8]/15 bg-[#10161F] px-3 py-1 rounded transition-all focus-oxford"
              >
                Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                {selectedAlert.video_clip_path ? (
                  <div className="border border-[#E9E4D8]/10 rounded overflow-hidden bg-slate-950 aspect-video flex flex-col justify-between">
                    <video
                      src={`http://localhost:8000${selectedAlert.video_clip_path}`}
                      controls
                      autoPlay
                      className="w-full h-full object-contain focus:outline-none"
                    />
                    <div className="bg-[#10161F] px-3 py-1.5 border-t border-[#E9E4D8]/5 text-[10px] text-slate-450 font-mono flex justify-between items-center">
                      <span>🎥 5-second evidence video highlight</span>
                      <a 
                        href={`http://localhost:8000${selectedAlert.video_clip_path}`}
                        download
                        className="text-[#6E93BE] hover:text-[#6E93BE]/80 underline font-mono text-[9px]"
                      >
                        Download Raw Clip
                      </a>
                    </div>
                  </div>
                ) : selectedAlert.frame_path ? (
                  <div className="border border-[#E9E4D8]/10 rounded overflow-hidden bg-slate-950 aspect-video flex items-center justify-center">
                    <img
                      src={`http://localhost:8000${selectedAlert.frame_path}`}
                      alt="Evidence Frame"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="border border-[#E9E4D8]/10 rounded bg-[#10161F] aspect-video flex flex-col items-center justify-center text-slate-550 text-xs italic gap-1.5 font-mono">
                    No visual keyframe recorded (Audio alert).
                  </div>
                )}
              </div>

              <div className="w-full md:w-56 space-y-4 font-mono text-xs text-slate-400">
                <h4 className="font-sans font-bold text-sm text-slate-200 uppercase tracking-wide">Telemetry Data</h4>
                
                <div className="space-y-2.5 leading-relaxed">
                  <div>
                    <span className="text-slate-550 block text-[9px] uppercase">Incident Class</span>
                    <span className="text-[#C1616B] font-serif font-bold text-sm block">{selectedAlert.anomaly_type}</span>
                  </div>
                  <div>
                    <span className="text-slate-555 block text-[9px] uppercase">Confidence</span>
                    <span className="text-slate-200 font-bold">{selectedAlert.confidence}%</span>
                  </div>
                  <div>
                    <span className="text-slate-555 block text-[9px] uppercase">Timestamp</span>
                    <span className="text-slate-200">{new Date(selectedAlert.timestamp).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-555 block text-[9px] uppercase">Session Hash</span>
                    <span className="text-slate-350 text-[10px] break-all">{selectedAlert.session_id}</span>
                  </div>
                  <div className="pt-2 border-t border-[#E9E4D8]/5">
                    <span className="text-slate-555 block text-[9px] uppercase mb-2">Verification Action</span>
                    <div className="flex flex-col gap-1.5">
                      {selectedAlert.override_status === "confirmed" ? (
                        <div className="bg-[#C1616B]/15 text-[#C1616B] border border-[#C1616B]/25 px-3 py-1.5 rounded text-xs font-mono font-bold text-center flex items-center justify-center gap-1.5">
                          <svg viewBox="0 0 100 100" className="w-4 h-4">
                            <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-[#C1616B] stroke-[#C1616B] stroke-[1]" />
                            <circle cx="50" cy="50" r="30" className="fill-none stroke-[#E9E4D8] stroke-[0.75] stroke-dasharray-[1, 1]" />
                            <text x="50" y="56" className="font-serif text-[18px] font-bold fill-[#E9E4D8]" textAnchor="middle">✓</text>
                          </svg>
                          VIOLATION CONFIRMED
                        </div>
                      ) : selectedAlert.override_status === "dismissed" ? (
                        <div className="bg-[#10161F] text-slate-500 border border-[#E9E4D8]/5 px-3 py-1.5 rounded text-xs font-mono font-bold text-center flex items-center justify-center gap-1.5 line-through">
                          <svg viewBox="0 0 100 100" className="w-4 h-4">
                            <path d="M 50 4 C 60 3, 75 7, 85 15 C 93 25, 97 40, 96 50 C 95 65, 93 75, 85 85 C 75 93, 60 97, 50 96 C 35 95, 25 93, 15 85 C 7 75, 3 60, 4 50 C 5 35, 7 25, 15 15 C 25 7, 40 3, 50 4 Z" className="fill-none stroke-[#E9E4D8]/40 stroke-[1.5]" />
                            <circle cx="50" cy="50" r="30" className="fill-none stroke-[#E9E4D8]/20 stroke-[0.75] stroke-dasharray-[1, 1]" />
                            <text x="50" y="56" className="font-serif text-[18px] font-bold fill-[#E9E4D8]/40" textAnchor="middle">✗</text>
                          </svg>
                          DISMISSED (FALSE ALARM)
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <button
                            onClick={() => handleAlertOverride("confirmed")}
                            className="w-full bg-[#C1616B] hover:bg-[#C1616B]/90 text-white font-mono font-bold py-2 px-3 rounded text-[10px] transition-all focus-oxford"
                          >
                            Confirm Violation
                          </button>
                          <button
                            onClick={() => handleAlertOverride("dismissed")}
                            className="w-full bg-[#10161F] hover:bg-[#10161F]/80 text-slate-400 border border-[#E9E4D8]/10 py-2 px-3 rounded transition-all text-[10px] font-mono focus-oxford"
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
      <footer className="py-4 text-center border-t border-[#E9E4D8]/5 bg-[#171F2A] print-hidden">
        <p className="text-[9px] text-slate-600 uppercase tracking-widest font-mono">
          ExamGuard AI Invigilation Dashboard • Full Stack Integrity Control
        </p>
      </footer>
    </div>
  );
}

// Utility to handle rounding cleanly in inline TSX
function round(value: number, decimals: number) {
  return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}
