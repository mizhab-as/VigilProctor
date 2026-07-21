#!/bin/bash

# Terminate all background processes on exit (Ctrl+C)
trap "kill 0" EXIT

echo "================================================="
# Start FastAPI backend server
echo "🚀 [1/2] Launching FastAPI Backend Server..."
source venv/bin/activate
cd backend
python run.py &
cd ..

# Start Student & Admin Unified Client
echo "🚀 [2/2] Launching Unified Web Portal..."
cd client
npm run dev &
cd ..

echo "================================================="
echo "✅ All services successfully launched!"
echo "• Unified Web Portal:  http://localhost:3000"
echo "• Backend FastAPI:     http://localhost:8000"
echo "Press [Ctrl+C] to stop all services simultaneously."
echo "================================================="

# Wait for all background jobs to finish
wait
