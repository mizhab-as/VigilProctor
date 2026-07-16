import os
import uuid
import base64
import json
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.keyframe import MotionKeyframeExtractor
from app.core.inference import ExamGuardInferenceEngine
from app.database.models import init_db, SessionLocal, ExamSession, SessionAlert

# Initialize directories for image persistence
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data"))
FRAMES_DIR = os.path.join(DATA_DIR, "frames")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")
os.makedirs(FRAMES_DIR, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)

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
    sessions = db.query(ExamSession).filter(ExamSession.status == "active").all()
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
            "thumbnail_path": a.thumbnail_path
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
                    "session_id": session_id,
                    "student_id": session.student_id,
                    "anomaly_type": label,
                    "confidence": round(float(confidence) * 100, 1),
                    "timestamp": new_alert.timestamp.isoformat(),
                    "thumbnail_path": new_alert.thumbnail_path,
                    "frame_path": new_alert.frame_path
                }
                await manager.broadcast_to_dashboards(alert_payload)

                # Send warnings back to student UI
                await websocket.send_json({
                    "type": "warning",
                    "message": f"Suspicious Activity Detected: {label}. Please remain focused on the exam."
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
                        "session_id": session_id,
                        "student_id": session.student_id,
                        "anomaly_type": "Interface Violation (Tab Switch)",
                        "confidence": 100.0,
                        "timestamp": new_alert.timestamp.isoformat(),
                        "thumbnail_path": None,
                        "frame_path": None
                    }
                    await manager.broadcast_to_dashboards(alert_payload)
                    
                    await websocket.send_json({
                        "type": "warning",
                        "message": "Security Warning: Leaving the exam screen is logged as a violation!"
                    })

    except WebSocketDisconnect:
        manager.disconnect_student(session_id)
    except Exception as e:
        print(f"[ERROR] WebSocket connection error on session {session_id}: {e}")
        manager.disconnect_student(session_id)

# WebSocket endpoint for dashboard
@app.websocket("/dashboard/alerts")
async def dashboard_alerts(websocket: WebSocket):
    await manager.connect_dashboard(websocket)
    try:
        while True:
            # Maintain connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_dashboard(websocket)
