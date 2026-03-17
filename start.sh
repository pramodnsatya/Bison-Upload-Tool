#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   EmailBison Campaign Deployer — Starting    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is required. Install from https://nodejs.org (v18 or higher)"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js v18 or higher required. Current: $(node -v)"
  exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install backend deps
echo ""
echo "📦 Installing backend dependencies..."
cd "$(dirname "$0")/backend"
npm install --silent

# Install frontend deps
echo "📦 Installing frontend dependencies..."
cd "../frontend"
npm install --silent

echo ""
echo "🚀 Starting backend on http://localhost:3847..."
cd "../backend"
node server.js &
BACKEND_PID=$!

echo "🌐 Starting frontend on http://localhost:3000..."
cd "../frontend"
export BROWSER=none
npm start &
FRONTEND_PID=$!

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ Tool running at: http://localhost:3000   ║"
echo "║  Press Ctrl+C to stop                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Cleanup on exit
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
