# MUSE DAW - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Node.js installed ✅ (you have this)
- Python 3.10 or 3.11 needed ⚠️ (you have 3.13.5)

---

## Option 1: Run DAW Without MP3-to-MIDI (Fastest)

```bash
cd /Users/rishits/MUSE/backend
npm start
```

Then open: **http://localhost:1234/midi-editor.html**

✅ You get the full Loop Arranger DAW immediately!

---

## Option 2: Full Setup with MP3-to-MIDI

### Step 1: Install Python 3.11
```bash
# Using pyenv (recommended)
brew install pyenv
pyenv install 3.11.9
cd /Users/rishits/MUSE
pyenv local 3.11.9

# Verify
python3 --version  # Should show 3.11.9
```

### Step 2: Install Python Dependencies
```bash
cd /Users/rishits/MUSE
pip3 install -r audio-midi/requirements.txt
```

This will take 5-10 minutes. It installs:
- Basic Pitch (Spotify's AI model)
- TensorFlow
- Audio processing libraries

### Step 3: Start Both Servers
```bash
cd /Users/rishits/MUSE
./start-all.sh
```

This starts:
- **Node.js backend** on port 1234
- **Python Flask server** on port 8080

### Step 4: Open the DAW
- **Main Workspace:** http://localhost:1234
- **MIDI Editor:** http://localhost:1234/midi-editor.html
  - Optional (faster dev): `cd frontend && npm install && npm run dev`, then open http://localhost:5173/midi-editor-vite.html
- **Standalone MIDI Editor:** http://localhost:8080

---

## 📁 What You Have Now

```
/Users/rishits/MUSE/
│
├── backend/                   # Node.js + Express + Socket.io
│   ├── server.js             # Main backend server
│   └── package.json
│
├── frontend/                  # React frontend
│   ├── index.html            # Main workspace
│   ├── daw-editor.html       # NEW: DAW interface
│   ├── daw.jsx               # Loop Arranger component
│   └── package.json
│
├── audio-midi/                # MP3-to-MIDI conversion
│   ├── server.py             # Python Flask API
│   ├── transcribe_audio.py   # CLI tool
│   ├── midi-editor.html      # Standalone MIDI editor
│   └── requirements.txt
│
├── start-all.sh              # NEW: Start both servers
├── SETUP-DAW.md              # NEW: Full setup guide
└── INTEGRATION-SUMMARY.md    # NEW: Integration details
```

---

## 🎹 Using the DAW

### Basic Workflow
1. **Create Patterns:**
   - Click "Create Drums/Bass/Synth/Piano"
   - Build your pattern in the sequencer
   - Save the pattern

2. **Arrange on Timeline:**
   - Drag patterns from Library onto Timeline
   - Patterns become clips
   - Move/copy/delete clips

3. **Playback:**
   - Press Play
   - Adjust BPM
   - Use Loop mode

### Keyboard Shortcuts
- `Space`: Play/Stop
- `Ctrl/Cmd + C`: Copy selected clip
- `Ctrl/Cmd + X`: Cut selected clip
- `Ctrl/Cmd + V`: Paste clip
- `Delete/Backspace`: Delete selected clip

---

## 🎵 MP3-to-MIDI Workflow (Once Python is set up)

### Method 1: Standalone MIDI Editor
1. Open http://localhost:8080
2. Click "Upload Audio"
3. Select MP3/WAV file
4. Adjust settings (or use presets)
5. Click "Transcribe"
6. Edit MIDI in piano roll
7. Export MIDI file

### Method 2: Integrate with DAW (To Be Implemented)
Will allow direct import of MP3 → MIDI → DAW patterns

---

## ⚠️ Troubleshooting

### "Port 1234 already in use"
```bash
lsof -ti:1234 | xargs kill -9
```

### "Port 8080 already in use"
```bash
lsof -ti:8080 | xargs kill -9
```

### Python Version Error
```bash
# Check current version
python3 --version

# If 3.13.x, install 3.11
pyenv install 3.11.9
pyenv local 3.11.9
```

### Basic Pitch Not Installing
Make sure you're using Python 3.10 or 3.11, NOT 3.12 or 3.13.

---

##  🎯 Next Steps

### Immediate (No Python Setup)
1. ✅ Run `cd backend && npm start`
2. ✅ Open http://localhost:1234/daw-editor.html
3. ✅ Start creating beats!

### With Python Setup
1. ⬜ Install Python 3.11 (see Step 1 above)
2. ⬜ Install Python dependencies (see Step 2 above)
3. ⬜ Run `./start-all.sh`
4. ⬜ Test MP3 upload at http://localhost:8080
5. ⬜ Integrate MIDI import into DAW

### Future Enhancements
- Add MP3 upload button to DAW interface
- Auto-convert MIDI to DAW patterns
- Save/load projects to DynamoDB
- Add more instrument types
- Export to audio file

---

## 📚 Documentation

- **SETUP-DAW.md** - Complete setup guide
- **INTEGRATION-SUMMARY.md** - Technical integration details
- **audio-midi/README.md** - Basic Pitch documentation
- **AWS_SETUP.md** - AWS Cognito & DynamoDB setup

---

## 🆘 Need Help?

Check the logs:
```bash
# Backend logs
tail -f logs/backend.log

# Python server logs
tail -f logs/python-server.log
```

Stop all servers:
```bash
pkill -f "node.*server.js"
pkill -f "python.*server.py"
```

---

**Happy music making! 🎵**
