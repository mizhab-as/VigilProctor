import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.models import Base, ExamSession, SessionAlert
from app.main import app, get_db

# Use a test-specific file-based SQLite database
TEST_DB_FILE = "test_examguard.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_DB_FILE}"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override get_db dependency
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="module", autouse=True)
def setup_database():
    # Clean setup
    if os.path.exists(TEST_DB_FILE):
        os.remove(TEST_DB_FILE)
    
    Base.metadata.create_all(bind=engine)
    yield
    
    # Tear down
    Base.metadata.drop_all(bind=engine)
    if os.path.exists(TEST_DB_FILE):
        try:
            os.remove(TEST_DB_FILE)
        except Exception:
            pass

# Initialize test client within context manager to trigger startup events if any
client = TestClient(app)

def test_start_session():
    response = client.post("/session/start", json={"student_id": "test_student_123"})
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert data["student_id"] == "test_student_123"
    assert data["status"] == "active"

def test_end_session():
    # Start a session first
    start_resp = client.post("/session/start", json={"student_id": "test_student_456"})
    session_id = start_resp.json()["session_id"]
    
    # End the session
    end_resp = client.post(f"/session/{session_id}/end")
    assert end_resp.status_code == 200
    assert end_resp.json()["status"] == "completed"

def test_get_active_sessions():
    # Start a session
    client.post("/session/start", json={"student_id": "test_student_789"})
    
    response = client.get("/session/active")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    # Check if our started session is in the active list
    student_ids = [s["student_id"] for s in data]
    assert "test_student_789" in student_ids

def test_session_not_found_errors():
    response = client.post("/session/non_existent_session_id/end")
    assert response.status_code == 404
    
    response = client.get("/session/non_existent_session_id/report")
    assert response.status_code == 404
