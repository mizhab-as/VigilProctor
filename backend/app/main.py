import os
import uuid
import base64
import json
import asyncio
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.keyframe import MotionKeyframeExtractor
from app.core.inference import ExamGuardInferenceEngine
from app.database.models import init_db, SessionLocal, ExamSession, SessionAlert, QuestionModel, AuthorizedStudent, ExamModel

# Initialize directories for image persistence
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data"))
FRAMES_DIR = os.path.join(DATA_DIR, "frames")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")
CLIPS_DIR = os.path.join(DATA_DIR, "clips")
os.makedirs(FRAMES_DIR, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)
os.makedirs(CLIPS_DIR, exist_ok=True)

app = FastAPI(title="ExamGuard AI - Online Proctoring Engine")

# Add CORS Middleware for development access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database schemas
@app.on_event("startup")
def startup_event():
    init_db()
    # Mark any stale active sessions from previous runs as completed
    db = SessionLocal()
    try:
        stale_sessions = db.query(ExamSession).filter(ExamSession.status == "active").all()
        for s in stale_sessions:
            s.status = "completed"
            s.end_time = s.start_time
        db.commit()
        print(f"[STARTUP] Successfully cleaned up {len(stale_sessions)} stale active sessions.")
    except Exception as e:
        print(f"[STARTUP] Error cleaning stale active sessions: {e}")
    finally:
        db.close()

# Mount Static Files to serve keyframes and thumbnails
app.mount("/static", StaticFiles(directory=DATA_DIR), name="static")

# Database dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Connection Manager for routing WebSocket notifications
class ConnectionManager:
    def __init__(self):
        # Maps session_id to student websocket
        self.student_connections: dict[str, WebSocket] = {}
        # List of dashboard websockets
        self.dashboard_connections: list[WebSocket] = []

    async def connect_student(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.student_connections[session_id] = websocket

    def disconnect_student(self, session_id: str):
        if session_id in self.student_connections:
            del self.student_connections[session_id]

    async def connect_dashboard(self, websocket: WebSocket):
        await websocket.accept()
        self.dashboard_connections.append(websocket)

    def disconnect_dashboard(self, websocket: WebSocket):
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)

    async def broadcast_to_dashboards(self, message: dict):
        for connection in self.dashboard_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()
inference_engine = ExamGuardInferenceEngine()

