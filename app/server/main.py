import json
import asyncio
import cv2
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from app.database.models import init_db, SessionLocal, AnomalyLog
from app.core.keyframe_detector import MotionKeyframeExtractor
from app.core.vision_engine import VigilProctorEngine

app = FastAPI(title="VigilProctor AI Systems")
templates = Jinja2Templates(directory="app/templates")

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

manager = ConnectionManager()

@app.on_event("startup")
def startup_event():
    init_db()

@app.get("/", response_class=HTMLResponse)
def get_dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Simple heartbeat pattern processing step
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        manager.disconnect(websocket)

async def run_local_proctoring_loop(student_id: str):
    """
    Main background runtime execution loop running client-side frame processing.
    """
    cap = cv2.VideoCapture(0)
    extractor = MotionKeyframeExtractor()
    engine = VigilProctorEngine()
    db = SessionLocal()

    print(f"[ENGINE RUNTIME] Invigilation initialization complete for: {student_id}")

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # Execute localized motion keyframing checks before evaluating deep learning paths
            if extractor.should_process_frame(frame):
                anomalies = engine.analyze_frame(frame)
                
                for anomaly in anomalies:
                    # Persist event telemetry inside database metrics
                    log_entry = AnomalyLog(
                        student_id=student_id,
                        anomaly_type=anomaly["type"],
                        confidence=anomaly["confidence"]
                    )
                    db.add(log_entry)
                    db.commit()

                    # Propagate event details globally down real-time active websockets
                    payload = {
                        "student_id": student_id,
                        "anomaly_type": anomaly["type"],
                        "confidence": round(anomaly["confidence"] * 100, 2),
                        "timestamp": log_entry.timestamp.strftime("%H:%M:%S")
                    }
                    await manager.broadcast(json.dumps(payload))

            await asyncio.sleep(0.03)  # Maintain standard frame rendering constraints
    except Exception as e:
        print(f"[CRITICAL ERROR] Execution failures encountered inside proctoring loop: {e}")
    finally:
        cap.release()
        db.close()

@app.post("/proctor/start/{student_id}")
async def start_proctor_session(student_id: str):
    asyncio.create_task(run_local_proctoring_loop(student_id))
    return {"status": "Execution thread started tracking session", "student_id": student_id}
