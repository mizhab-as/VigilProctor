import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data"))
os.makedirs(DB_DIR, exist_ok=True)
DATABASE_URL = f"sqlite:///{os.path.join(DB_DIR, 'examguard.db')}"

Base = declarative_base()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class ExamSession(Base):
    __tablename__ = "exam_sessions"

    id = Column(String, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # "active" or "completed"
    score = Column(String, nullable=True) # e.g., "3/4"
    percentage = Column(Float, nullable=True) # e.g., 75.0

    alerts = relationship("SessionAlert", back_populates="session", cascade="all, delete-orphan")

class SessionAlert(Base):
    __tablename__ = "session_alerts"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("exam_sessions.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    anomaly_type = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    frame_path = Column(String, nullable=True)
    thumbnail_path = Column(String, nullable=True)
    video_clip_path = Column(String, nullable=True)
    override_status = Column(String, default="pending", nullable=False)

    session = relationship("ExamSession", back_populates="alerts")

class QuestionModel(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    text = Column(String, nullable=False)
    options_json = Column(String, nullable=False) # JSON encoded list of options
    correct_option_idx = Column(Integer, default=0, nullable=False)

class AuthorizedStudent(Base):
    __tablename__ = "authorized_students"

    student_id = Column(String, primary_key=True, index=True)
    student_name = Column(String, nullable=False)
    passcode = Column(String, nullable=False)

def init_db():
    Base.metadata.create_all(bind=engine)
    # Check if columns exist, if not, add them
    from sqlalchemy import text
    with engine.connect() as conn:
        # Check video_clip_path in session_alerts
        try:
            conn.execute(text("SELECT video_clip_path FROM session_alerts LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE session_alerts ADD COLUMN video_clip_path VARCHAR"))
                print("[DATABASE] Altered table session_alerts to add video_clip_path column.")
            except Exception as e:
                print(f"[DATABASE] Alter table video_clip_path failed: {e}")

        # Check override_status in session_alerts
        try:
            conn.execute(text("SELECT override_status FROM session_alerts LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE session_alerts ADD COLUMN override_status VARCHAR DEFAULT 'pending'"))
                print("[DATABASE] Altered table session_alerts to add override_status column.")
            except Exception as e:
                print(f"[DATABASE] Alter table override_status failed: {e}")

        # Check correct_option_idx in questions
        try:
            conn.execute(text("SELECT correct_option_idx FROM questions LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE questions ADD COLUMN correct_option_idx INTEGER DEFAULT 0"))
                conn.execute(text("UPDATE questions SET correct_option_idx = 0"))
                print("[DATABASE] Altered table questions to add correct_option_idx column.")
            except Exception as e:
                print(f"[DATABASE] Alter table correct_option_idx failed: {e}")

        # Check score in exam_sessions
        try:
            conn.execute(text("SELECT score FROM exam_sessions LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE exam_sessions ADD COLUMN score VARCHAR"))
                print("[DATABASE] Altered table exam_sessions to add score column.")
            except Exception as e:
                print(f"[DATABASE] Alter table score failed: {e}")

        # Check percentage in exam_sessions
        try:
            conn.execute(text("SELECT percentage FROM exam_sessions LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE exam_sessions ADD COLUMN percentage FLOAT"))
                print("[DATABASE] Altered table exam_sessions to add percentage column.")
            except Exception as e:
                print(f"[DATABASE] Alter table percentage failed: {e}")

    # Initialize questions if empty
    import json
    db_session = SessionLocal()
    try:
        count = db_session.query(QuestionModel).count()
        if count == 0:
            print("[DATABASE] Initializing default exam questions...")
            default_questions = [
                {
                    "text": "According to Ramzan et al. (2024), which CNN/Object Detection architecture achieved the highest performance for online exam proctoring?",
                    "options": ["DenseNet121", "Inception-V3", "Inception-ResNetV2", "YOLOv5"],
                    "correct": 3
                },
                {
                    "text": "In motion-based keyframe extraction, what is the role of the frame differencing threshold?",
                    "options": [
                        "To compress the video streams and reduce storage overhead on the server",
                        "To eliminate redundant static frames and only pass high-motion transitions to the classification model",
                        "To enhance image resolution and lighting levels using histogram models",
                        "To track audio level anomalies and background voice cues"
                    ],
                    "correct": 1
                },
                {
                    "text": "What is the primary benefit of deploying a WebSocket connection instead of HTTP polling in online proctoring systems?",
                    "options": [
                        "Securing the database from SQL Injection",
                        "Reducing connection establishment overhead and enabling low-latency, real-time alert broadcasts",
                        "Avoiding the need for client-side webcam permissions",
                        "Enabling off-grid local storage without network streams"
                    ],
                    "correct": 1
                },
                {
                    "text": "Which of the following is a privacy-by-design policy recommended for proctoring systems?",
                    "options": [
                        "Persisting 24/7 continuous video logs of students' rooms",
                        "Storing only the keyframes classified as abnormal, and immediately discarding normal frames",
                        "Uploading all user credentials directly to public clouds",
                        "Disabling all local webcam warnings"
                    ],
                    "correct": 1
                }
            ]
            for dq in default_questions:
                q = QuestionModel(
                    text=dq["text"],
                    options_json=json.dumps(dq["options"]),
                    correct_option_idx=dq["correct"]
                )
                db_session.add(q)
            db_session.commit()
            print("[DATABASE] Default exam questions populated successfully.")
    except Exception as e:
        print(f"[DATABASE] Question initialization failed: {e}")
        db_session.rollback()
    finally:
        db_session.close()