# Helpers for Image Processing
def decode_base64_image(b64_string: str):
    import cv2
    import numpy as np
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]
    img_data = base64.b64decode(b64_string)
    nparr = np.frombuffer(img_data, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def create_thumbnail(img, max_size=(160, 120)):
    import cv2
    h, w = img.shape[:2]
    sh, sw = max_size
    aspect = w / h
    if aspect > sw / sh:
        new_w = sw
        new_h = int(sw / aspect)
    else:
        new_h = sh
        new_w = int(sh * aspect)
    return cv2.resize(img, (new_w, new_h))

# Request models
class SessionStartRequest(BaseModel):
    student_id: str
    passcode: str
    exam_id: str = "default"

class QuestionCreate(BaseModel):
    text: str
    options: list[str]
    correct_option_idx: int = 0
    exam_id: str = "default"

class ExamSubmitRequest(BaseModel):
    answers: dict[str, int] # e.g. {"1": 3, "2": 1}

class ExamCreate(BaseModel):
    id: str
    title: str
    description: str | None = None

class StudentVerifyRequest(BaseModel):
    student_id: str
    passcode: str

@app.get("/exams")
def get_all_exams(student_view: bool = False, db: Session = Depends(get_db)):
    query = db.query(ExamModel)
    if student_view:
        query = query.filter(ExamModel.active == True)
    exams = query.all()
    return [{"id": e.id, "title": e.title, "description": e.description, "active": e.active} for e in exams]

@app.post("/exams")
def create_exam(req: ExamCreate, db: Session = Depends(get_db)):
    existing = db.query(ExamModel).filter(ExamModel.id == req.id.strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Exam with this ID already exists.")
    new_exam = ExamModel(
        id=req.id.strip(),
        title=req.title.strip(),
        description=req.description.strip() if req.description else None,
        active=True
    )
    db.add(new_exam)
    db.commit()
    return {"status": "success", "id": new_exam.id, "title": new_exam.title}

@app.post("/exams/{exam_id}/toggle-active")
def toggle_exam_active(exam_id: str, db: Session = Depends(get_db)):
    exam = db.query(ExamModel).filter(ExamModel.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")
    exam.active = not exam.active
    db.commit()
    db.refresh(exam)
    return {"status": "success", "id": exam.id, "active": exam.active}

@app.get("/exams/{exam_id}/stats")
def get_exam_stats(exam_id: str, db: Session = Depends(get_db)):
    sessions = db.query(ExamSession).filter(
        ExamSession.exam_id == exam_id,
        ExamSession.status == "completed"
    ).all()
    
    total = len(sessions)
    if total == 0:
        return {
            "total_completed": 0,
            "top_score": "N/A",
            "average_percentage": 0.0,
            "pass_rate": 0.0
        }
    
    top_score = 0.0
    total_percentage = 0.0
    passed = 0
    
    for s in sessions:
        p = s.percentage or 0.0
        if p > top_score:
            top_score = p
        total_percentage += p
        if p >= 50.0:
            passed += 1
            
    avg_p = round(total_percentage / total, 1)
    pass_r = round((passed / total) * 100, 1)
    
    return {
        "total_completed": total,
        "top_score": f"{top_score}%",
        "average_percentage": avg_p,
        "pass_rate": pass_r
    }

@app.get("/questions")
def get_questions(exam_id: str = "default", student_view: bool = False, db: Session = Depends(get_db)):
    """Return questions. Pass student_view=true to hide correct_option_idx from students."""
    questions = db.query(QuestionModel).filter(QuestionModel.exam_id == exam_id).all()
    result = []
    for q in questions:
        try:
            options = json.loads(q.options_json)
        except Exception:
            options = []
        row = {
            "id": q.id,
            "exam_id": q.exam_id,
            "text": q.text,
            "options": options
        }
        if not student_view:
            row["correct_option_idx"] = q.correct_option_idx
        result.append(row)
    return result

@app.post("/questions")
def create_question(req: QuestionCreate, db: Session = Depends(get_db)):
    if len(req.options) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 options are required")
    # Verify exam exists
    exam = db.query(ExamModel).filter(ExamModel.id == req.exam_id).first()
    if not exam:
        raise HTTPException(status_code=400, detail=f"Exam '{req.exam_id}' does not exist.")

    new_q = QuestionModel(
        exam_id=req.exam_id,
        text=req.text,
        options_json=json.dumps(req.options),
        correct_option_idx=req.correct_option_idx
    )
    db.add(new_q)
    db.commit()
    db.refresh(new_q)
    return {
        "id": new_q.id,
        "exam_id": new_q.exam_id,
        "text": new_q.text,
        "options": req.options,
        "correct_option_idx": new_q.correct_option_idx
    }

@app.delete("/questions/{question_id}")
def delete_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(QuestionModel).filter(QuestionModel.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found.")
    db.delete(q)
    db.commit()
    return {"status": "success", "message": f"Question {question_id} deleted."}

@app.delete("/exams/{exam_id}/questions")
def delete_exam_questions(exam_id: str, db: Session = Depends(get_db)):
    deleted_count = db.query(QuestionModel).filter(QuestionModel.exam_id == exam_id).delete()
    db.commit()
    return {"status": "success", "message": f"Deleted {deleted_count} questions for exam '{exam_id}'."}

@app.delete("/exams/{exam_id}")
def delete_exam(exam_id: str, db: Session = Depends(get_db)):
    exam = db.query(ExamModel).filter(ExamModel.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")
    db.query(QuestionModel).filter(QuestionModel.exam_id == exam_id).delete()
    db.delete(exam)
    db.commit()
    return {"status": "success", "message": f"Exam cohort '{exam_id}' deleted."}

@app.post("/students/verify")
def verify_student(req: StudentVerifyRequest, db: Session = Depends(get_db)):
    student = db.query(AuthorizedStudent).filter(
        AuthorizedStudent.student_id == req.student_id.strip()
    ).first()

    if not student:
        raise HTTPException(
            status_code=401,
            detail="Registration ID not found. Please contact your invigilator."
        )

    if student.passcode != req.passcode.strip():
        raise HTTPException(
            status_code=401,
            detail="Incorrect passcode. Please check your credentials."
        )

    return {
        "status": "success",
        "student_id": student.student_id,
        "student_name": student.student_name
    }

@app.post("/session/start")
async def start_session(req: SessionStartRequest, db: Session = Depends(get_db)):
    # Validate credentials
    student = db.query(AuthorizedStudent).filter(
        AuthorizedStudent.student_id == req.student_id.strip()
    ).first()

    if not student:
        raise HTTPException(
            status_code=401,
            detail="Registration ID not found. Please contact your invigilator."
        )

    if student.passcode != req.passcode.strip():
        raise HTTPException(
            status_code=401,
            detail="Incorrect passcode. Please check your credentials."
        )

    # Validate exam
    exam = db.query(ExamModel).filter(ExamModel.id == req.exam_id).first()
    if not exam:
        raise HTTPException(
            status_code=400,
            detail=f"The selected exam '{req.exam_id}' is not available."
        )

    session_id = str(uuid.uuid4())
    new_session = ExamSession(
        id=session_id,
        student_id=student.student_id,
        exam_id=req.exam_id,
        start_time=datetime.utcnow(),
        status="active"
    )
    db.add(new_session)
    db.commit()
    
    # Broadcast session initialization to dashboard
    broadcast_task = {
        "type": "session_status",
        "session_id": session_id,
        "student_id": student.student_id,
        "exam_id": new_session.exam_id,
        "status": "active",
        "start_time": new_session.start_time.isoformat()
    }
    await manager.broadcast_to_dashboards(broadcast_task)

    return {
        "session_id": session_id,
        "student_id": req.student_id,
        "exam_id": req.exam_id,
        "status": "active"
    }

@app.post("/session/{session_id}/end")
async def end_session(session_id: str, db: Session = Depends(get_db)):
    session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.status = "completed"
    session.end_time = datetime.utcnow()
    db.commit()

    # Broadcast session termination to dashboard
    broadcast_task = {
        "type": "session_status",
        "session_id": session_id,
        "student_id": session.student_id,
        "status": "completed",
        "end_time": session.end_time.isoformat()
    }
    await manager.broadcast_to_dashboards(broadcast_task)

    return {"session_id": session_id, "status": "completed"}

@app.get("/session/active")
def get_active_sessions(db: Session = Depends(get_db)):
    # Only return sessions that are 'active' in database AND currently connected via websockets
    active_socket_ids = list(manager.student_connections.keys())
    sessions = db.query(ExamSession).filter(
        ExamSession.status == "active",
        ExamSession.id.in_(active_socket_ids)
    ).all()
    result = []
    for s in sessions:
        # Get count of alerts to set health indicator
        alert_count = db.query(SessionAlert).filter(SessionAlert.session_id == s.id).count()
        # Health status logic: Green for 0 alerts, Yellow for 1-3 alerts, Red for >3 alerts
        status_color = "green"
        if alert_count > 3:
            status_color = "red"
        elif alert_count > 0:
            status_color = "yellow"

        result.append({
            "session_id": s.id,
            "student_id": s.student_id,
            "start_time": s.start_time.isoformat(),
            "alert_count": alert_count,
            "status_color": status_color
        })
    return result

def format_iso(dt):
    if dt is None:
        return None
    iso = dt.isoformat()
    if not iso.endswith("Z") and "+" not in iso:
        iso += "Z"
    return iso

@app.get("/sessions")
def get_all_sessions(student_id: str = "", status: str = "", db: Session = Depends(get_db)):
    """Return all sessions (both live in_progress and completed), optionally filtered by student_id or status."""
    query = db.query(ExamSession)
    if status.strip():
        query = query.filter(ExamSession.status == status.strip())
    if student_id.strip():
        query = query.filter(ExamSession.student_id.ilike(f"%{student_id.strip()}%"))
    sessions = query.order_by(ExamSession.start_time.desc()).all()
    result = []
    for s in sessions:
        alert_count = db.query(SessionAlert).filter(SessionAlert.session_id == s.id).count()
        status_color = "green"
        if alert_count > 3:
            status_color = "red"
        elif alert_count > 0:
            status_color = "yellow"
        result.append({
            "session_id": s.id,
            "student_id": s.student_id,
            "exam_id": s.exam_id,
            "start_time": format_iso(s.start_time),
            "end_time": format_iso(s.end_time),
            "status": s.status,
            "score": s.score,
            "percentage": s.percentage,
            "alert_count": alert_count,
            "status_color": status_color
        })
    return result

@app.delete("/sessions")
def delete_all_sessions(db: Session = Depends(get_db)):
    """Clear all student sessions and alert logs from database."""
    deleted_alerts = db.query(SessionAlert).delete()
    deleted_sessions = db.query(ExamSession).delete()
    db.commit()
    return {
        "status": "success",
        "message": f"Cleared {deleted_sessions} sessions and {deleted_alerts} alert logs."
    }

@app.delete("/sessions/student/{student_id}")
def delete_student_sessions(student_id: str, db: Session = Depends(get_db)):
    """Clear all sessions and alert logs for a specific student_id."""
    student_sessions = db.query(ExamSession).filter(ExamSession.student_id == student_id).all()
    session_ids = [s.id for s in student_sessions]
    
    deleted_alerts = 0
    if session_ids:
        deleted_alerts = db.query(SessionAlert).filter(SessionAlert.session_id.in_(session_ids)).delete(synchronize_session=False)
    
    deleted_sessions = db.query(ExamSession).filter(ExamSession.student_id == student_id).delete(synchronize_session=False)
    db.commit()
    return {
        "status": "success",
        "message": f"Cleared {deleted_sessions} sessions and {deleted_alerts} alert logs for student '{student_id}'."
    }

@app.get("/session/{session_id}/report")
def get_session_report(session_id: str, db: Session = Depends(get_db)):
    session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    alerts = db.query(SessionAlert).filter(SessionAlert.session_id == session_id).order_by(SessionAlert.timestamp.asc()).all()
    
    alert_logs = []
    timeline_chart = []
    
    for a in alerts:
        alert_logs.append({
            "id": a.id,
            "timestamp": format_iso(a.timestamp),
            "anomaly_type": a.anomaly_type,
            "confidence": a.confidence,
            "frame_path": a.frame_path,
            "thumbnail_path": a.thumbnail_path,
            "video_clip_path": a.video_clip_path,
            "override_status": a.override_status
        })
        
        # Simple format for chart plotting: timestamp in seconds relative to start time
        elapsed = int((a.timestamp - session.start_time).total_seconds())
        timeline_chart.append({
            "elapsed_seconds": elapsed,
            "anomaly_type": a.anomaly_type,
            "confidence": round(a.confidence * 100, 1)
        })

    return {
        "session_id": session.id,
        "student_id": session.student_id,
        "start_time": format_iso(session.start_time),
        "end_time": format_iso(session.end_time),
        "status": session.status,
        "score": session.score,
        "percentage": session.percentage,
        "total_alerts": len(alerts),
        "alerts": alert_logs,
        "timeline_chart": timeline_chart
    }

# Websocket endpoint for students
@app.websocket("/session/{session_id}/stream")
async def student_stream(websocket: WebSocket, session_id: str, db: Session = Depends(get_db)):
    # Validate session
    session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
    if not session:
        await websocket.close(code=4003, reason="Session not found")
        return

    await manager.connect_student(session_id, websocket)
    extractor = MotionKeyframeExtractor()
    
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            msg_type = data.get("type")

            if msg_type == "anomaly":
                label = data.get("anomaly_type")
                confidence = data.get("confidence", 0.0)
                b64_frame = data.get("frame")
                if not label:
                    continue

                frame_path_web = None
                thumb_path_web = None

                if b64_frame:
                    try:
                        img = decode_base64_image(b64_frame)
                        if img is not None:
                            alert_id = str(uuid.uuid4())
                            frame_filename = f"{session_id}_{alert_id}.jpg"
                            thumb_filename = f"{session_id}_{alert_id}_thumb.jpg"
                            
                            frame_path_abs = os.path.join(FRAMES_DIR, frame_filename)
                            thumb_path_abs = os.path.join(THUMBNAILS_DIR, thumb_filename)

                            # Write to files
                            import cv2
                            cv2.imwrite(frame_path_abs, img)
                            cv2.imwrite(thumb_path_abs, create_thumbnail(img))

                            frame_path_web = f"/static/frames/{frame_filename}"
                            thumb_path_web = f"/static/thumbnails/{thumb_filename}"
                    except Exception as img_err:
                        print(f"[ERROR] Failed to save anomaly image: {img_err}")

                # Save anomaly in database
                new_alert = SessionAlert(
                    session_id=session_id,
                    anomaly_type=label,
                    confidence=float(confidence),
                    frame_path=frame_path_web,
                    thumbnail_path=thumb_path_web,
                    timestamp=datetime.utcnow()
                )
                db.add(new_alert)
                db.commit()

                # Construct dashboard notification
                alert_payload = {
                    "type": "alert",
                    "id": new_alert.id,
                    "session_id": session_id,
                    "student_id": session.student_id,
                    "anomaly_type": label,
                    "confidence": round(float(confidence) * 100, 1),
                    "timestamp": new_alert.timestamp.isoformat(),
                    "thumbnail_path": new_alert.thumbnail_path,
                    "frame_path": new_alert.frame_path,
                    "override_status": new_alert.override_status
                }
                await manager.broadcast_to_dashboards(alert_payload)

                # Send warnings and confirmation back to student UI
                await websocket.send_json({
                    "type": "warning",
                    "message": f"Suspicious Activity Detected: {label}. Please remain focused on the exam."
                })
                await websocket.send_json({
                    "type": "alert_confirmation",
                    "alert_id": new_alert.id,
                    "anomaly_type": label
                })

            elif msg_type == "visibility_change":
                visible = data.get("visible", True)
                if not visible:
                    # Tab switched, log as critical alert
                    new_alert = SessionAlert(
                        session_id=session_id,
                        anomaly_type="Interface Violation (Tab Switch)",
                        confidence=1.0,
                        frame_path=None,
                        thumbnail_path=None,
                        timestamp=datetime.utcnow()
                    )
                    db.add(new_alert)
                    db.commit()

                    alert_payload = {
                        "type": "alert",
                        "id": new_alert.id,
                        "session_id": session_id,
                        "student_id": session.student_id,
                        "anomaly_type": "Interface Violation (Tab Switch)",
                        "confidence": 100.0,
                        "timestamp": new_alert.timestamp.isoformat(),
                        "thumbnail_path": None,
                        "frame_path": None,
                        "override_status": new_alert.override_status
                    }
                    await manager.broadcast_to_dashboards(alert_payload)
                    
                    await websocket.send_json({
                        "type": "warning",
                        "message": "Security Warning: Leaving the exam screen is logged as a violation!"
                    })

            elif msg_type == "heartbeat":
                # Forward live webcam frame to all dashboard watchers
                b64_frame = data.get("frame")
                if b64_frame:
                    await manager.broadcast_to_dashboards({
                        "type": "live_feed",
                        "session_id": session_id,
                        "student_id": session.student_id,
                        "frame": b64_frame
                    })

    except WebSocketDisconnect:
        manager.disconnect_student(session_id)
        # Auto-complete session in DB so it disappears from active list
        db_sess = db.query(ExamSession).filter(ExamSession.id == session_id).first()
        if db_sess and db_sess.status == "active":
            db_sess.status = "completed"
            db_sess.end_time = datetime.utcnow()
            db.commit()
            await manager.broadcast_to_dashboards({
                "type": "session_status",
                "session_id": session_id,
                "student_id": db_sess.student_id,
                "status": "completed",
                "end_time": db_sess.end_time.isoformat()
            })
    except Exception as e:
        print(f"[ERROR] WebSocket connection error on session {session_id}: {e}")
        manager.disconnect_student(session_id)

# WebSocket endpoint for dashboard — with ping to detect stale connections
@app.websocket("/dashboard/alerts")
async def dashboard_alerts(websocket: WebSocket):
    await manager.connect_dashboard(websocket)
    try:
        while True:
            # Send a ping every 20s; close dead connections
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
            except asyncio.TimeoutError:
                # Send ping frame to confirm client is still alive
                await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, Exception):
        manager.disconnect_dashboard(websocket)

@app.post("/session/{session_id}/alert/{alert_id}/video")
async def upload_anomaly_video(session_id: str, alert_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    alert = db.query(SessionAlert).filter(SessionAlert.session_id == session_id, SessionAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert record not found")

    file_ext = os.path.splitext(file.filename)[1] or ".webm"
    video_filename = f"{session_id}_{alert_id}_evidence{file_ext}"
    video_path_abs = os.path.join(CLIPS_DIR, video_filename)

    try:
        content = await file.read()
        with open(video_path_abs, "wb") as buffer:
            buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save video: {e}")

    alert.video_clip_path = f"/static/clips/{video_filename}"
    db.commit()

    # Notify dashboards about the video clip update
    clip_payload = {
        "type": "video_update",
        "session_id": session_id,
        "alert_id": alert_id,
        "video_clip_path": alert.video_clip_path
    }
    await manager.broadcast_to_dashboards(clip_payload)

    return {"status": "success", "video_clip_path": alert.video_clip_path}

@app.post("/session/{session_id}/alert/{alert_id}/override")
async def override_alert_status(
    session_id: str,
    alert_id: int,
    payload: dict,
    db: Session = Depends(get_db)
):
    alert = db.query(SessionAlert).filter(SessionAlert.session_id == session_id, SessionAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert record not found")

    status = payload.get("status")
    if status not in ["confirmed", "dismissed", "pending"]:
        raise HTTPException(status_code=400, detail="Invalid override status value")

    alert.override_status = status
    db.commit()

    # Notify dashboards about the override update
    override_payload = {
        "type": "alert_override",
        "session_id": session_id,
        "alert_id": alert_id,
        "override_status": status
    }
    await manager.broadcast_to_dashboards(override_payload)

    return {"status": "success", "override_status": status}

@app.get("/students")
def get_authorized_students(db: Session = Depends(get_db)):
    students = db.query(AuthorizedStudent).order_by(AuthorizedStudent.class_group, AuthorizedStudent.student_id).all()
    return [
        {
            "student_id": s.student_id,
            "student_name": s.student_name,
            "passcode": s.passcode,
            "class_group": s.class_group  # None if unset — frontend decides how to label it
        }
        for s in students
    ]

@app.delete("/students/{student_id}")
def delete_student(student_id: str, db: Session = Depends(get_db)):
    student = db.query(AuthorizedStudent).filter(AuthorizedStudent.student_id == student_id.strip()).first()
    if not student:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    db.delete(student)
    db.commit()
    return {"status": "success", "message": f"Student '{student_id}' deleted."}

@app.delete("/students/group/{class_group}")
def delete_student_group(class_group: str, db: Session = Depends(get_db)):
    deleted = db.query(AuthorizedStudent).filter(AuthorizedStudent.class_group == class_group.strip()).delete()
    db.commit()
    return {"status": "success", "message": f"Deleted {deleted} students from group '{class_group}'."}

@app.post("/students/upload")
async def upload_students_csv(
    file: UploadFile = File(...),
    class_group_override: str | None = Form(None),
    db: Session = Depends(get_db)
):
    import csv
    import io
    content = await file.read()
    try:
        csv_text = content.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Must be UTF-8 CSV.")

    # Normalize override: empty string treated as None
    override = class_group_override.strip() if class_group_override and class_group_override.strip() else None

    reader = csv.DictReader(io.StringIO(csv_text))
    student_count = 0
    final_group = override  # May be refined below if no override
    for row in reader:
        sid = row.get("student_id") or row.get("registration_id") or row.get("id")
        sname = row.get("student_name") or row.get("name")
        passcode = row.get("passcode") or row.get("password") or row.get("pass")
        # If override supplied, use it; otherwise read from CSV column
        if override:
            class_group = override
        else:
            csv_group = row.get("class_group") or row.get("class") or row.get("group")
            class_group = csv_group.strip() if csv_group else None

        if not sid or not sname or not passcode:
            continue

        sid = sid.strip()
        sname = sname.strip()
        passcode = passcode.strip()
        if class_group and not final_group:
            final_group = class_group  # Track first resolved group for response

        # Upsert
        student = db.query(AuthorizedStudent).filter(AuthorizedStudent.student_id == sid).first()
        if student:
            student.student_name = sname
            student.passcode = passcode
            student.class_group = class_group  # Always update group (even to None if no group set)
        else:
            student = AuthorizedStudent(student_id=sid, student_name=sname, passcode=passcode, class_group=class_group)
            db.add(student)
        student_count += 1

    db.commit()
    msg = f"Successfully imported {student_count} students."
    if final_group:
        msg += f" Class group: '{final_group}'."
    return {"status": "success", "message": msg, "class_group": final_group}

@app.post("/questions/upload")
async def upload_questions_file(
    file: UploadFile = File(...),
    exam_id: str | None = Form(None),
    db: Session = Depends(get_db)
):
    import csv
    import io
    content = await file.read()
    filename = file.filename.lower()
    file_base = filename.split(".")[0].strip()

    form_id = exam_id.strip() if (exam_id and exam_id.strip()) else ""
    
    # Prioritize form_id if provided by invigilator in dashboard UI
    if form_id:
        target_exam_id = form_id
    elif file_base:
        target_exam_id = file_base
    else:
        target_exam_id = "exam_cohort_1"

    existing_exam = db.query(ExamModel).filter(ExamModel.id == target_exam_id).first()
    if existing_exam and existing_exam.title:
        target_exam_title = existing_exam.title
    else:
        target_exam_title = target_exam_id.replace("_", " ").title()

    questions_loaded = 0
    parsed_questions = []

    if filename.endswith(".json"):
        try:
            data = json.loads(content.decode("utf-8"))
            if not isinstance(data, list):
                raise ValueError("JSON file must contain a list of questions.")
            
            # If no form_id was passed, look at first item to see if it provides exam metadata
            if not form_id and len(data) > 0:
                first_item = data[0]
                if "exam_id" in first_item:
                    target_exam_id = str(first_item["exam_id"]).strip()
                if "exam_name" in first_item:
                    target_exam_title = str(first_item["exam_name"]).strip()
                elif "exam_title" in first_item:
                    target_exam_title = str(first_item["exam_title"]).strip()

            for item in data:
                text_q = item.get("text")
                options = item.get("options")
                correct = item.get("correct_option_idx", 0)
                if not text_q or not isinstance(options, list) or len(options) != 4:
                    continue
                parsed_questions.append({
                    "text": text_q,
                    "options": options,
                    "correct": int(correct)
                })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse JSON file: {e}")
    else:
        # Default to CSV parsing
        try:
            csv_text = content.decode("utf-8")
            reader = csv.DictReader(io.StringIO(csv_text))
            rows = list(reader)
            
            # If no form_id was passed, look at first row to see if it provides exam metadata
            if not form_id and len(rows) > 0:
                first_row = rows[0]
                if first_row.get("exam_id"):
                    target_exam_id = str(first_row.get("exam_id")).strip()
                if first_row.get("exam_name"):
                    target_exam_title = str(first_row.get("exam_name")).strip()
                elif first_row.get("exam_title"):
                    target_exam_title = str(first_row.get("exam_title")).strip()

            for row in rows:
                text_q = row.get("text")
                opt0 = row.get("option_0") or row.get("option0")
                opt1 = row.get("option_1") or row.get("option1")
                opt2 = row.get("option_2") or row.get("option2")
                opt3 = row.get("option_3") or row.get("option3")
                correct = row.get("correct_option_idx") or row.get("correct") or "0"

                if not text_q or not opt0 or not opt1 or not opt2 or not opt3:
                    continue

                options = [opt0.strip(), opt1.strip(), opt2.strip(), opt3.strip()]
                parsed_questions.append({
                    "text": text_q.strip(),
                    "options": options,
                    "correct": int(correct)
                })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse CSV file: {e}")

    if not target_exam_id:
        target_exam_id = form_id or file_base or "exam_cohort_1"
    if not target_exam_title:
        target_exam_title = target_exam_id.replace("_", " ").title()

    # Create/Update ExamModel and set it to active
    exam = db.query(ExamModel).filter(ExamModel.id == target_exam_id).first()
    if not exam:
        exam = ExamModel(id=target_exam_id, title=target_exam_title, description=f"Exam cohort '{target_exam_id}'", active=True)
        db.add(exam)
    else:
        if target_exam_title:
            exam.title = target_exam_title
        exam.active = True
    db.commit()

    # WIPE existing questions for this specific exam cohort
    db.query(QuestionModel).filter(QuestionModel.exam_id == target_exam_id).delete()
    db.commit()

    # Save all parsed questions
    for pq in parsed_questions:
        q = QuestionModel(
            exam_id=target_exam_id,
            text=pq["text"],
            options_json=json.dumps(pq["options"]),
            correct_option_idx=pq["correct"]
        )
        db.add(q)
        questions_loaded += 1
    db.commit()

    return {
        "status": "success",
        "message": f"Successfully loaded {questions_loaded} questions into database for exam '{target_exam_title}' ({target_exam_id}).",
        "exam_id": target_exam_id,
        "exam_title": target_exam_title
    }

@app.post("/session/{session_id}/submit")
async def submit_exam_grading(session_id: str, req: ExamSubmitRequest, db: Session = Depends(get_db)):
    session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found.")

    if session.status == "completed":
        # Already graded, just return previous result if available
        try:
            score_parts = session.score.split("/")
            correct = int(score_parts[0])
            total = int(score_parts[1])
        except Exception:
            correct = 0
            total = 0
        return {
            "status": "already_submitted",
            "correct_answers": correct,
            "total_questions": total,
            "percentage": session.percentage or 0.0,
            "student_id": session.student_id
        }

    # Fetch questions for this session's exam_id
    exam_id = session.exam_id or "default"
    db_questions = db.query(QuestionModel).filter(QuestionModel.exam_id == exam_id).all()
    q_map = {q.id: q.correct_option_idx for q in db_questions}

    total_questions = len(db_questions)
    correct_answers = 0

    # Compare answers
    for q_id_str, selected_idx in req.answers.items():
        try:
            q_id = int(q_id_str)
        except ValueError:
            continue
        if q_id in q_map and q_map[q_id] == selected_idx:
            correct_answers += 1

    percentage = round((correct_answers / total_questions) * 100, 1) if total_questions > 0 else 0.0

    # Complete the session details
    session.status = "completed"
    session.end_time = datetime.utcnow()
    session.score = f"{correct_answers}/{total_questions}"
    session.percentage = percentage
    db.commit()

    # Broadcast session completion status to dashboard
    broadcast_task = {
        "type": "session_status",
        "session_id": session_id,
        "student_id": session.student_id,
        "status": "completed",
        "end_time": session.end_time.isoformat(),
        "score": session.score,
        "percentage": percentage
    }
    await manager.broadcast_to_dashboards(broadcast_task)

    return {
        "status": "success",
        "correct_answers": correct_answers,
        "total_questions": total_questions,
        "percentage": percentage,
        "student_id": session.student_id
    }
