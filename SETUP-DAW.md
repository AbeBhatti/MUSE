# MUSE DAW - DAW Setup Guide

## Overview

This Digital Audio Workstation (DAW) integrates:
- **Loop Arranger** with drum, bass, synth, and piano sequencers
- **MP3-to-MIDI Conversion** using Spotify's Basic Pitch AI
- **MIDI Import** to convert MIDI files into DAW patterns
- **Real-time Collaboration** with AWS Cognito & DynamoDB

---

## Prerequisites

### 1. Node.js (v16+)
```bash
node --version  # Should be v16 or higher
```
Install from: https://nodejs.org/

### 2. Python 3.10 or 3.11 (Required for Basic Pitch)
```bash
python3 --version
```

**Important:** Basic Pitch requires Python **3.10 or 3.11** (NOT 3.12 or 3.13)

#### Option A: Using pyenv (Recommended)
```bash
# Install pyenv
brew install pyenv

# Install Python 3.11
pyenv install 3.11.9

# Set local Python version for this project
cd /Users/rishits/MUSE
pyenv local 3.11.9

# Verify
python3 --version  # Should show 3.11.9
```

#### Option B: Using Conda
```bash
# Create environment with Python 3.11
conda create -n muse-daw python=3.11

# Activate environment
conda activate muse-daw

# Install dependencies
pip install -r audio-midi/requirements.txt
```

---

## Installation

### Step 1: Install Node.js Dependencies
```bash
cd /Users/rishits/MUSE

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install @tonejs/midi tone
```

### Step 2: Install Python Dependencies
```bash
cd /Users/rishits/MUSE

# Make sure you're using Python 3.10 or 3.11
python3 --version

# Install Python packages
pip3 install -r audio-midi/requirements.txt
```

**Note:** If you get tensorflow-macos errors, you're using the wrong Python version.

### Step 3: Configure Environment Variables
```bash
cd /Users/rishits/MUSE/backend

# Copy example env file
cp .env.example .env

# Edit .env with your AWS credentials
nano .env
```

Required environment variables:
- `AWS_REGION`
- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `COGNITO_CLIENT_SECRET`
- `DYNAMODB_USERS_TABLE`
- `DYNAMODB_PROJECTS_TABLE`
- `DYNAMODB_COLLABORATORS_TABLE`
- `DYNAMODB_BEATS_TABLE`

---

## Running the Application

### Quick Start (Both Servers)
```bash
cd /Users/rishits/MUSE
./start-all.sh
```

This will start:
- Node.js backend on port **1234**
- Python Flask server on port **8080**

### Manual Start (Individual Servers)

#### Start Node.js Backend Only
```bash
cd /Users/rishits/MUSE/backend
npm start
```

#### Start Python Flask Server Only
```bash
cd /Users/rishits/MUSE/audio-midi
python3 server.py
```

---

## Accessing the DAW

Once both servers are running:

1. **Main Workspace:** http://localhost:1234
2. **MIDI Editor:** http://localhost:1234/midi-editor.html
3. **MIDI Editor (Standalone):** http://localhost:8080

---

## Features

### 1. Loop Arranger
- **4 Sequencers:** Drums, Bass, Synth, Piano
- **Timeline:** Drag-and-drop clips
- **Clip Editing:** Copy, Cut, Paste, Delete
- **Keyboard Shortcuts:**
  - `Ctrl/Cmd + C`: Copy clip
  - `Ctrl/Cmd + X`: Cut clip
  - `Ctrl/Cmd + V`: Paste clip
  - `Delete/Backspace`: Delete clip

### 2. MP3-to-MIDI Conversion
- Upload MP3/WAV files
- AI-powered transcription using Basic Pitch
- Adjustable sensitivity settings
- Instrument presets (Piano, Guitar, Bass, Singing)

### 3. MIDI Import
- Load MIDI files into the DAW
- Convert MIDI notes to sequencer patterns
- Map notes to drum sounds automatically
- Import melody lines to Bass/Synth sequencers

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (Port 1234)               │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ index.html   │  │ daw-editor   │  │  auth      │ │
│  │ (Workspace)  │  │   .html      │  │  pages     │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                     │                                │
│                     │ daw.jsx (React Component)      │
│                     │ - Loop Arranger                │
│                     │ - Sequencers                   │
│                     │ - Timeline                     │
└─────────────────────┴─────────────────────────────────┘
                      │
         ┌────────────┴───────────────┐
         │                            │
         ▼                            ▼
┌─────────────────┐          ┌─────────────────┐
│  Node.js Backend│          │ Python Flask    │
│  (Port 1234)    │          │  (Port 8080)    │
│                 │          │                 │
│ - Express API   │          │ - MP3 Upload    │
│ - Socket.io     │          │ - Basic Pitch   │
│ - AWS Cognito   │          │ - MIDI Output   │
│ - DynamoDB      │          │                 │
└─────────────────┘          └─────────────────┘
```

---

## Troubleshooting

### Python Version Issues
**Error:** `No matching distribution found for tensorflow-macos`

**Solution:** Use Python 3.10 or 3.11
```bash
pyenv install 3.11.9
pyenv local 3.11.9
pip3 install -r audio-midi/requirements.txt
```

### Port Already in Use
**Error:** `EADDRINUSE: address already in use :::1234`

**Solution:** Kill existing processes
```bash
# Find and kill process on port 1234
lsof -ti:1234 | xargs kill -9

# Find and kill process on port 8080
lsof -ti:8080 | xargs kill -9
```

### Basic Pitch Model Download
On first run, Basic Pitch will download its ML model (~30MB). This is normal and only happens once.

### CORS Issues
If you get CORS errors, ensure both servers are running and the Flask server has CORS enabled (already configured in server.py).

---

## Development

### Modifying the DAW
The main DAW code is in `frontend/daw.jsx`. This is a React component that can be edited directly.

### Adding New Sequencers
Edit the `LoopArranger` component in `daw.jsx` to add new instrument types.

### Customizing MP3-to-MIDI
Adjust parameters in the Flask server (`audio-midi/server.py`) or use the preset configurations in the frontend.

---

## Production Deployment

### Backend
1. Set up environment variables in production
2. Use a process manager (PM2) for Node.js
3. Set up HTTPS with Let's Encrypt
4. Configure CORS for your production domain

### Python Server
1. Use Gunicorn or uWSGI for production
2. Set up HTTPS
3. Consider containerizing with Docker

### Frontend
1. Build optimized React bundle
2. Serve static files with Nginx
3. Enable compression and caching

---

## License

See LICENSE file for details.

---

## Support

For issues or questions, please create an issue in the GitHub repository.
