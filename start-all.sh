#!/bin/bash

# MÜSE MUSE - Startup Script
# Starts Node.js backend. Backend calls Python locally for transcription.

echo "🎵 Starting MÜSE..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for Node.js
if ! command_exists node; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Python is required for transcription. Use Python 3.11 if available, fallback to python3
PYTHON_CMD="python3"
if [ -f "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3" ]; then
    PYTHON_CMD="/Library/Frameworks/Python.framework/Versions/3.11/bin/python3"
    echo -e "${GREEN}✓ Using Python 3.11${NC}"
elif [ -f "/opt/homebrew/bin/python3.11" ]; then
    PYTHON_CMD="/opt/homebrew/bin/python3.11"
    echo -e "${GREEN}✓ Using Python 3.11${NC}"
fi

if command_exists "$PYTHON_CMD"; then
  PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
  echo -e "${BLUE}Python version: ${PYTHON_VERSION}${NC}"
  if [[ "$PYTHON_VERSION" =~ ^3\.(12|13|14|15) ]]; then
      echo -e "${YELLOW}⚠️  Warning: Python $PYTHON_VERSION may not be compatible with Basic Pitch${NC}"
      echo -e "${YELLOW}   Recommended: Python 3.10 or 3.11${NC}"
      echo -e "${YELLOW}   Consider using pyenv or conda to install Python 3.11${NC}"
      echo ""
  fi
  echo -e "${BLUE}Checking Python dependencies...${NC}"
  if ! $PYTHON_CMD -c "import basic_pitch" 2>/dev/null; then
      echo -e "${YELLOW}⚠️  Basic Pitch not installed${NC}"
      echo -e "${YELLOW}   Install with: $PYTHON_CMD -m pip install -r audio-midi/requirements.txt${NC}"
      echo -e "${YELLOW}   Transcription will fail until installed.${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Python 3 not found. Transcription endpoints will not work.${NC}"
fi

# Create log directory
mkdir -p logs

# Start Node.js backend
echo -e "${GREEN}Starting Node.js backend (port 1234)...${NC}"
cd backend && ([ -d node_modules ] || npm install) && PYTHON_CMD="$PYTHON_CMD" npm start > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

# Wait a moment for backend to start
sleep 2

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  MÜSE is now running!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC}        http://localhost:1234"
echo -e "${BLUE}MIDI Editor:${NC}     http://localhost:1234/midi-editor.html"
if [ -f frontend/package.json ]; then
  echo -e "${BLUE}Vite Dev (optional):${NC} http://localhost:5173/midi-editor-vite.html"
  echo -e "${YELLOW}Run in another terminal:${NC} (cd frontend && npm install && npm run dev)"
fi
echo -e "${BLUE}Backend API:${NC}     http://localhost:1234"
echo ""
echo -e "${YELLOW}Logs:${NC}"
echo -e "  Backend:       tail -f logs/backend.log"
echo ""
echo -e "${RED}Press Ctrl+C to stop all servers${NC}"
echo ""

# Save PIDs to file
echo $BACKEND_PID > logs/backend.pid

# Wait for Ctrl+C
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID 2>/dev/null; exit" INT TERM

# Keep script running
wait
