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

    session = relationship("ExamSession", back_populates="alerts")

def init_db():
    Base.metadata.create_all(bind=engine)
