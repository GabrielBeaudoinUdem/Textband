#!/bin/bash
# ============================================================
# TextBand V2 — Launch Script
# Starts both FastAPI backend and Next.js frontend
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# Sync unified root configuration
if [ -f "$SCRIPT_DIR/.env" ]; then
  echo "⚙️ Syncing unified configuration from root .env..."
  cp "$SCRIPT_DIR/.env" "$BACKEND_DIR/.env"
  cp "$SCRIPT_DIR/.env" "$FRONTEND_DIR/.env.local"
else
  echo "⚠️ Root .env file not found! Proceeding with existing configuration..."
fi

echo "🎵 TextBand V2 — Starting..."
echo "================================"

# Start FastAPI backend
echo "🔧 Starting Whisper STT server (port 8000)..."
cd "$BACKEND_DIR"
python3 server.py --port 8000 &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Start Next.js frontend
echo "🌐 Starting Next.js frontend (port 3000)..."
cd "$FRONTEND_DIR"
npm install
npm run dev &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

echo ""
echo "================================"
echo "✅ TextBand V2 is running!"
echo "   Frontend:  http://localhost:3000"
echo "   Backend:   http://localhost:8000"
echo "   LM Studio: http://localhost:1234 (start separately)"
echo "   In the .env you can choose an api LLM"
echo ""
echo "Press Ctrl+C to stop all services."
echo "================================"

# Trap Ctrl+C to kill both processes
cleanup() {
  echo ""
  echo "🛑 Shutting down TextBand V2..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID 2>/dev/null
  wait $FRONTEND_PID 2>/dev/null
  
  # Remove temporary synced env files
  rm -f "$BACKEND_DIR/.env" "$FRONTEND_DIR/.env.local"
  
  echo "Done."
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for both
wait
