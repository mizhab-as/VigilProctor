import os
import uuid
import base64
import json
import asyncio
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.keyframe import MotionKeyframeExtractor
from app.core.inference import ExamGuardInferenceEngine
from app.database.models import init_db, SessionLocal, ExamSession, SessionAlert, QuestionModel

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

class QuestionCreate(BaseModel):
    text: str
    options: list[str]

@app.get("/questions")
def get_questions(db: Session = Depends(get_db)):
    questions = db.query(QuestionModel).all()
    result = []
    for q in questions:
        try:
            options = json.loads(q.options_json)
        except Exception:
            options = []
        result.append({
            "id": q.id,
            "text": q.text,
            "options": options
        })
    return result

@app.post("/questions")
def create_question(req: QuestionCreate, db: Session = Depends(get_db)):
    if len(req.options) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 options are required")
    new_q = QuestionModel(
        text=req.text,
        options_json=json.dumps(req.options)
    )
    db.add(new_q)
    db.commit()
    db.refresh(new_q)
    return {
        "id": new_q.id,
        "text": new_q.text,
        "options": req.options
    }

@app.post("/session/start")
async def start_session(req: SessionStartRequest, db: Session = Depends(get_db)):
    session_id = str(uuid.uuid4())
    new_session = ExamSession(
        id=session_id,
        student_id=req.student_id,
        start_time=datetime.utcnow(),
        status="active"
    )
    db.add(new_session)
    db.commit()
    
    # Broadcast session initialization to dashboard
    broadcast_task = {
        "type": "session_status",
        "session_id": session_id,
        "student_id": req.student_id,
        "status": "active",
        "start_time": new_session.start_time.isoformat()
    }
    await manager.broadcast_to_dashboards(broadcast_task)

    return {
        "session_id": session_id,
        "student_id": req.student_id,
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

@app.get("/sessions")
def get_all_sessions(student_id: str = "", db: Session = Depends(get_db)):
    """Return completed sessions, optionally filtered by student_id substring."""
    query = db.query(ExamSession).filter(ExamSession.status == "completed")
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
            "start_time": s.start_time.isoformat(),
            "end_time": s.end_time.isoformat() if s.end_time else None,
            "status": s.status,
            "alert_count": alert_count,
            "status_color": status_color
        })
    return result

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
            "timestamp": a.timestamp.isoformat(),
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
        "start_time": session.start_time.isoformat(),
        "end_time": session.end_time.isoformat() if session.end_time else None,
        "status": session.status,
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
