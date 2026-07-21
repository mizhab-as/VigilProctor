# ExamGuard AI — Proctoring & Examination Integrity Suite

ExamGuard AI is a real-time online exam proctoring system based on motion-based keyframe extraction, edge-side neural inference, multi-modal sensor fusion, and invigilator dashboard visualization.

---

## 🏛️ Project Architecture

```
VigilProctor (Monorepo)
├── client/          ← Unified Client Portal (React/Vite - Houses Student & Admin views)
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
- **Unified Landing Page (Portal Selector):** [http://localhost:3000](http://localhost:3000)
- **FastAPI Backend Server:** [http://localhost:8000](http://localhost:8000)

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

### Step 2: Deploy Frontend (Vercel)
Deploy the unified client portal as a single deployment on Vercel:
- Import the root repository.
- Set **Root Directory** to `client`.
- Add the following **Environment Variables**:
  - `VITE_API_URL` = `https://your-backend-url.onrender.com`
  - `VITE_WS_URL` = `wss://your-backend-url.onrender.com`
- Click **Deploy**.

*Visiting the single Vercel link will show the beautiful role selector where you can jump between student portal and admin console.*
