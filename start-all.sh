#!/bin/bash

# MÜSE VYBE - Unified Startup Script

# --- Config ---
LOG_DIR="logs"
BACKEND_LOG="$LOG_DIR/backend.log"
VENV_DIR=".venv"
REQUIREMENTS_FILE="audio-midi/requirements.txt"

# Detect Python 3.11 or fallback to python3
if command -v python3.11 &> /dev/null; then
    SYSTEM_PYTHON="python3.11"
elif command -v /opt/homebrew/bin/python3.11 &> /dev/null; then
    SYSTEM_PYTHON="/opt/homebrew/bin/python3.11"
else
    SYSTEM_PYTHON="python3"
fi

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Cleanup Function ---
cleanup() {
    echo -e "\n${RED}🛑 Stopping all servers...${NC}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID
    fi
    # Kill any remaining processes on the port
    lsof -ti:1234 | xargs kill -9 2>/dev/null
    echo -e "${GREEN}✓ Servers stopped.${NC}"
    exit 0
}

# Trap Ctrl+C and call cleanup
trap cleanup SIGINT

# --- Main Script ---
echo -e "${BLUE}🎵 Starting MÜSE VYBE...${NC}\n"

# Create log directory
mkdir -p "$LOG_DIR"

# Step 1: Setup Python Virtual Environment
echo "Setting up Python environment..."

# Check if .venv exists, if not create it
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Creating virtual environment...${NC}"
    $SYSTEM_PYTHON -m venv $VENV_DIR
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ Failed to create virtual environment${NC}"
        echo "  Please ensure Python 3 is installed with venv module"
        exit 1
    fi
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# Activate virtual environment
if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
    echo -e "${GREEN}✓ Virtual environment activated${NC}"
else
    echo -e "${RED}✗ Failed to activate virtual environment${NC}"
    exit 1
fi

# Show Python version being used
echo -e "${BLUE}Python version: $(python --version)${NC}"

# Step 2: Install/Update Python Dependencies
echo "Checking Python dependencies..."

# Check if basic packages are installed
if ! python -c "import basic_pitch, librosa, demucs" &> /dev/null; then
    echo -e "${YELLOW}Installing required Python packages...${NC}"
    echo "This may take a few minutes on first run..."
    
    # Update pip first
    pip install --upgrade pip &> /dev/null
    
    # Install all requirements
    pip install basic-pitch librosa demucs torch numpy scipy soundfile mido
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Python dependencies installed successfully${NC}"
    else
        echo -e "${RED}✗ Installation failed. Trying with requirements.txt...${NC}"
        if [ -f "$REQUIREMENTS_FILE" ]; then
            pip install -r $REQUIREMENTS_FILE
            if [ $? -ne 0 ]; then
                echo -e "${RED}✗ Failed to install dependencies${NC}"
                echo "  Please try: pip install basic-pitch librosa demucs torch"
                exit 1
            fi
        fi
    fi
else
    echo -e "${GREEN}✓ Python audio dependencies are already installed${NC}"
fi

# Step 3: Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    echo "  Please install Node.js from https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓ Node.js found: $(node --version)${NC}"

# Step 4: Install Node.js Dependencies and Start Backend
echo "Installing Node.js dependencies..."
cd backend
npm install

echo "Starting Node.js backend (port 1234)..."
npm start > "../$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}✗ Backend failed to start. Check logs:${NC}"
    echo "  cat $BACKEND_LOG"
    exit 1
fi
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

# --- Final Output ---
sleep 1

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  MÜSE VYBE is now running!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC}        http://localhost:1234"
echo -e "${BLUE}MIDI Editor:${NC}     http://localhost:1234/midi-editor.html"
echo -e "${BLUE}Backend API:${NC}     http://localhost:1234"
echo ""
echo -e "${YELLOW}Logs:${NC}"
echo -e "  Backend:       tail -f logs/backend.log"
echo ""
echo -e "${RED}Press Ctrl+C to stop all servers${NC}"
echo ""

# Wait for the backend process to finish. The script will now hang here
# until Ctrl+C is pressed, which is handled by the 'trap' command.
wait $BACKEND_PID