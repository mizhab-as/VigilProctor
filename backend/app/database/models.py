import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DB_PATH = os.environ.get("DB_PATH")
if DB_PATH:
    # Ensure parent directory of DB_PATH exists
    parent_dir = os.path.dirname(DB_PATH)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    DATABASE_URL = f"sqlite:///{DB_PATH}"
else:
    DB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data"))
    os.makedirs(DB_DIR, exist_ok=True)
    DATABASE_URL = f"sqlite:///{os.path.join(DB_DIR, 'examguard.db')}"

Base = declarative_base()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class ExamModel(Base):
    __tablename__ = "exams"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    active = Column(Boolean, default=True, nullable=False)

class ExamSession(Base):
    __tablename__ = "exam_sessions"

    id = Column(String, primary_key=True, index=True)
    student_id = Column(String, index=True, nullable=False)
    exam_id = Column(String, ForeignKey("exams.id"), nullable=True, default="default")
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
    exam_id = Column(String, ForeignKey("exams.id"), nullable=False, default="default")
    text = Column(String, nullable=False)
    options_json = Column(String, nullable=False) # JSON encoded list of options
    correct_option_idx = Column(Integer, default=0, nullable=False)

class AuthorizedStudent(Base):
    __tablename__ = "authorized_students"

    student_id = Column(String, primary_key=True, index=True)
    student_name = Column(String, nullable=False)
    passcode = Column(String, nullable=False)
    class_group = Column(String, nullable=True)  # e.g. "CS-2026-A"

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

        # Check exam_id in questions
        try:
            conn.execute(text("SELECT exam_id FROM questions LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE questions ADD COLUMN exam_id VARCHAR DEFAULT 'default'"))
                print("[DATABASE] Altered table questions to add exam_id column.")
            except Exception as e:
                print(f"[DATABASE] Alter table exam_id failed on questions: {e}")

        # Check exam_id in exam_sessions
        try:
            conn.execute(text("SELECT exam_id FROM exam_sessions LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE exam_sessions ADD COLUMN exam_id VARCHAR DEFAULT 'default'"))
                print("[DATABASE] Altered table exam_sessions to add exam_id column.")
            except Exception as e:
                print(f"[DATABASE] Alter table exam_id failed on exam_sessions: {e}")

        # Check active in exams
        try:
            conn.execute(text("SELECT active FROM exams LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE exams ADD COLUMN active BOOLEAN DEFAULT 1"))
                print("[DATABASE] Altered table exams to add active column.")
            except Exception as e:
                print(f"[DATABASE] Alter table active failed on exams: {e}")

        # Check class_group in authorized_students
        try:
            conn.execute(text("SELECT class_group FROM authorized_students LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE authorized_students ADD COLUMN class_group VARCHAR"))
                print("[DATABASE] Altered table authorized_students to add class_group column.")
            except Exception as e:
                print(f"[DATABASE] Alter table class_group failed on authorized_students: {e}")

    # Initialize database schemas
    pass
