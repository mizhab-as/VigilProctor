import React, { useState, useEffect } from "react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from "recharts";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const WS_BASE = (import.meta.env.VITE_WS_URL || API_BASE.replace(/^http/, "ws")).replace(/\/$/, "");

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
  score?: string | null;
  percentage?: number | null;
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

export default function App() {
  // Authentication Gate
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Views: "live", "reports", "questions", or "students"
  const [currentView, setCurrentView] = useState<"live" | "reports" | "questions" | "students">("live");

  // Live webcam feeds from students (keyed by session_id)
  const [liveFeeds, setLiveFeeds] = useState<Record<string, string>>({});

  // Student directory state
  const [studentsList, setStudentsList] = useState<{student_id: string; student_name: string; passcode: string; class_group: string | null}[]>([]);
  const [uploadingStudents, setUploadingStudents] = useState(false);
  const [studentsUploadStatus, setStudentsUploadStatus] = useState("");
  const [customGroupName, setCustomGroupName] = useState("");       // user-typed class group override
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set()); // which group panels are open
  const [showUngrouped, setShowUngrouped] = useState(false);         // toggle to reveal ungrouped students

  // Question management state
  const [questionsList, setQuestionsList] = useState<{id: number; exam_id: string; text: string; options: string[]; correct_option_idx?: number}[]>([]);
  const [newQuestion, setNewQuestion] = useState({ text: '', options: ['', '', '', ''], correct_option_idx: 0 });
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [uploadingQuestions, setUploadingQuestions] = useState(false);
  const [questionsUploadStatus, setQuestionsUploadStatus] = useState("");
  const [questionActionStatus, setQuestionActionStatus] = useState("");

  // Exam management state
  const [examsList, setExamsList] = useState<{id: string; title: string; description?: string; active?: boolean}[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("default");
  const [newExam, setNewExam] = useState({ id: "", title: "", description: "" });
  const [creatingExam, setCreatingExam] = useState(false);
  const [examCreateStatus, setExamCreateStatus] = useState("");
  const [examStats, setExamStats] = useState<{total_completed: number; top_score: string; average_percentage: number; pass_rate: number} | null>(null);

  // Live state
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<AlertPayload[]>([]);

  // Selected details for modal view
  const [selectedAlert, setSelectedAlert] = useState<AlertPayload | null>(null);

  // Selected student in Live Monitor for detail drawer
  const [selectedStudent, setSelectedStudent] = useState<ActiveSession | null>(null);

  // Reports state
  const [allSessions, setAllSessions] = useState<{
    session_id: string;
    student_id: string;
    exam_id?: string;
    start_time: string;
    end_time?: string;
    status: string;
    score?: string;
    percentage?: number;
    alert_count: number;
    status_color: string;
  }[]>([]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [sessionStatusFilter, setSessionStatusFilter] = useState<"all" | "in_progress" | "completed">("all");
  const [selectedSessionId, setSelectedSessionId] = useState("");
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
        const res = await fetch(`${API_BASE}/session/active`);
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

    // Connect to dashboard alerts WebSocket with auto-reconnect
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWS = () => {
      socket = new WebSocket(`${WS_BASE}/dashboard/alerts`);

      socket.onopen = () => {
        console.log("[DASHBOARD] Alerts WebSocket connected.");
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
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
      } else if (data.type === "live_feed") {
        // Update live feed thumbnail for this student session
        setLiveFeeds((prev) => ({ ...prev, [data.session_id]: data.frame }));
      } else if (data.type === "session_status") {
        // A student session started or ended, trigger active fetch immediately
        fetchActive();
        // Clear live feed for ended session
        if (data.status === "completed") {
          setLiveFeeds((prev) => { const next = {...prev}; delete next[data.session_id]; return next; });
        }
      }
    };

      socket.onclose = () => {
        console.log("[DASHBOARD] Alerts WebSocket disconnected. Reconnecting in 3s...");
        reconnectTimer = setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      clearInterval(interval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [isAuthenticated]);

  // Fetch the full questions list for management view, filtered by exam ID
  const fetchQuestions = async (examId = selectedExamId) => {
    try {
      const res = await fetch(`${API_BASE}/questions?exam_id=${encodeURIComponent(examId)}`);
      if (res.ok) setQuestionsList(await res.json());
    } catch (err) { console.error("Failed to load questions:", err); }
  };

  // Fetch available exams list
  const fetchExams = async () => {
    try {
      const res = await fetch(`${API_BASE}/exams`);
      if (res.ok) {
        const data = await res.json();
        setExamsList(data);
        if (data.length > 0) {
          setSelectedExamId(prev => (!prev || !data.some((e: any) => e.id === prev) ? data[0].id : prev));
        } else {
          setSelectedExamId("");
        }
      }
    } catch (err) { console.error("Failed to load exams:", err); }
  };

  // Fetch metrics/statistics for active exam cohort
  const fetchExamStats = async (examId = selectedExamId) => {
    if (!examId) { setExamStats(null); return; }
    try {
      const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/stats`);
      if (res.ok) {
        const data = await res.json();
        setExamStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch exam stats:", err);
    }
  };

  // Toggle active/inactive status of chosen exam cohort
  const toggleActiveExam = async () => {
    if (!selectedExamId) return;
    try {
      const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(selectedExamId)}/toggle-active`, {
        method: "POST"
      });
      if (res.ok) {
        await fetchExams();
      }
    } catch (err) {
      console.error("Failed to toggle exam status:", err);
    }
  };

  // Fetch authorized students list
  const fetchStudents = async () => {
    try {
      const res = await fetch(`${API_BASE}/students`);
      if (res.ok) setStudentsList(await res.json());
    } catch (err) {
      console.error("Failed to load students:", err);
    }
  };

  // Fetch all sessions (live & past)
  const fetchAllSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/sessions`);
      if (res.ok) setAllSessions(await res.json());
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchStudents();
      fetchExams();
      fetchAllSessions();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && currentView === "reports") {
      fetchAllSessions();
    }
  }, [currentView, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && selectedExamId) {
      fetchQuestions(selectedExamId);
      fetchExamStats(selectedExamId);
    } else if (!selectedExamId) {
      setQuestionsList([]);
      setExamStats(null);
    }
  }, [selectedExamId, isAuthenticated]);

  // Upload students CSV file
  const handleStudentsCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingStudents(true);
    setStudentsUploadStatus("");
    const formData = new FormData();
    formData.append("file", file);
    if (customGroupName.trim()) {
      formData.append("class_group_override", customGroupName.trim());
    }

    try {
      const res = await fetch(`${API_BASE}/students/upload`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setStudentsUploadStatus(`Success: ${data.message}`);
        // Auto-expand the newly uploaded group
        if (data.class_group) {
          setExpandedGroups(prev => new Set([...prev, data.class_group]));
        }
        fetchStudents();
      } else {
        setStudentsUploadStatus(`Error: ${data.detail || "Upload failed."}`);
      }
    } catch (err) {
      setStudentsUploadStatus("Error: Failed to connect to server.");
    } finally {
      setUploadingStudents(false);
      e.target.value = "";
    }
  };

  // Upload questions file (JSON/CSV)
  const handleQuestionsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingQuestions(true);
    setQuestionsUploadStatus("");
    const formData = new FormData();
    formData.append("file", file);
    if (selectedExamId) {
      formData.append("exam_id", selectedExamId);
    }

    try {
      const res = await fetch(`${API_BASE}/questions/upload`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setQuestionsUploadStatus(`Success: ${data.message}`);
        const uploadedExamId = data.exam_id || selectedExamId;
        setSelectedExamId(uploadedExamId);
        await fetchExams();
        await fetchQuestions(uploadedExamId);
        await fetchExamStats(uploadedExamId);
      } else {
        setQuestionsUploadStatus(`Error: ${data.detail || "Questions upload failed."}`);
      }
    } catch (err) {
      setQuestionsUploadStatus("Error: Failed to upload questions.");
    } finally {
      setUploadingQuestions(false);
      e.target.value = "";
    }
  };

  // Submit a new question
  const submitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestion.text.trim() || newQuestion.options.some(o => !o.trim())) return;
    setSavingQuestion(true);
    try {
      const res = await fetch(`${API_BASE}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          text: newQuestion.text, 
          options: newQuestion.options,
          correct_option_idx: newQuestion.correct_option_idx,
          exam_id: selectedExamId
        })
      });
      if (res.ok) {
        setNewQuestion({ text: '', options: ['', '', '', ''], correct_option_idx: 0 });
        await fetchQuestions(selectedExamId);
      }
    } catch (err) { console.error("Failed to save question:", err); }
    setSavingQuestion(false);
  };

  // Create a new exam
  const submitExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const createdId = newExam.id.trim();
    if (!createdId || !newExam.title.trim()) return;
    setCreatingExam(true);
    setExamCreateStatus("");
    try {
      const res = await fetch(`${API_BASE}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: createdId,
          title: newExam.title.trim(),
          description: newExam.description.trim() || null
        })
      });
      const data = await res.json();
      if (res.ok) {
        setExamCreateStatus(`Success: Exam '${newExam.title}' created.`);
        setNewExam({ id: "", title: "", description: "" });
        setSelectedExamId(createdId);
        await fetchExams();
        await fetchQuestions(createdId);
        await fetchExamStats(createdId);
      } else {
        setExamCreateStatus(`Error: ${data.detail || "Failed to create exam."}`);
      }
    } catch (err) {
      setExamCreateStatus("Error: Failed to connect to server.");
    } finally {
      setCreatingExam(false);
    }
  };

  const deleteSingleQuestion = async (qId: number) => {
    // Optimistic local update
    setQuestionsList(prev => prev.filter(q => q.id !== qId));
    setQuestionActionStatus("Deleting question…");
    try {
      const res = await fetch(`${API_BASE}/questions/${qId}`, { method: "DELETE" });
      if (res.ok) {
        setQuestionActionStatus(`Question #${qId} deleted.`);
        setTimeout(() => setQuestionActionStatus(""), 3000);
      } else {
        fetchQuestions(selectedExamId); // revert if backend failed
        setQuestionActionStatus("Error: Failed to delete question on server.");
      }
    } catch (err) {
      console.error("Error deleting question:", err);
      fetchQuestions(selectedExamId);
      setQuestionActionStatus("Error: Failed to connect to server.");
    }
  };

  const clearAllQuestionsForExam = async (examId: string) => {
    const qCount = questionsList.length;
    setQuestionsList([]);
    setQuestionActionStatus(`Clearing ${qCount} questions…`);
    try {
      const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/questions`, { method: "DELETE" });
      if (res.ok) {
        setQuestionActionStatus(`Successfully deleted all questions for exam '${examId}'.`);
        setTimeout(() => setQuestionActionStatus(""), 4000);
        await fetchQuestions(examId);
      } else {
        await fetchQuestions(examId);
        setQuestionActionStatus("Error: Failed to clear question set on server.");
      }
    } catch (err) {
      console.error("Error clearing questions:", err);
      await fetchQuestions(examId);
      setQuestionActionStatus("Error: Failed to connect to server.");
    }
  };

  const deleteExamCohort = async (examId: string) => {
    if (!examId) return;
    setQuestionActionStatus(`Deleting exam cohort '${examId}'…`);
    try {
      const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}`, { method: "DELETE" });
      if (res.ok) {
        setQuestionActionStatus(`Successfully deleted exam cohort '${examId}'.`);
        setTimeout(() => setQuestionActionStatus(""), 4000);
        const updatedExamsRes = await fetch(`${API_BASE}/exams`);
        if (updatedExamsRes.ok) {
          const updatedList = await updatedExamsRes.json();
          setExamsList(updatedList);
          const nextExamId = updatedList.length > 0 ? updatedList[0].id : "";
          setSelectedExamId(nextExamId);
          if (nextExamId) {
            await fetchQuestions(nextExamId);
            await fetchExamStats(nextExamId);
          } else {
            setQuestionsList([]);
            setExamStats(null);
          }
        }
      } else {
        const data = await res.json();
        setQuestionActionStatus(`Error: ${data.detail || "Failed to delete exam cohort."}`);
      }
    } catch (err) {
      console.error("Error deleting exam cohort:", err);
      setQuestionActionStatus("Error: Failed to connect to server.");
    }
  };

  // Load report data for specific session
  const loadSessionReport = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    try {
      const res = await fetch(`${API_BASE}/session/${sessionId}/report`);
      if (res.ok) {
        const data = await res.json();
        setSessionReport(data);
      }
    } catch (err) {
      alert("Failed to load historical report details.");
      console.error(err);
    }
  };

  // Clear all session history from DB
  const clearAllSessions = async () => {
    if (!confirm("Are you sure you want to clear ALL student session history and flags from the database? This action cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/sessions`, { method: "DELETE" });
      if (res.ok) {
        setAllSessions([]);
        setSessionReport(null);
        setSelectedSessionId("");
        alert("All student session history cleared successfully.");
      }
    } catch (err) {
      console.error("Failed to clear sessions:", err);
    }
  };

  // Clear all session history for a specific student
  const clearStudentSessions = async (studentId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`Are you sure you want to clear all exam sessions for student '${studentId}'?`)) return;
    try {
      const res = await fetch(`${API_BASE}/sessions/student/${encodeURIComponent(studentId)}`, { method: "DELETE" });
      if (res.ok) {
        setAllSessions((prev) => prev.filter(s => s.student_id !== studentId));
        if (sessionReport?.student_id === studentId) {
          setSessionReport(null);
          setSelectedSessionId("");
        }
      }
    } catch (err) {
      console.error(`Failed to clear sessions for student ${studentId}:`, err);
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
      const res = await fetch(`${API_BASE}/session/${selectedAlert.session_id}/alert/${selectedAlert.id}/override`, {
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
            onClick={() => setCurrentView("reports")}
            className={currentView === "reports" ? "active" : ""}
          >
            Session Reports
          </button>
          <button
            onClick={() => { setCurrentView("questions"); fetchQuestions(); }}
            className={currentView === "questions" ? "active" : ""}
          >
            Manage Questions
          </button>
          <button
            onClick={() => { setCurrentView("students"); fetchStudents(); }}
            className={currentView === "students" ? "active" : ""}
          >
            Manage Students
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
          <>
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
                    onClick={() => setSelectedStudent(session)}
                    style={{
                      cursor: 'pointer',
                      "--status-color":
                        session.status_color === "red"
                          ? "var(--seal)"
                          : session.status_color === "yellow"
                          ? "var(--gold)"
                          : "var(--verdigris)"
                    } as React.CSSProperties}
                  >
                    {/* Live feed thumbnail from heartbeat */}
                    {liveFeeds[session.session_id] ? (
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <img
                          src={liveFeeds[session.session_id]}
                          alt="Live feed"
                          style={{
                            width: '100%',
                            aspectRatio: '4/3',
                            objectFit: 'cover',
                            borderRadius: 4,
                            border: '1px solid var(--line)',
                            transform: 'scaleX(-1)'
                          }}
                        />
                        <span style={{
                          position: 'absolute', top: 6, right: 6,
                          fontFamily: "'IBM Plex Mono', monospace", fontSize: 8,
                          background: 'var(--seal)', color: '#fff',
                          padding: '2px 5px', borderRadius: 3, textTransform: 'uppercase',
                          fontWeight: 700, letterSpacing: '0.1em'
                        }}>Live</span>
                      </div>
                    ) : (
                      <div style={{
                        width: '100%', aspectRatio: '4/3',
                        background: 'rgba(16,22,31,0.5)',
                        border: '1px dashed var(--line)',
                        borderRadius: 4, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        marginBottom: 8, color: 'var(--ink-soft)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em'
                      }}>Awaiting feed…</div>
                    )}
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
                        {new Date(session.start_time).toLocaleTimeString()}
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

            <div style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              {liveAlerts.length === 0 ? (
                <div style={{
                  padding: "48px",
                  textAlign: "center",
                  color: "var(--ink-soft)",
                  fontSize: "13px",
                  fontStyle: "italic"
                }}>
                  Listening for incoming telemetry incidents…
                </div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: '380px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace" }}>
                    <thead>
                      <tr style={{ background: 'var(--midnight)', borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
                        <th style={{ padding: '12px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Time</th>
                        <th style={{ padding: '12px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Student ID</th>
                        <th style={{ padding: '12px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Incident Class</th>
                        <th style={{ padding: '12px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Confidence</th>
                        <th style={{ padding: '12px 16px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, textAlign: 'right' }}>Evidence</th>
                      </tr>
                    </thead>
                    <tbody style={{ color: 'var(--ink)' }}>
                      {liveAlerts.map((alert, index) => (
                        <tr
                          key={index}
                          onClick={() => alert.thumbnail_path && setSelectedAlert(alert)}
                          style={{
                            borderBottom: '1px solid var(--line)',
                            cursor: alert.thumbnail_path ? 'pointer' : 'default',
                            transition: 'background .15s',
                          }}
                          className="incident-row"
                        >
                          <td style={{ padding: '12px 16px', color: 'var(--ink-soft)' }}>
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </td>
                          <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                            <span style={{
                              color: 'var(--oxford)',
                              background: 'rgba(110, 147, 190, 0.12)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px'
                            }}>
                              {alert.student_id}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontWeight: 500, fontFamily: "'Inter', sans-serif" }}>
                            {alert.anomaly_type.replace(/Security Warning:\s*/i, "").replace(/!+$/, "")}
                          </td>
                          <td style={{ padding: '12px 16px', color: alert.confidence > 75 ? 'var(--seal)' : 'var(--gold)' }}>
                            {alert.confidence}%
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                              {alert.video_clip_path && (
                                <span style={{
                                  fontSize: "8.5px",
                                  border: "1px solid var(--oxford)",
                                  color: "var(--oxford)",
                                  borderRadius: "4px",
                                  padding: "1px 5px",
                                  fontWeight: 600
                                }}>
                                  CLIP
                                </span>
                              )}
                              {alert.thumbnail_path && (
                                <span style={{
                                  fontSize: "8.5px",
                                  border: "1px solid var(--verdigris)",
                                  color: "var(--verdigris)",
                                  borderRadius: "4px",
                                  padding: "1px 5px",
                                  fontWeight: 600
                                }}>
                                  FRAME
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Student Detail Drawer */}
          {selectedStudent && (
            <div style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
              background: 'var(--panel)', borderLeft: '1px solid var(--line)',
              zIndex: 200, display: 'flex', flexDirection: 'column',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.4)'
            }}>
              {/* Drawer header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, textTransform: 'uppercase', color: 'var(--gold)', letterSpacing: '0.15em', marginBottom: 4 }}>Live student</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{selectedStudent.student_id}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-soft)', marginTop: 2 }}>{selectedStudent.session_id.substring(0, 20)}…</div>
                </div>
                <button onClick={() => setSelectedStudent(null)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 12px', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>Close</button>
              </div>

              {/* Live feed thumbnail */}
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.1em', marginBottom: 10 }}>Live webcam feed</div>
                {liveFeeds[selectedStudent.session_id] ? (
                  <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
                    <img
                      src={liveFeeds[selectedStudent.session_id]}
                      alt="Live student feed"
                      style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', transform: 'scaleX(-1)' }}
                    />
                    <span style={{ position: 'absolute', top: 8, left: 8, background: 'var(--seal)', color: '#fff', fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '3px 7px', borderRadius: 4 }}>● Live</span>
                  </div>
                ) : (
                  <div style={{ aspectRatio: '4/3', border: '1px dashed var(--line)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, textTransform: 'uppercase' }}>
                    Awaiting first heartbeat…
                  </div>
                )}
              </div>

              {/* Session stats */}
              <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ background: 'var(--midnight)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 4 }}>Flags</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: selectedStudent.alert_count > 3 ? 'var(--seal)' : selectedStudent.alert_count > 0 ? 'var(--gold)' : 'var(--verdigris)' }}>{selectedStudent.alert_count}</div>
                </div>
                <div style={{ background: 'var(--midnight)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 4 }}>Started</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{new Date(selectedStudent.start_time).toLocaleTimeString()}</div>
                </div>
              </div>

              {/* Per-student incident log */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px' }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.1em', marginBottom: 12 }}>Incident log</div>
                {liveAlerts.filter(a => a.session_id === selectedStudent.session_id).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink-soft)', fontSize: 12, fontStyle: 'italic' }}>No incidents logged yet.</div>
                ) : (
                  liveAlerts.filter(a => a.session_id === selectedStudent.session_id).map((alert, i) => (
                    <div key={i} style={{ background: 'var(--midnight)', border: '1px solid var(--line)', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--seal)', textTransform: 'uppercase', fontWeight: 700 }}>Flag #{i + 1}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-soft)' }}>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>{alert.anomaly_type}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-soft)', marginTop: 4 }}>Conf: {alert.confidence}%</div>
                    </div>
                  ))
                )}
              </div>

              {/* View full report button */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)' }}>
                <button
                  onClick={() => { setCurrentView('reports'); loadSessionReport(selectedStudent.session_id); setSelectedStudent(null); }}
                  style={{ width: '100%', background: 'var(--oxford)', color: 'var(--midnight)', border: 'none', borderRadius: 6, padding: '11px', fontFamily: "'Inter', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  View full proctoring report →
                </button>
              </div>
            </div>
          )}
          </>
        ) : currentView === "questions" ? (
          /* Questions Management Tab */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="section-title">
              <h2>Exam question bank</h2>
              <span className="meta">{questionsList.length} questions stored</span>
            </div>

            {questionActionStatus && (
              <div style={{
                background: questionActionStatus.startsWith("Error") ? 'rgba(140, 47, 57, 0.15)' : 'rgba(75, 122, 107, 0.15)',
                color: questionActionStatus.startsWith("Error") ? '#FF6B6B' : 'var(--verdigris)',
                border: questionActionStatus.startsWith("Error") ? '1px solid rgba(255, 107, 107, 0.3)' : '1px solid var(--verdigris)',
                borderRadius: '6px', padding: '12px 18px', fontSize: '13px',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                {questionActionStatus}
              </div>
            )}

            {examsList.length === 0 || selectedExamId === "__new__" ? (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '36px', maxWidth: '640px', margin: '20px auto', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', textTransform: 'uppercase', color: 'var(--gold)', margin: 0, letterSpacing: '0.1em' }}>
                    {examsList.length === 0 ? "Create Your First Exam Cohort" : "Create New Exam Cohort"}
                  </h3>
                  {examsList.length > 0 && (
                    <button
                      onClick={() => setSelectedExamId(examsList[0]?.id || "default")}
                      style={{ background: 'none', border: '1px solid var(--line)', borderRadius: '4px', color: 'var(--ink-soft)', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                      ← Back to Exams
                    </button>
                  )}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: '24px' }}>
                  {examsList.length === 0
                    ? "No exams exist yet in the system. Fill out the details below to create your first exam cohort, then you can manage questions and authorized students."
                    : "Enter the details for your new exam cohort below. Once created, it will become active and available for student registration and question setup."
                  }
                </p>
                <form onSubmit={submitExam} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', letterSpacing: '0.1em', marginBottom: 6 }}>Exam ID (Unique Identifier)</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., exam_ai"
                      value={newExam.id}
                      onChange={(e) => setNewExam((prev) => ({ ...prev, id: e.target.value }))}
                      style={{
                        width: '100%', background: 'var(--midnight)', border: '1px solid var(--line)',
                        color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                        padding: '10px 14px', borderRadius: '6px', outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', letterSpacing: '0.1em', marginBottom: 6 }}>Exam Title</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., AI Fundamentals Exam"
                      value={newExam.title}
                      onChange={(e) => setNewExam((prev) => ({ ...prev, title: e.target.value }))}
                      style={{
                        width: '100%', background: 'var(--midnight)', border: '1px solid var(--line)',
                        color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                        padding: '10px 14px', borderRadius: '6px', outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.1em', marginBottom: 6 }}>Description (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g., General Artificial Intelligence Proctoring Cohort"
                      value={newExam.description}
                      onChange={(e) => setNewExam((prev) => ({ ...prev, description: e.target.value }))}
                      style={{
                        width: '100%', background: 'var(--midnight)', border: '1px solid var(--line)',
                        color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                        padding: '10px 14px', borderRadius: '6px', outline: 'none'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                    <button
                      type="submit"
                      disabled={creatingExam}
                      style={{
                        background: 'var(--oxford)', color: 'var(--midnight)',
                        border: 'none', borderRadius: '6px', padding: '12px 28px',
                        fontFamily: "'Inter', sans-serif", fontSize: '13px', fontWeight: 600,
                        cursor: creatingExam ? 'not-allowed' : 'pointer', opacity: creatingExam ? 0.6 : 1
                      }}
                    >
                      {creatingExam ? 'Creating Exam…' : 'Create Exam Cohort'}
                    </button>
                    {examCreateStatus && (
                      <span style={{
                        fontSize: '12px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: examCreateStatus.startsWith("Success") ? 'var(--verdigris)' : 'var(--seal)'
                      }}>
                        {examCreateStatus}
                      </span>
                    )}
                  </div>
                </form>
              </div>
            ) : (
              <>
                {/* Exam Cohorts Directory Deck */}
                {(() => {
                  const activeExams = examsList.filter((e) => e.active);
                  const pastExams = examsList.filter((e) => !e.active);
                  return (
                    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--gold)', margin: 0, letterSpacing: '0.1em' }}>
                          Exam Cohorts Directory ({examsList.length} total • {activeExams.length} active • {pastExams.length} past)
                        </h3>
                        <span style={{ fontSize: '11px', color: 'var(--ink-soft)', fontFamily: "'IBM Plex Mono', monospace" }}>
                          Selected: <strong style={{ color: 'var(--verdigris)' }}>{selectedExamId}</strong>
                        </span>
                      </div>

                      {/* Active Exams */}
                      <div>
                        <span style={{ display: 'block', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', color: 'var(--verdigris)', letterSpacing: '0.1em', marginBottom: '8px' }}>
                          🟢 Active Exam Cohorts ({activeExams.length})
                        </span>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          {activeExams.map((exam) => {
                            const isSelected = exam.id === selectedExamId;
                            return (
                              <button
                                key={exam.id}
                                onClick={() => setSelectedExamId(exam.id)}
                                style={{
                                  background: isSelected ? 'var(--oxford)' : 'var(--midnight)',
                                  color: isSelected ? 'var(--midnight)' : 'var(--ink)',
                                  border: isSelected ? '1px solid var(--oxford)' : '1px solid var(--line)',
                                  borderRadius: '6px', padding: '8px 14px', fontSize: '12px',
                                  fontWeight: isSelected ? 700 : 500, cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.15s ease'
                                }}
                              >
                                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--verdigris)' }}></span>
                                <span>{exam.title}</span>
                                <span style={{ opacity: 0.6, fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>({exam.id})</span>
                              </button>
                            );
                          })}
                          {activeExams.length === 0 && (
                            <span style={{ fontSize: '12px', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No active exam cohorts.</span>
                          )}
                        </div>
                      </div>

                      {/* Past / Archived Exams */}
                      {pastExams.length > 0 && (
                        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
                          <span style={{ display: 'block', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', color: 'var(--seal)', letterSpacing: '0.1em', marginBottom: '8px' }}>
                            🔴 Past / Archived Exam Cohorts ({pastExams.length})
                          </span>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {pastExams.map((exam) => {
                              const isSelected = exam.id === selectedExamId;
                              return (
                                <div key={exam.id} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <button
                                    onClick={() => setSelectedExamId(exam.id)}
                                    style={{
                                      background: isSelected ? 'rgba(140, 47, 57, 0.3)' : 'var(--midnight)',
                                      color: isSelected ? '#FF6B6B' : 'var(--ink-soft)',
                                      border: isSelected ? '1px solid rgba(255, 107, 107, 0.4)' : '1px solid var(--line)',
                                      borderRadius: '6px 0 0 6px', padding: '8px 12px', fontSize: '12px',
                                      fontWeight: isSelected ? 700 : 500, cursor: 'pointer',
                                      display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.15s ease'
                                    }}
                                  >
                                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--seal)' }}></span>
                                    <span>{exam.title}</span>
                                    <span style={{ opacity: 0.6, fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>({exam.id})</span>
                                  </button>
                                  <button
                                    onClick={() => deleteExamCohort(exam.id)}
                                    title={`Delete past exam '${exam.id}'`}
                                    style={{
                                      background: 'rgba(140, 47, 57, 0.2)', color: '#FF6B6B',
                                      border: '1px solid var(--line)', borderLeft: 'none',
                                      borderRadius: '0 6px 6px 0', padding: '8px 10px', fontSize: '11px',
                                      cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace"
                                    }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Create New Exam Action */}
                      <div style={{ borderTop: '1px dashed var(--line)', paddingTop: '10px', display: 'flex', justifyContent: 'flex-start' }}>
                        <button
                          onClick={() => setSelectedExamId("__new__")}
                          style={{
                            background: 'rgba(46, 196, 182, 0.15)', color: 'var(--verdigris)',
                            border: '1px dashed var(--verdigris)', borderRadius: '6px',
                            padding: '8px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '6px',
                            fontFamily: "'IBM Plex Mono', monospace", transition: 'all 0.15s ease'
                          }}
                        >
                          + Create New Exam Cohort
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Exam selection and primary actions block */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                  {/* Select active exam cohort */}
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: '14px', letterSpacing: '0.1em' }}>
                        Select Active / Past Exam Cohort
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <select
                          value={selectedExamId}
                          onChange={(e) => setSelectedExamId(e.target.value)}
                          style={{
                            width: '100%', background: 'var(--midnight)', border: '1px solid var(--line)',
                            color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                            padding: '10px 14px', borderRadius: '6px', outline: 'none', cursor: 'pointer'
                          }}
                        >
                          <optgroup label="Active Exam Cohorts">
                            {examsList.filter(e => e.active).map((exam) => (
                              <option key={exam.id} value={exam.id}>
                                🟢 {exam.title} ({exam.id})
                              </option>
                            ))}
                          </optgroup>
                          {examsList.some(e => !e.active) && (
                            <optgroup label="Past / Archived Exam Cohorts">
                              {examsList.filter(e => !e.active).map((exam) => (
                                <option key={exam.id} value={exam.id}>
                                  🔴 [Past] {exam.title} ({exam.id})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <option value="__new__">+ Create New Exam Cohort...</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      {(() => {
                        const activeExamDetails = examsList.find(e => e.id === selectedExamId);
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{
                                display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                                background: activeExamDetails?.active ? 'var(--verdigris)' : 'var(--seal)'
                              }}></span>
                              <span style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-soft)' }}>
                                Status: {activeExamDetails?.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            <button
                              onClick={toggleActiveExam}
                              style={{
                                background: activeExamDetails?.active ? 'rgba(140, 47, 57, 0.15)' : 'rgba(75, 122, 107, 0.15)',
                                color: activeExamDetails?.active ? 'var(--seal)' : 'var(--verdigris)',
                                border: 'none', borderRadius: '4px',
                                padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em'
                              }}
                            >
                              {activeExamDetails?.active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        );
                      })()}

                      {/* Cohort Delete Actions */}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--line)' }}>
                        {questionsList.length > 0 && (
                          <button
                            onClick={() => clearAllQuestionsForExam(selectedExamId)}
                            style={{
                              flex: 1, background: 'rgba(140, 47, 57, 0.15)', color: '#FF6B6B',
                              border: '1px solid rgba(255, 107, 107, 0.3)', borderRadius: '4px',
                              padding: '8px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                              fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em'
                            }}
                          >
                            Delete Question Set ({questionsList.length})
                          </button>
                        )}
                        {selectedExamId && (
                          <button
                            onClick={() => deleteExamCohort(selectedExamId)}
                            style={{
                              background: 'rgba(140, 47, 57, 0.3)', color: '#FF4D4D',
                              border: '1px solid rgba(255, 77, 77, 0.5)', borderRadius: '4px',
                              padding: '8px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                              fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em'
                            }}
                          >
                            Delete Entire Exam
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Exam Cohort Statistics */}
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                    <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: '14px', letterSpacing: '0.1em' }}>
                      Exam Cohort Statistics
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.05em', marginBottom: 2 }}>Submissions</label>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink)', fontFamily: "'IBM Plex Mono', monospace" }}>{examStats?.total_completed ?? 0}</span>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.05em', marginBottom: 2 }}>Top Score</label>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--verdigris)', fontFamily: "'IBM Plex Mono', monospace" }}>{examStats?.top_score ?? "N/A"}</span>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.05em', marginBottom: 2 }}>Average</label>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink)', fontFamily: "'IBM Plex Mono', monospace" }}>{examStats?.average_percentage ? `${examStats.average_percentage}%` : "N/A"}</span>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.05em', marginBottom: 2 }}>Pass Rate</label>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--gold)', fontFamily: "'IBM Plex Mono', monospace" }}>{examStats?.pass_rate ? `${examStats.pass_rate}%` : "N/A"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Current Question Bank for Selected Exam */}
                <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                    <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', margin: 0, letterSpacing: '0.1em' }}>
                      Current question bank — {examsList.find(e => e.id === selectedExamId)?.title || selectedExamId} ({questionsList.length} questions)
                    </h3>
                    {questionsList.length > 0 && (
                      <button
                        onClick={() => clearAllQuestionsForExam(selectedExamId)}
                        style={{
                          background: 'rgba(140, 47, 57, 0.15)', color: 'var(--seal)',
                          border: '1px solid rgba(140, 47, 57, 0.3)', borderRadius: '4px',
                          padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                          fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em'
                        }}
                      >
                        Delete All Questions
                      </button>
                    )}
                  </div>

                  {questionsList.length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: '13px', fontStyle: 'italic' }}>No questions loaded yet for this exam cohort. Use the sections below to add questions or import a CSV/JSON file.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {questionsList.map((q, idx) => (
                        <div key={q.id} style={{ background: 'var(--midnight)', border: '1px solid var(--line)', borderRadius: '6px', padding: '16px' }}>
                          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: 3, padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>Q{idx + 1}</span>
                              <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink)', lineHeight: 1.5 }}>{q.text}</p>
                            </div>
                            <button
                              onClick={() => deleteSingleQuestion(q.id)}
                              title="Delete question"
                              style={{
                                background: 'rgba(140, 47, 57, 0.2)', color: '#FF6B6B',
                                border: '1px solid rgba(255, 107, 107, 0.3)', borderRadius: '4px',
                                padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0
                              }}
                            >
                              Delete Question
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {q.options.map((opt, oi) => {
                              const isCorrect = q.correct_option_idx !== undefined ? q.correct_option_idx === oi : false;
                              return (
                                <div key={oi} style={{
                                  fontFamily: "'IBM Plex Mono', monospace",
                                  fontSize: '10.5px',
                                  color: isCorrect ? 'var(--verdigris)' : 'var(--ink-soft)',
                                  background: isCorrect ? 'rgba(46, 196, 182, 0.05)' : 'rgba(255,255,255,0.03)',
                                  border: isCorrect ? '1px solid var(--verdigris)' : '1px solid var(--line)',
                                  borderRadius: 4,
                                  padding: '6px 10px'
                                }}>
                                  <strong style={{ color: isCorrect ? 'var(--verdigris)' : 'var(--oxford)' }}>{String.fromCharCode(65 + oi)}.</strong> {opt} {isCorrect && '✓'}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Batch Upload questions card */}
                <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                  <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px', letterSpacing: '0.1em' }}>
                    Batch Import Questions (JSON or CSV)
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--ink-soft)', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                    Import questions into <strong>{examsList.find(e => e.id === selectedExamId)?.title || selectedExamId}</strong> (or upload a file to automatically create a new exam cohort).
                  </p>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <input
                      type="file"
                      accept=".csv,.json"
                      onChange={handleQuestionsFileUpload}
                      disabled={uploadingQuestions}
                      id="questions-file-upload"
                      style={{ display: 'none' }}
                    />
                    <label
                      htmlFor="questions-file-upload"
                      style={{
                        background: 'var(--oxford)', color: 'var(--midnight)',
                        border: 'none', borderRadius: '6px', padding: '10px 24px',
                        fontFamily: "'Inter', sans-serif", fontSize: '12.5px', fontWeight: 600,
                        cursor: uploadingQuestions ? 'not-allowed' : 'pointer', opacity: uploadingQuestions ? 0.6 : 1
                      }}
                    >
                      {uploadingQuestions ? 'Uploading Questions…' : 'Select & Upload file'}
                    </label>

                    {questionsUploadStatus && (
                      <span style={{
                        fontSize: '12px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: questionsUploadStatus.startsWith("Success") ? 'var(--verdigris)' : 'var(--seal)'
                      }}>
                        {questionsUploadStatus}
                      </span>
                    )}
                  </div>
                </div>

                {/* Add new question form for selected exam */}
                <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
                  <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '18px', letterSpacing: '0.1em' }}>
                    Add a new question to {examsList.find(e => e.id === selectedExamId)?.title || selectedExamId}
                  </h3>
                  <form onSubmit={submitQuestion} style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '680px' }}>
                    <div>
                      <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', letterSpacing: '0.12em', marginBottom: 6 }}>Question text</label>
                      <textarea
                        required
                        rows={3}
                        value={newQuestion.text}
                        onChange={(e) => setNewQuestion((prev) => ({ ...prev, text: e.target.value }))}
                        placeholder="Enter the full question text…"
                        style={{
                          width: '100%', background: 'var(--midnight)', border: '1px solid var(--line)',
                          color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                          padding: '10px 14px', borderRadius: '6px', outline: 'none', resize: 'vertical'
                        }}
                      />
                    </div>
                    {newQuestion.options.map((opt, i) => (
                      <div key={i}>
                        <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '0.1em', marginBottom: 6 }}>Option {String.fromCharCode(65 + i)}</label>
                        <input
                          type="text"
                          required
                          value={opt}
                          onChange={(e) => {
                            const updated = [...newQuestion.options];
                            updated[i] = e.target.value;
                            setNewQuestion((prev) => ({ ...prev, options: updated }));
                          }}
                          placeholder={`Option ${String.fromCharCode(65 + i)}…`}
                          style={{
                            width: '100%', background: 'var(--midnight)', border: '1px solid var(--line)',
                            color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                            padding: '10px 14px', borderRadius: '6px', outline: 'none'
                          }}
                        />
                      </div>
                    ))}
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', color: 'var(--verdigris)', letterSpacing: '0.1em' }}>Correct Answer Option</label>
                      <select
                        value={newQuestion.correct_option_idx}
                        onChange={(e) => setNewQuestion((prev) => ({ ...prev, correct_option_idx: parseInt(e.target.value) }))}
                        style={{
                          background: 'var(--midnight)', border: '1px solid var(--line)',
                          color: 'var(--ink)', fontFamily: "'Inter', sans-serif", fontSize: '13px',
                          padding: '10px 14px', borderRadius: '6px', outline: 'none', cursor: 'pointer'
                        }}
                      >
                        <option value={0}>Option A</option>
                        <option value={1}>Option B</option>
                        <option value={2}>Option C</option>
                        <option value={3}>Option D</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={savingQuestion}
                      style={{
                        alignSelf: 'flex-start', background: 'var(--oxford)', color: 'var(--midnight)',
                        border: 'none', borderRadius: '6px', padding: '10px 28px',
                        fontFamily: "'Inter', sans-serif", fontSize: '12.5px', fontWeight: 600,
                        cursor: savingQuestion ? 'not-allowed' : 'pointer', opacity: savingQuestion ? 0.6 : 1,
                        marginTop: 6
                      }}
                    >
                      {savingQuestion ? 'Saving…' : 'Add question'}
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        ) : currentView === "students" ? (
          /* Manage Students Tab */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="section-title">
              <h2>Student directory</h2>
              <span className="meta">
                {studentsList.filter(s => s.class_group).length} students in {new Set(studentsList.filter(s => s.class_group).map(s => s.class_group)).size} class groups
                {studentsList.filter(s => !s.class_group).length > 0 && ` · ${studentsList.filter(s => !s.class_group).length} ungrouped`}
              </span>
            </div>

            {/* CSV Batch Upload */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '24px' }}>
              <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px', letterSpacing: '0.1em' }}>
                Import Class CSV
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--ink-soft)', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                Required CSV headers: <code>student_id</code>, <code>student_name</code>, <code>passcode</code>.<br/>
                Set the class group name below — overrides any <code>class_group</code> column in the file.
              </p>

              {/* Group name input */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gold)', marginBottom: '6px' }}>
                  Class Group Name (override)
                </label>
                <input
                  type="text"
                  placeholder="e.g. CS-2026-A  — leave blank to use CSV column"
                  value={customGroupName}
                  onChange={(e) => setCustomGroupName(e.target.value)}
                  style={{
                    width: '100%', maxWidth: '380px',
                    background: 'var(--midnight)', border: '1px solid var(--line)',
                    color: 'var(--ink)', fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '12.5px', padding: '9px 14px', borderRadius: '6px', outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleStudentsCSVUpload}
                  disabled={uploadingStudents}
                  id="csv-file-upload"
                  style={{ display: 'none' }}
                />
                <label
                  htmlFor="csv-file-upload"
                  style={{
                    background: 'var(--oxford)', color: 'var(--midnight)',
                    border: 'none', borderRadius: '6px', padding: '10px 24px',
                    fontFamily: "'Inter', sans-serif", fontSize: '12.5px', fontWeight: 600,
                    cursor: uploadingStudents ? 'not-allowed' : 'pointer', opacity: uploadingStudents ? 0.6 : 1,
                    display: 'inline-block'
                  }}
                >
                  {uploadingStudents ? 'Uploading…' : 'Select & Upload CSV'}
                </label>

                {studentsUploadStatus && (
                  <span style={{
                    fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace",
                    color: studentsUploadStatus.startsWith("Success") ? 'var(--verdigris)' : 'var(--seal)'
                  }}>
                    {studentsUploadStatus}
                  </span>
                )}
              </div>
            </div>

            {/* Grouped Class Directory */}
            {studentsList.length === 0 ? (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '48px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: '13px', fontStyle: 'italic' }}>
                No students in directory. Upload a CSV file above to authorize logins.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(() => {
                  // Only show students with a class_group; handle ungrouped separately
                  const grouped: Record<string, typeof studentsList> = {};
                  const ungrouped: typeof studentsList = [];
                  for (const s of studentsList) {
                    if (s.class_group) {
                      if (!grouped[s.class_group]) grouped[s.class_group] = [];
                      grouped[s.class_group].push(s);
                    } else {
                      ungrouped.push(s);
                    }
                  }

                  const renderStudentTable = (members: typeof studentsList) => (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace" }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.025)', borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
                            <th style={{ padding: '9px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Registration ID</th>
                            <th style={{ padding: '9px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Full Name</th>
                            <th style={{ padding: '9px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Passcode</th>
                            <th style={{ padding: '9px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody style={{ color: 'var(--ink)' }}>
                          {members.map((student) => (
                            <tr key={student.student_id} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--oxford)' }}>{student.student_id}</td>
                              <td style={{ padding: '10px 20px', fontFamily: "'Inter', sans-serif" }}>{student.student_name}</td>
                              <td style={{ padding: '10px 20px' }}><code>{student.passcode}</code></td>
                              <td style={{ padding: '10px 20px' }}>
                                <button
                                  onClick={async () => {
                                    if (!window.confirm(`Remove "${student.student_name}" (${student.student_id})?`)) return;
                                    try {
                                      const res = await fetch(`${API_BASE}/students/${encodeURIComponent(student.student_id)}`, { method: 'DELETE' });
                                      if (res.ok) setStudentsList(prev => prev.filter(s => s.student_id !== student.student_id));
                                    } catch { setStudentsUploadStatus('Error: Failed to delete student'); }
                                  }}
                                  style={{
                                    background: 'rgba(140,47,57,0.12)', color: '#FF6B6B',
                                    border: '1px solid rgba(255,107,107,0.25)', borderRadius: '4px',
                                    padding: '4px 10px', fontSize: '10.5px', fontWeight: 600,
                                    cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace"
                                  }}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );

                  return (
                    <>
                      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, members]) => {
                        const isOpen = expandedGroups.has(groupName);
                        return (
                          <div key={groupName} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', overflow: 'hidden' }}>
                            {/* Clickable group header */}
                            <div
                              onClick={() => setExpandedGroups(prev => {
                                const next = new Set(prev);
                                isOpen ? next.delete(groupName) : next.add(groupName);
                                return next;
                              })}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '14px 20px', background: 'var(--midnight)',
                                borderBottom: isOpen ? '1px solid var(--line)' : 'none',
                                cursor: 'pointer', userSelect: 'none'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '13px', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gold)' }}>
                                  {groupName}
                                </span>
                                <span style={{
                                  background: 'rgba(189,147,64,0.12)', color: 'var(--gold)',
                                  border: '1px solid rgba(189,147,64,0.25)', borderRadius: '10px',
                                  padding: '2px 10px', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600
                                }}>{members.length} students</span>
                              </div>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`Delete all ${members.length} students in "${groupName}"? Cannot be undone.`)) return;
                                  try {
                                    const res = await fetch(`${API_BASE}/students/group/${encodeURIComponent(groupName)}`, { method: 'DELETE' });
                                    if (res.ok) {
                                      setStudentsList(prev => prev.filter(s => s.class_group !== groupName));
                                      setExpandedGroups(prev => { const n = new Set(prev); n.delete(groupName); return n; });
                                      setStudentsUploadStatus(`Deleted class "${groupName}"`);
                                    }
                                  } catch { setStudentsUploadStatus('Error: Delete failed'); }
                                }}
                                style={{
                                  background: 'rgba(140,47,57,0.15)', color: 'var(--seal)',
                                  border: '1px solid rgba(140,47,57,0.3)', borderRadius: '4px',
                                  padding: '5px 12px', fontSize: '10.5px', fontWeight: 600,
                                  cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace"
                                }}
                              >
                                🗑 Delete Group
                              </button>
                            </div>
                            {isOpen && renderStudentTable(members)}
                          </div>
                        );
                      })}

                      {/* Ungrouped students toggle */}
                      {ungrouped.length > 0 && (
                        <div style={{ background: 'var(--panel)', border: '1px dashed var(--line)', borderRadius: '6px', overflow: 'hidden' }}>
                          <div
                            onClick={() => setShowUngrouped(v => !v)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '12px',
                              padding: '12px 20px', background: 'var(--midnight)', cursor: 'pointer', userSelect: 'none'
                            }}
                          >
                            <span style={{ fontSize: '12px', display: 'inline-block', transform: showUngrouped ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                              Ungrouped students — {ungrouped.length}
                            </span>
                          </div>
                          {showUngrouped && renderStudentTable(ungrouped)}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

        ) : currentView === "reports" ? (
          /* Session Reports Tab — Unique Student Directory + Detailed Ledger Inspector */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {(() => {
              const uniqueStudentCount = new Set(allSessions.map(s => s.student_id)).size;
              return (
                <div className="section-title">
                  <h2>Proctoring ledger & session reports</h2>
                  <span className="meta">{uniqueStudentCount} unique students • {allSessions.length} total exam sessions</span>
                </div>
              );
            })()}

            {/* Filter & Search Bar */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', padding: '20px 24px' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                {/* Real-time Search input */}
                <div style={{ flex: '1 1 320px', maxWidth: '440px', position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search by Student ID, Exam ID, or Session ID…"
                    value={sessionSearchQuery}
                    onChange={(e) => setSessionSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--midnight)',
                      border: '1px solid var(--line)',
                      color: 'var(--ink)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '12.5px',
                      padding: '10px 36px 10px 16px',
                      borderRadius: '6px',
                      outline: 'none'
                    }}
                  />
                  {sessionSearchQuery && (
                    <button
                      onClick={() => setSessionSearchQuery("")}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 14 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Controls: Status Filter Pills + Clear All Button */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(['all', 'in_progress', 'completed'] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => setSessionStatusFilter(st)}
                        style={{
                          background: sessionStatusFilter === st ? 'var(--oxford)' : 'var(--midnight)',
                          color: sessionStatusFilter === st ? 'var(--midnight)' : 'var(--ink-soft)',
                          border: sessionStatusFilter === st ? '1px solid var(--oxford)' : '1px solid var(--line)',
                          borderRadius: '6px',
                          padding: '8px 14px',
                          fontSize: '11px',
                          fontWeight: sessionStatusFilter === st ? 700 : 500,
                          cursor: 'pointer',
                          fontFamily: "'IBM Plex Mono', monospace",
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {st === 'all' ? `All (${allSessions.length})` : st === 'in_progress' ? `🟢 Live (${allSessions.filter(s => s.status === 'in_progress').length})` : `🏁 Completed (${allSessions.filter(s => s.status === 'completed').length})`}
                      </button>
                    ))}
                  </div>

                  {allSessions.length > 0 && (
                    <button
                      onClick={clearAllSessions}
                      style={{
                        background: 'rgba(244, 63, 94, 0.1)',
                        color: 'var(--seal)',
                        border: '1px solid rgba(244, 63, 94, 0.3)',
                        borderRadius: '6px',
                        padding: '8px 14px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: "'IBM Plex Mono', monospace",
                        whiteSpace: 'nowrap'
                      }}
                    >
                      🗑️ Purge All History
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Student Directory Table (Grouped by Student ID) */}
            {(() => {
              // Group allSessions by student_id
              const studentGroupsMap: Record<string, typeof allSessions> = {};
              allSessions.forEach((s) => {
                if (!studentGroupsMap[s.student_id]) studentGroupsMap[s.student_id] = [];
                studentGroupsMap[s.student_id].push(s);
              });

              const filteredStudents = Object.entries(studentGroupsMap).map(([studentId, sessions]) => {
                const totalFlags = sessions.reduce((acc, curr) => acc + curr.alert_count, 0);
                const isLive = sessions.some(s => s.status === "in_progress");
                const latestSession = sessions[0];
                const gradedSession = sessions.find(s => s.score);
                const cohorts = Array.from(new Set(sessions.map(s => s.exam_id || "default"))).join(", ");
                return {
                  student_id: studentId,
                  session_count: sessions.length,
                  cohorts,
                  isLive,
                  totalFlags,
                  latestSession,
                  gradedSession,
                  sessions
                };
              }).filter((g) => {
                const matchesStatus = sessionStatusFilter === "all" || (sessionStatusFilter === "in_progress" ? g.isLive : !g.isLive);
                const q = sessionSearchQuery.toLowerCase().trim();
                const matchesQuery = !q || g.student_id.toLowerCase().includes(q) || g.cohorts.toLowerCase().includes(q) || g.sessions.some(s => s.session_id.toLowerCase().includes(q));
                return matchesStatus && matchesQuery;
              });

              return (
                <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ink-soft)', margin: 0, letterSpacing: '0.1em' }}>
                      Attended Students Directory ({filteredStudents.length} unique students)
                    </h3>
                    {sessionReport && (
                      <button
                        onClick={() => { setSessionReport(null); setSelectedSessionId(""); }}
                        style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--ink-soft)', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        ✕ Close Active Report
                      </button>
                    )}
                  </div>

                  {filteredStudents.length === 0 ? (
                    <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: '13px', fontStyle: 'italic' }}>
                      No student records match your search or filter.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace" }}>
                        <thead>
                          <tr style={{ background: 'var(--midnight)', borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Student ID</th>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Exam Cohorts</th>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Sessions</th>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Status</th>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Total Incidents</th>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Latest Score</th>
                            <th style={{ padding: '12px 20px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody style={{ color: 'var(--ink)' }}>
                          {filteredStudents.map((g) => {
                            const isSelected = selectedSessionId && g.sessions.some(s => s.session_id === selectedSessionId);
                            return (
                              <tr
                                key={g.student_id}
                                onClick={() => loadSessionReport(g.latestSession.session_id)}
                                style={{
                                  borderBottom: '1px solid var(--line)',
                                  cursor: 'pointer',
                                  background: isSelected ? 'rgba(217, 182, 91, 0.08)' : 'transparent',
                                  transition: 'background .15s'
                                }}
                              >
                                <td style={{ padding: '12px 20px', fontWeight: 700, color: 'var(--oxford)' }}>{g.student_id}</td>
                                <td style={{ padding: '12px 20px', color: 'var(--ink-soft)' }}>{g.cohorts}</td>
                                <td style={{ padding: '12px 20px', color: 'var(--ink)' }}>
                                  <span style={{ background: 'var(--midnight)', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>
                                    {g.session_count} session{g.session_count > 1 ? 's' : ''}
                                  </span>
                                </td>
                                <td style={{ padding: '12px 20px' }}>
                                  <span style={{
                                    fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 700,
                                    background: g.isLive ? 'rgba(75, 122, 107, 0.15)' : 'rgba(255,255,255,0.05)',
                                    color: g.isLive ? 'var(--verdigris)' : 'var(--ink-soft)'
                                  }}>
                                    {g.isLive ? "🟢 LIVE" : "🏁 COMPLETED"}
                                  </span>
                                </td>
                                <td style={{ padding: '12px 20px', color: g.totalFlags > 3 ? 'var(--seal)' : g.totalFlags > 0 ? 'var(--gold)' : 'var(--verdigris)', fontWeight: 600 }}>
                                  {g.totalFlags} flags
                                </td>
                                <td style={{ padding: '12px 20px', fontWeight: 600 }}>
                                  {g.gradedSession ? (
                                    `${g.gradedSession.score} (${g.gradedSession.percentage ?? 0}%)`
                                  ) : g.isLive ? (
                                    <span style={{ color: 'var(--gold)', fontStyle: 'italic', fontWeight: 400 }}>In progress</span>
                                  ) : (
                                    <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontWeight: 400 }}>Ungraded</span>
                                  )}
                                </td>
                                <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); loadSessionReport(g.latestSession.session_id); }}
                                      style={{
                                        background: isSelected ? 'var(--oxford)' : 'var(--midnight)',
                                        color: isSelected ? 'var(--midnight)' : 'var(--ink)',
                                        border: '1px solid var(--line)', borderRadius: '4px',
                                        padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                        fontFamily: "'IBM Plex Mono', monospace"
                                      }}
                                    >
                                      View Report →
                                    </button>
                                    <button
                                      onClick={(e) => clearStudentSessions(g.student_id, e)}
                                      title="Clear student history"
                                      style={{
                                        background: 'rgba(244, 63, 94, 0.1)',
                                        color: 'var(--seal)',
                                        border: '1px solid rgba(244, 63, 94, 0.2)',
                                        borderRadius: '4px',
                                        padding: '6px 10px',
                                        fontSize: '11px',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

            {sessionReport && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '260px 1fr',
                gap: '32px',
                alignItems: 'start',
                borderTop: '2px solid var(--gold)',
                paddingTop: '24px'
              }}>
                {/* Report metadata — aligned grid */}
                <div style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '24px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11px',
                  color: 'var(--ink-soft)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, letterSpacing: '0.15em' }}>Report metadata</span>
                    <button
                      onClick={() => { setSessionReport(null); setSelectedSessionId(""); }}
                      style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', rowGap: 14 }}>
                    {[
                      ['Student', sessionReport.student_id],
                      ['Session', sessionReport.session_id.substring(0, 20) + '…'],
                      ['Status', sessionReport.status.toUpperCase()],
                      ['Started', new Date(sessionReport.start_time).toLocaleString()],
                      ['Ended', sessionReport.end_time ? new Date(sessionReport.end_time).toLocaleString() : '—'],
                      ['Flags', String(sessionReport.total_alerts)],
                      ...(sessionReport.score ? [
                        ['Score', sessionReport.score],
                        ['Percentage', `${sessionReport.percentage}%`]
                      ] : [])
                    ].map(([label, value]) => (
                      <React.Fragment key={label}>
                        <span style={{ fontSize: 9, textTransform: 'uppercase', opacity: 0.6, letterSpacing: '0.08em', paddingTop: 2 }}>{label}</span>
                        <span style={{ color: label === 'Status' ? (sessionReport.status === 'completed' ? 'var(--verdigris)' : 'var(--gold)') : label === 'Flags' && sessionReport.total_alerts > 0 ? 'var(--seal)' : 'var(--ink)', fontWeight: label === 'Student' || label === 'Flags' || label === 'Score' ? 600 : 400, wordBreak: 'break-all', lineHeight: 1.4 }}>{value}</span>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button onClick={exportCSV} style={{ background: 'var(--midnight)', border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 4, padding: '8px 12px', cursor: 'pointer', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}>Export CSV</button>
                    <button onClick={() => window.print()} style={{ background: 'var(--oxford)', color: 'var(--midnight)', border: 'none', borderRadius: 4, padding: '8px 12px', cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>Print report</button>
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
        ) : null}
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
                      src={`${API_BASE}${selectedAlert.video_clip_path}`}
                      controls
                      autoPlay
                      style={{ width: '100%', height: '100%', objectFit: 'contain', outline: 'none' }}
                    />
                  </div>
                ) : selectedAlert.frame_path ? (
                  <div style={{ border: '1px solid var(--line)', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#000', aspectRatio: '16/9' }}>
                    <img
                      src={`${API_BASE}${selectedAlert.frame_path}`}
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
