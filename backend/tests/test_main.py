import os
import pytest
import json
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.models import Base, ExamSession, SessionAlert, AuthorizedStudent, QuestionModel, ExamModel
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
    
    # Pre-populate default exam, authorized students and questions for testing
    db = TestingSessionLocal()
    db.add(ExamModel(id="default", title="Default Proctoring Exam", description="General proctoring questions"))
    db.add(AuthorizedStudent(student_id="STUDENT-TEST-01", student_name="Alice Test", passcode="secret123"))
    db.add(AuthorizedStudent(student_id="STUDENT-TEST-02", student_name="Bob Test", passcode="secret456"))
    
    db.add(QuestionModel(id=101, exam_id="default", text="What is 1+1?", options_json=json.dumps(["1", "2", "3", "4"]), correct_option_idx=1))
    db.add(QuestionModel(id=102, exam_id="default", text="What is 2+2?", options_json=json.dumps(["2", "3", "4", "5"]), correct_option_idx=2))
    db.commit()
    db.close()

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

def test_start_session_unauthorized():
    # Bad registration ID
    response = client.post("/session/start", json={"student_id": "UNKNOWN", "passcode": "secret123", "exam_id": "default"})
    assert response.status_code == 401
    assert "Registration ID not found" in response.json()["detail"]

    # Bad passcode
    response = client.post("/session/start", json={"student_id": "STUDENT-TEST-01", "passcode": "wrong_code", "exam_id": "default"})
    assert response.status_code == 401
    assert "Incorrect passcode" in response.json()["detail"]

def test_start_session_success():
    response = client.post("/session/start", json={"student_id": "STUDENT-TEST-01", "passcode": "secret123", "exam_id": "default"})
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert data["student_id"] == "STUDENT-TEST-01"
    assert data["status"] == "active"

def test_students_upload_csv():
    csv_data = "student_id,student_name,passcode\nSTUDENT-CSV-01,Charlie,pass123\nSTUDENT-CSV-02,David,pass456\n"
    files = {"file": ("students.csv", csv_data, "text/csv")}
    response = client.post("/students/upload", files=files)
    assert response.status_code == 200
    assert "Successfully imported 2 students" in response.json()["message"]

    # Verify listing
    res_list = client.get("/students")
    assert res_list.status_code == 200
    ids = [s["student_id"] for s in res_list.json()]
    assert "STUDENT-CSV-01" in ids
    assert "STUDENT-CSV-02" in ids

def test_create_and_get_exams():
    # Create exam
    resp = client.post("/exams", json={"id": "cyber_exam", "title": "Cybersecurity Exam"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"

    # Get exams
    resp = client.get("/exams")
    assert resp.status_code == 200
    exams = resp.json()
    ids = [e["id"] for e in exams]
    assert "cyber_exam" in ids
    assert "default" in ids

    # Toggle active
    resp_toggle = client.post("/exams/cyber_exam/toggle-active")
    assert resp_toggle.status_code == 200
    assert resp_toggle.json()["active"] is False

    # Get student view (should filter out cyber_exam since active is False)
    resp_student = client.get("/exams?student_view=true")
    assert resp_student.status_code == 200
    student_ids = [e["id"] for e in resp_student.json()]
    assert "cyber_exam" not in student_ids
    assert "default" in student_ids

    # Toggle active back to True
    resp_toggle2 = client.post("/exams/cyber_exam/toggle-active")
    assert resp_toggle2.status_code == 200
    assert resp_toggle2.json()["active"] is True

    # Get student view again
    resp_student2 = client.get("/exams?student_view=true")
    assert resp_student2.status_code == 200
    student_ids2 = [e["id"] for e in resp_student2.json()]
    assert "cyber_exam" in student_ids2

def test_questions_upload_by_exam():
    csv_data = "text,option_0,option_1,option_2,option_3,correct_option_idx\nWhat is a firewall?,software,hardware,both,neither,2\n"
    files = {"file": ("cyber.csv", csv_data, "text/csv")}
    # Form data parameter 'exam_id'
    response = client.post("/questions/upload", files=files, data={"exam_id": "cyber_exam"})
    assert response.status_code == 200
    assert "Successfully loaded 1 questions" in response.json()["message"]

    # Retrieve default questions - firewall shouldn't be there
    res_def = client.get("/questions?exam_id=default")
    assert res_def.status_code == 200
    texts = [q["text"] for q in res_def.json()]
    assert "What is a firewall?" not in texts

    # Retrieve cyber questions - firewall should be there
    res_cyber = client.get("/questions?exam_id=cyber_exam")
    assert res_cyber.status_code == 200
    texts = [q["text"] for q in res_cyber.json()]
    assert "What is a firewall?" in texts

def test_exam_grading_submission():
    # Start a session
    start_resp = client.post("/session/start", json={"student_id": "STUDENT-TEST-02", "passcode": "secret456", "exam_id": "default"})
    session_id = start_resp.json()["session_id"]

    # Submit answers: Q101 correct option is 1, Q102 correct option is 2
    # Submit correct answer for 101, wrong answer for 102
    submit_payload = {
        "answers": {
            "101": 1,
            "102": 0
        }
    }
    sub_resp = client.post(f"/session/{session_id}/submit", json=submit_payload)
    assert sub_resp.status_code == 200
    res_data = sub_resp.json()
    assert res_data["correct_answers"] == 1
    assert res_data["total_questions"] == 2
    assert res_data["percentage"] == 50.0

    # Verify session status is updated in report
    rep_resp = client.get(f"/session/{session_id}/report")
    assert rep_resp.status_code == 200
    rep_data = rep_resp.json()
    assert rep_data["status"] == "completed"
    assert rep_data["score"] == "1/2"
    assert rep_data["percentage"] == 50.0

    # Verify exam stats are computed correctly
    stats_resp = client.get("/exams/default/stats")
    assert stats_resp.status_code == 200
    stats_data = stats_resp.json()
    assert stats_data["total_completed"] >= 1
    assert stats_data["top_score"] == "50.0%"
