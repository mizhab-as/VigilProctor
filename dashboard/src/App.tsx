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
  session_id: string;
  student_id: string;
  anomaly_type: string;
  confidence: number;
  timestamp: string;
  thumbnail_path: string | null;
  frame_path: string | null;
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
  }>;
  timeline_chart: Array<{
    elapsed_seconds: number;
    anomaly_type: string;
    confidence: number;
  }>;
}

export default function App() {
  // Authentication Gate
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Views: "live" or "reports"
  const [currentView, setCurrentView] = useState<"live" | "reports">("live");

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
          session_id: data.session_id,
          student_id: data.student_id,
          anomaly_type: data.anomaly_type,
          confidence: data.confidence,
          timestamp: data.timestamp,
          thumbnail_path: data.thumbnail_path,
          frame_path: data.frame_path
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
      // Find matching sessions. We fetch active ones and also completed ones if needed.
      // For a simple mock search, we fetch active sessions and filter, or hit DB.
      // Since we want to make it comprehensive, we fetch active + queries.
      // Let's create an endpoint on backend or query database. In this case,
      // we will look up database logs via search parameters. We fetch from backend:
      const res = await fetch(`http://localhost:8000/session/active`);
      if (res.ok) {
        const data: ActiveSession[] = await res.json();
        const matches = data.filter(s => 
          s.student_id.toLowerCase().includes(reportStudentId.toLowerCase())
        );
        setSearchedSessions(matches);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Generate and download CSV
  const exportCSV = () => {
    if (!sessionReport) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Alert ID,Timestamp,Violation Type,Confidence (%)\n";

    sessionReport.alerts.forEach((a) => {
      const row = `${a.id},${a.timestamp},"${a.anomaly_type}",${a.confidence * 100}`;
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ExamGuard_Report_${sessionReport.student_id}_${sessionReport.session_id.substring(0,8)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950 font-sans">
        <div className="w-full max-w-md glass-panel glow-indigo rounded-3xl p-8 space-y-6">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/5">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-100">
              ExamGuard AI Gateway
            </h1>
            <p className="text-xs text-slate-400">
              Invigilator Control Panel Authentication Gate
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Invigilator Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Security Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="admin123"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 font-mono text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" /> Authenticate Session
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
                            <span className="text-[9px] text-slate-500 font-mono">
                              {new Date(alert.timestamp).toLocaleTimeString()}
                            </span>
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
                              <div className="font-bold text-slate-200 flex items-center gap-1">
                                {isTabSwitch ? (
                                  <XOctagon className="w-3.5 h-3.5 text-rose-500" />
                                ) : (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                )}
                                {alert.anomaly_type}
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
                      <button
                        onClick={exportCSV}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow"
                      >
                        <Download className="w-3.5 h-3.5" /> Export logs (CSV)
                      </button>
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
                            onClick={() => a.thumbnail_path && setSelectedAlert({
                              session_id: sessionReport.session_id,
                              student_id: sessionReport.student_id,
                              anomaly_type: a.anomaly_type,
                              confidence: a.confidence * 100,
                              timestamp: a.timestamp,
                              thumbnail_path: a.thumbnail_path,
                              frame_path: a.frame_path
                            })}
                            className="p-3 bg-slate-950/70 border border-slate-850 hover:border-slate-800 rounded-xl text-xs cursor-pointer flex gap-3 transition-all"
                          >
                            {a.thumbnail_path && (
                              <img
                                src={`http://localhost:8000${a.thumbnail_path}`}
                                alt="incident preview"
                                className="w-12 h-10 object-cover rounded-lg border border-slate-850 bg-slate-950 shrink-0"
                              />
                            )}
                            <div className="flex-1 space-y-0.5">
                              <div className="font-bold text-slate-200">{a.anomaly_type}</div>
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
              {selectedAlert.frame_path && (
                <div className="flex-1 border border-slate-900 rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center">
                  <img
                    src={`http://localhost:8000${selectedAlert.frame_path}`}
                    alt="evidence frame"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

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
