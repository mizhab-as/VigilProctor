# ExamGuard AI — Proctoring & Examination Integrity Suite

ExamGuard AI is a real-time online exam proctoring system based on motion-based keyframe extraction, edge-side neural inference, multi-modal sensor fusion, and invigilator dashboard visualization.

---

## 🏛️ Project Architecture

```
VigilProctor (Monorepo)
├── client/          ← Student Exam Portal (React/Vite)
├── dashboard/       ← Invigilator Control Station (React/Vite)
└── backend/         ← FastAPI Proctoring Backend (Python/SQLite)
```

---

## 🚀 Running Locally

To launch the entire suite locally in one command, run:

```bash
chmod +x run.sh
./run.sh
```

This starts:
- **Unified Portal Selection Screen / Student Sign-In:** [http://localhost:3000](http://localhost:3000)
- **Invigilator Admin Dashboard:** [http://localhost:3001/admin/](http://localhost:3001/admin/)
- **FastAPI Backend server:** [http://localhost:8000](http://localhost:8000)

*Credentials for testing:*
- Student: (Upload `test/class_a_students.csv` in the directory, use any credentials from it)
- Invigilator: Username: `admin`, Password: `admin123`

---

## ☁️ Production Deployment (Render + Vercel)

### Step 1: Deploy Backend (Render / Railway)
Mount the backend on a platform that supports persistent web sockets:
- Set **Root Directory** to `backend`.
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Select **Python 3** and add environment variable `PYTHON_VERSION=3.11.0`.

### Step 2: Deploy Unified Frontend (Vercel)
Deploy both the Student Portal and Invigilator Dashboard as a single deployment on Vercel:
- Import the root repository.
- Keep **Root Directory** as the root (`/`).
- Add the following **Environment Variables**:
  - `VITE_API_URL` = `https://your-backend-url.onrender.com`
  - `VITE_WS_URL` = `wss://your-backend-url.onrender.com`
- Click **Deploy**.

*Visiting the Vercel link will show the beautiful role selector where you can jump between student portal and admin console.*
