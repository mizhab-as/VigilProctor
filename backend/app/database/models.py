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

def init_db():
    Base.metadata.create_all(bind=engine)
    # Check if columns exist, if not, add them
    from sqlalchemy import text
    with engine.connect() as conn:
        # Check video_clip_path
        try:
            conn.execute(text("SELECT video_clip_path FROM session_alerts LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE session_alerts ADD COLUMN video_clip_path VARCHAR"))
                print("[DATABASE] Altered table session_alerts to add video_clip_path column.")
            except Exception as e:
                print(f"[DATABASE] Alter table video_clip_path failed: {e}")

        # Check override_status
        try:
            conn.execute(text("SELECT override_status FROM session_alerts LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE session_alerts ADD COLUMN override_status VARCHAR DEFAULT 'pending'"))
                print("[DATABASE] Altered table session_alerts to add override_status column.")
            except Exception as e:
                print(f"[DATABASE] Alter table override_status failed: {e}")
