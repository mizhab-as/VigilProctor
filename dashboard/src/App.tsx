import React, { useState, useEffect } from "react";
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--midnight)] flex flex-col font-sans text-[var(--ink)]">
      {/* HEADER — matching invigilator-dashboard.html */}
      <header>
        <div className="brand">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 2 L23.5 6.5 L29 5 L29.5 10.7 L35 12.5 L32 17.5 L35 22.5 L29.5 24.3 L29 30 L23.5 28.5 L20 33 L16.5 28.5 L11 30 L10.5 24.3 L5 22.5 L8 17.5 L5 12.5 L10.5 10.7 L11 5 L16.5 6.5 Z"
              stroke="#D9B65B" strokeWidth="1.4" fill="#171F2A"/>
            <text x="20" y="21.5" textAnchor="middle" fontFamily="Newsreader, serif" fontSize="10" fontWeight="600" fill="#D9B65B">EG</text>
          </svg>
          <span className="brand-word">EXAMGUARD LEDGER</span>
        </div>
        <nav>
          <button
            onClick={() => setCurrentView("live")}
            className={currentView === "live" ? "active" : ""}
          >
            Live Monitor
          </button>
          <button
            onClick={() => setCurrentView("benchmarks")}
            className={currentView === "benchmarks" ? "active" : ""}
          >
            Model Benchmarks
          </button>
          <button
            onClick={() => setCurrentView("reports")}
            className={currentView === "reports" ? "active" : ""}
          >
            Session Reports
          </button>
        </nav>
        <div className="header-right">
          <span className="role-tag">Authorized Invigilator</span>
          <button onClick={() => setIsAuthenticated(false)} className="logout">
            Logout
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main>
        {currentView === "live" ? (
          <div>
            {/* Active Exam Cohorts */}
            <div className="section-title">
              <h2>Active exam cohorts</h2>
              <span className="meta">{activeSessions.length} students online</span>
            </div>

            <div className="cohort-grid">
              {activeSessions.length === 0 ? (
                <div style={{
                  gridColumn: "1 / -1",
                  padding: "48px",
                  background: "var(--panel)",
                  border: "1px dashed var(--line)",
                  borderRadius: "6px",
                  textAlign: "center",
                  color: "var(--ink-soft)",
                  fontSize: "13px"
                }}>
                  No active student cohorts are online.
                </div>
              ) : (
                activeSessions.map((session) => (
                  <div
                    key={session.session_id}
                    className="cohort-card"
                    style={{
                      "--status-color":
                        session.status_color === "red"
                          ? "var(--seal)"
                          : session.status_color === "yellow"
                          ? "var(--gold)"
                          : "var(--verdigris)"
                    } as React.CSSProperties}
                  >
                    <div className="cohort-top">
                      <span className="cohort-id">{session.student_id}</span>
                      <span className="status-pill">{session.status_color}</span>
                    </div>
                    <div className="cohort-meta">
                      <div className="row">
                        <span>Session</span>
                        <span>{session.session_id.substring(0, 18)}…</span>
                      </div>
                      <div className="row">
                        <span>Flags</span>
                        <span className="flag-count">{session.alert_count}</span>
                      </div>
                    </div>
                    <div className="cohort-bottom">
                      <span className="timestamp">
                        🕒 {new Date(session.start_time).toLocaleTimeString()}
                      </span>
                      <span
                        onClick={() => {
                          setCurrentView("reports");
                          loadSessionReport(session.session_id);
                        }}
                        className="view-link"
                      >
                        View ledger →
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Incident Log Stream */}
            <div className="section-title">
              <h2>Incident log stream</h2>
              <span className="live-tag">Live feed</span>
            </div>

            <div className="incident-list">
              {liveAlerts.length === 0 ? (
                <div style={{
                  padding: "48px",
                  background: "var(--panel)",
                  border: "1px dashed var(--line)",
                  borderRadius: "6px",
                  textAlign: "center",
                  color: "var(--ink-soft)",
                  fontSize: "13px"
                }}>
                  Listening for incoming telemetry incidents…
                </div>
              ) : (
                liveAlerts.map((alert, index) => (
                  <div
                    key={index}
                    onClick={() => alert.thumbnail_path && setSelectedAlert(alert)}
                    className="incident"
                  >
                    <div className="incident-icon">✕</div>
                    <div className="incident-body">
                      <div className="incident-top">
                        <span className="student-badge">{alert.student_id}</span>
                        <div className="flex items-center gap-3">
                          {alert.video_clip_path && (
                            <span style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: "9px",
                              border: "1px solid var(--oxford)",
                              color: "var(--oxford)",
                              borderRadius: "4px",
                              padding: "1px 5px",
                              fontWeight: 600
                            }}>
                              CLIP
                            </span>
                          )}
                          <span className="incident-time">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <div className="incident-type">
                        {alert.anomaly_type.replace(/Security Warning:\s*/i, "").replace(/!+$/, "")}
                      </div>
                      <div className="incident-conf">
                        Confidence: {alert.confidence}%
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : currentView === "benchmarks" ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              <h2>Model performance matrix</h2>
              <span className="meta">tested architectures</span>
            </div>

            {/* Matrix comparison top block */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '24px',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: '6px',
              padding: '24px'
            }}>
              {/* Statistical Table */}
              <div style={{ gridColumn: 'span 2' }}>
                <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '14px', letterSpacing: '0.1em' }}>
                  Statistical benchmark matrix
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 0' }}>Pipeline</th>
                        <th>Precision</th>
                        <th>Recall</th>
                        <th>mAP @ 0.5</th>
                        <th>Size</th>
                        <th>Latency</th>
                      </tr>
                    </thead>
                    <tbody style={{ color: 'var(--ink-soft)' }}>
                      {BENCHMARK_MODELS.map((model, idx) => (
                        <tr
                          key={idx}
                          onClick={() => setBenchmarkModelIdx(idx)}
                          style={{
                            borderBottom: '1px solid rgba(36,44,56,0.5)',
                            cursor: 'pointer',
                            color: benchmarkModelIdx === idx ? 'var(--ink)' : 'inherit',
                            fontWeight: benchmarkModelIdx === idx ? 600 : 400
                          }}
                        >
                          <td style={{ padding: '12px 0', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: model.color }}></span>
                            {model.name}
                          </td>
                          <td>{model.precision.toFixed(1)}%</td>
                          <td>{model.recall.toFixed(1)}%</td>
                          <td style={{ color: 'var(--oxford)' }}>{model.map.toFixed(1)}%</td>
                          <td>{model.params}</td>
                          <td>{model.latency} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Champion Card Overhaul */}
              <div style={{
                background: 'var(--midnight)',
                border: '1px solid var(--line)',
                borderLeft: '3px solid var(--gold)',
                borderRadius: '6px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: '14px'
              }}>
                <div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', letterSpacing: '0.1em', fontWeight: 600 }}>
                    Recommended deployment
                  </span>
                  <h4 style={{ fontFamily: "'Newsreader', serif", fontSize: '18px', fontWeight: 600, margin: '6px 0 0 0' }}>
                    YOLOv5 Champion
                  </h4>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--ink-soft)', lineHeight: 1.5, margin: 0 }}>
                  Achieved peak accuracy of <strong>95.4% mAP</strong> with sub-20ms latency. Suited for standardized high-stakes exam tracking.
                </p>
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--gold)' }}>
                  Latency: 18 ms · Params: 7.2M
                </div>
              </div>
            </div>

            {/* Graphs Sub-Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '14px', letterSpacing: '0.15em' }}>
                  mAP Accuracy distribution
                </h3>
                <div style={{ height: '220px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={BENCHMARK_MODELS} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="name" stroke="var(--ink-soft)" fontSize={9} />
                      <YAxis stroke="var(--ink-soft)" fontSize={9} domain={[80, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                      <Area type="monotone" dataKey="map" name="mAP @ 0.5" stroke="var(--oxford)" fill="var(--oxford)" fillOpacity={0.08} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '14px', letterSpacing: '0.15em' }}>
                  Edge inference latency (ms)
                </h3>
                <div style={{ height: '220px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={BENCHMARK_MODELS} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="name" stroke="var(--ink-soft)" fontSize={9} />
                      <YAxis stroke="var(--ink-soft)" fontSize={9} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                      <Area type="monotone" dataKey="latency" name="Latency (ms)" stroke="var(--seal)" fill="var(--seal)" fillOpacity={0.08} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Matrix confusion diagonal verdigris override */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                  <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.1em', margin: 0 }}>
                    Precision-Recall Curve
                  </h3>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: 'var(--oxford)' }}>
                    {BENCHMARK_MODELS[benchmarkModelIdx].name}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', background: 'rgba(16,22,31,0.4)', borderRadius: '4px', border: '1px solid rgba(36,44,56,0.5)', padding: '16px', aspectRatio: '16/9' }}>
                  <svg className="w-full h-full max-w-xs" viewBox="0 0 100 100">
                    <line x1="10" y1="10" x2="90" y2="10" stroke="var(--line)" strokeWidth="0.5" />
                    <line x1="10" y1="30" x2="90" y2="30" stroke="var(--line)" strokeWidth="0.5" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke="var(--line)" strokeWidth="0.5" />
                    <line x1="10" y1="70" x2="90" y2="70" stroke="var(--line)" strokeWidth="0.5" />
                    <line x1="10" y1="90" x2="90" y2="90" stroke="var(--ink-soft)" strokeWidth="0.75" />
                    <line x1="10" y1="10" x2="10" y2="90" stroke="var(--ink-soft)" strokeWidth="0.75" />
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
                    />
                    <text x="3" y="12" fill="var(--ink-soft)" fontSize="4">1.0</text>
                    <text x="3" y="52" fill="var(--ink-soft)" fontSize="4">0.5</text>
                    <text x="3" y="92" fill="var(--ink-soft)" fontSize="4">0.0</text>
                    <text x="10" y="96" fill="var(--ink-soft)" fontSize="4" textAnchor="middle">0.0</text>
                    <text x="50" y="96" fill="var(--ink-soft)" fontSize="4" textAnchor="middle">0.5</text>
                    <text x="90" y="96" fill="var(--ink-soft)" fontSize="4" textAnchor="middle">1.0</text>
                  </svg>
                </div>
              </div>

              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '14px', letterSpacing: '0.1em' }}>
                  Confusion Matrix
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', background: 'rgba(16,22,31,0.3)', padding: '16px', borderRadius: '4px', border: '1px solid rgba(36,44,56,0.5)', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textAlign: 'center', alignItems: 'center' }}>
                  <div style={{ color: 'var(--ink-soft)', fontWeight: 'bold' }}>Act\Pred</div>
                  <div style={{ color: 'var(--ink-soft)' }}>Normal</div>
                  <div style={{ color: 'var(--ink-soft)' }}>Device</div>
                  <div style={{ color: 'var(--ink-soft)' }}>Head</div>
                  <div style={{ color: 'var(--ink-soft)' }}>Multi</div>
                  <div style={{ color: 'var(--ink-soft)' }}>Talk</div>
                  {["Normal", "Device", "Head", "Multi", "Talk"].map((actual, rowIdx) => (
                    <React.Fragment key={rowIdx}>
                      <div style={{ color: 'var(--ink-soft)', textAlign: 'left', fontWeight: 'bold' }}>{actual}</div>
                      {BENCHMARK_MODELS[benchmarkModelIdx].confusion[rowIdx].map((val, colIdx) => {
                        const isDiagonal = rowIdx === colIdx;
                        return (
                          <div
                            key={colIdx}
                            style={{
                              padding: '8px 0',
                              borderRadius: '4px',
                              border: '1px solid transparent',
                              fontWeight: 'bold',
                              backgroundColor: isDiagonal ? 'var(--verdigris)' : 'rgba(16,22,31,0.2)',
                              color: isDiagonal ? 'var(--midnight)' : 'var(--ink-soft)',
                              borderColor: isDiagonal ? 'var(--verdigris)' : 'transparent'
                            }}
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
        ) : (
          /* Session Reports Tab — margin-column layout */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="section-title">
              <h2>Search proctoring ledger</h2>
              <span className="meta">Session historical logs</span>
            </div>

            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
              <form onSubmit={searchSessions} style={{ display: 'flex', gap: '14px', maxWidth: '480px' }}>
                <input
                  type="text"
                  required
                  placeholder="Enter student registration ID"
                  value={reportStudentId}
                  onChange={(e) => setReportStudentId(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'var(--midnight)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '13px',
                    padding: '10px 16px',
                    borderRadius: '6px',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  style={{
                    background: 'var(--oxford)',
                    color: 'var(--midnight)',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '10px 24px',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Search
                </button>
              </form>

              {searchedSessions.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <h4 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '12px', letterSpacing: '0.1em' }}>
                    Matching cohorts found
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                    {searchedSessions.map((s) => (
                      <button
                        key={s.session_id}
                        onClick={() => loadSessionReport(s.session_id)}
                        style={{
                          background: selectedSessionId === s.session_id ? 'var(--oxford)' : 'var(--midnight)',
                          color: selectedSessionId === s.session_id ? 'var(--midnight)' : 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          padding: '14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ fontWeight: 'bold' }}>{s.student_id}</div>
                        <div style={{ fontSize: '10px', opacity: 0.8 }}>ID: {s.session_id.substring(0, 12)}…</div>
                        <div style={{ fontSize: '10px', opacity: 0.8 }}>Flags: {s.alert_count}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {sessionReport && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '260px 1fr',
                gap: '32px',
                alignItems: 'start'
              }}>
                {/* Slim Left Rail */}
                <div style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '24px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11px',
                  color: 'var(--ink-soft)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600 }}>
                    Report metadata
                  </span>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>Student ID</span>
                    <strong style={{ color: 'var(--ink)', fontSize: '13px' }}>{sessionReport.student_id}</strong>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>Session Hash</span>
                    <span style={{ color: 'var(--ink)', wordBreak: 'break-all' }}>{sessionReport.session_id}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>Start Time</span>
                    <span style={{ color: 'var(--ink)' }}>{new Date(sessionReport.start_time).toLocaleString()}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>End Time</span>
                    <span style={{ color: 'var(--ink)' }}>
                      {sessionReport.end_time ? new Date(sessionReport.end_time).toLocaleString() : 'Active'}
                    </span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      onClick={exportCSV}
                      style={{
                        background: 'var(--midnight)',
                        border: '1px solid var(--line)',
                        color: 'var(--ink)',
                        borderRadius: '4px',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '10px',
                        fontFamily: "'IBM Plex Mono', monospace"
                      }}
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={() => window.print()}
                      style={{
                        background: 'var(--oxford)',
                        color: 'var(--midnight)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '10px',
                        fontWeight: 600,
                        fontFamily: "'Inter', sans-serif"
                      }}
                    >
                      Print report
                    </button>
                  </div>
                </div>

                {/* Main Content Right */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                    <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '16px', letterSpacing: '0.1em' }}>
                      Incident Timeline Chart
                    </h3>
                    {sessionReport.timeline_chart.length === 0 ? (
                      <div style={{ padding: '48px 0', textAlign: 'center', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-soft)' }}>
                        No incidents logged for this student.
                      </div>
                    ) : (
                      <div style={{ height: '220px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={sessionReport.timeline_chart} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                            <XAxis dataKey="elapsed_seconds" stroke="var(--ink-soft)" fontSize={9} tickFormatter={(val) => `${val}s`} />
                            <YAxis stroke="var(--ink-soft)" fontSize={9} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                            <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                            <Area type="monotone" dataKey="confidence" name="Incident Conf." stroke="var(--seal)" fill="var(--seal)" fillOpacity={0.08} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                    <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '16px', letterSpacing: '0.1em' }}>
                      Incident logs ({sessionReport.total_alerts})
                    </h3>
                    {sessionReport.alerts.length === 0 ? (
                      <div style={{ padding: '32px 0', textAlign: 'center', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-soft)' }}>
                        Clean ledger. Zero flags.
                      </div>
                    ) : (
                      <div className="incident-list">
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
                            className="incident"
                          >
                            <div className="incident-icon">✕</div>
                            <div className="incident-body">
                              <div className="incident-top">
                                <span className="student-badge">{sessionReport.student_id}</span>
                                <div className="flex items-center gap-2">
                                  {a.video_clip_path && (
                                    <span style={{
                                      fontFamily: "'IBM Plex Mono', monospace",
                                      fontSize: "8px",
                                      border: "1px solid var(--oxford)",
                                      color: "var(--oxford)",
                                      borderRadius: "4px",
                                      padding: "1px 4px",
                                      fontWeight: 600
                                    }}>
                                      CLIP
                                    </span>
                                  )}
                                  <span className="incident-time">
                                    {new Date(a.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                              </div>
                              <div className="incident-type">{a.anomaly_type}</div>
                              <div className="incident-conf">
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
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(16,22,31,0.85)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '640px',
            backgroundColor: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--line)',
              backgroundColor: 'rgba(16,22,31,0.3)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h3 style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: 'var(--ink)',
                  textTransform: 'uppercase',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  Ledger Item Evidence
                </h3>
                <span style={{ fontSize: '10px', color: 'var(--ink-soft)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Student: {selectedAlert.student_id}
                </span>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                style={{
                  background: 'var(--midnight)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink-soft)',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace"
                }}
              >
                Close
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px', display: 'flex', gap: '24px', flexDirection: 'column' }}>
              <div style={{ width: '100%' }}>
                {selectedAlert.video_clip_path ? (
                  <div style={{ border: '1px solid var(--line)', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#000', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <video
                      src={`http://localhost:8000${selectedAlert.video_clip_path}`}
                      controls
                      autoPlay
                      style={{ width: '100%', height: '100%', objectFit: 'contain', outline: 'none' }}
                    />
                  </div>
                ) : selectedAlert.frame_path ? (
                  <div style={{ border: '1px solid var(--line)', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#000', aspectRatio: '16/9' }}>
                    <img
                      src={`http://localhost:8000${selectedAlert.frame_path}`}
                      alt="Evidence Frame"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--line)', borderRadius: '4px', backgroundColor: 'var(--midnight)', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace" }}>
                    No visual keyframe recorded.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>Incident Class</span>
                    <span style={{ fontFamily: "'Newsreader', serif", fontSize: '16px', fontWeight: 'bold', color: 'var(--seal)' }}>
                      {selectedAlert.anomaly_type}
                    </span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>Confidence</span>
                    <strong style={{ color: 'var(--ink)' }}>{selectedAlert.confidence}%</strong>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', opacity: 0.7 }}>Timestamp</span>
                    <span style={{ color: 'var(--ink)' }}>{new Date(selectedAlert.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '180px' }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
                    Verification Action
                  </span>
                  
                  {selectedAlert.override_status === "confirmed" ? (
                    <div style={{
                      backgroundColor: 'rgba(193, 97, 107, 0.12)',
                      border: '1px solid var(--seal)',
                      borderRadius: '4px',
                      padding: '10px',
                      color: 'var(--seal)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      fontWeight: 'bold',
                      textAlign: 'center'
                    }}>
                      ✓ VIOLATION CONFIRMED
                    </div>
                  ) : selectedAlert.override_status === "dismissed" ? (
                    <div style={{
                      backgroundColor: 'rgba(36,44,56,0.3)',
                      border: '1px solid var(--line)',
                      borderRadius: '4px',
                      padding: '10px',
                      color: 'var(--ink-soft)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      fontWeight: 'bold',
                      textAlign: 'center',
                      textDecoration: 'line-through'
                    }}>
                      ✗ DISMISSED (FALSE ALARM)
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <button
                        onClick={() => handleAlertOverride("confirmed")}
                        style={{
                          width: '100%',
                          background: 'var(--seal)',
                          color: 'var(--paper)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '10px',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '10px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Confirm Violation
                      </button>
                      <button
                        onClick={() => handleAlertOverride("dismissed")}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: '1px solid var(--line)',
                          color: 'var(--ink-soft)',
                          borderRadius: '4px',
                          padding: '9px',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
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
      )}

      {/* FOOTER */}
      <footer style={{
        textAlign: 'center',
        padding: '24px',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: '10px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-soft)',
        borderTop: '1px solid var(--line)',
        backgroundColor: 'var(--panel)'
      }}>
        ExamGuard AI Invigilation Dashboard · Full Stack Integrity Control
      </footer>
    </div>
  );
}

// Utility to handle rounding cleanly in inline TSX
function round(value: number, decimals: number) {
  return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}
