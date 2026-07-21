#!/bin/bash

# Terminate all background processes on exit (Ctrl+C)
trap "kill 0" EXIT

echo "================================================="
# Start FastAPI backend server
echo "🚀 [1/3] Launching FastAPI Backend Server..."
source venv/bin/activate
cd backend
python run.py &
cd ..

# Start Student Client
echo "🚀 [2/3] Launching Student Exam Portal..."
cd client
npm run dev &
cd ..

# Start Invigilator Dashboard
echo "🚀 [3/3] Launching Invigilator Control Station..."
cd dashboard
npm run dev &
cd ..

echo "================================================="
echo "✅ All services successfully launched!"
echo "• Student Portal:   http://localhost:3000"
echo "• Invigilator App:  http://localhost:3001/admin/"
echo "• Backend FastAPI:  http://localhost:8000"
echo "Press [Ctrl+C] to stop all services simultaneously."
echo "================================================="

# Wait for all background jobs to finish
wait
