# MIDI Editor - Audio to MIDI Transcription & Editing

A web-based MIDI editor that transcribes audio files (MP3, WAV, etc.) to MIDI using Basic Pitch, then lets you view and edit the results.

## Features

✅ **Audio Upload & Transcription**
- Upload MP3, WAV, FLAC, OGG, or M4A files
- Automatic transcription to MIDI using Basic Pitch
- Adjustable transcription settings with presets

✅ **Visual Piano Roll Editor**
- See all notes on a timeline
- Piano keys reference on the left
- Grid lines for easy editing

✅ **Playback**
- Play/pause MIDI with audio synthesis
- Seek to any position in the timeline
- Click individual notes to preview them

✅ **Editing**
- Drag notes to change pitch (up/down)
- Drag notes to change timing (left/right)
- Select multiple notes (Shift+click)
- Delete unwanted notes

✅ **Save & Export**
- Export edited MIDI files
- Download as standard .mid format

## Quick Start

### 1. Start the Server

```bash
./start-editor.sh
```

Or manually:
```bash
pip install flask flask-cors
python server.py
```

### 2. Open in Browser

Navigate to: **http://localhost:5000**

### 3. Upload Audio

1. Click **"Upload Audio"**
2. Select an audio file (MP3, WAV, etc.)
3. Choose a preset or adjust settings:
   - **Singing**: Optimized for vocals
   - **Piano**: For piano recordings
   - **Guitar**: For guitar
   - **Bass**: For bass instruments
   - **Default**: Balanced settings
4. Click **"Transcribe"**
5. Wait for processing (1-2 minutes)

### 4. Edit MIDI

Once transcribed:
- **Move notes**: Click and drag
- **Change pitch**: Drag up/down
- **Change timing**: Drag left/right
- **Select notes**: Click (Shift+click for multiple)
- **Delete notes**: Select and click "Delete Selected"
- **Play**: Click the play button
- **Save**: Click "Save MIDI" to download

## Transcription Settings

### Presets

**Singing** (Recommended for vocals)
- Onset threshold: 0.4
- Frame threshold: 0.25
- Min note length: 0.1s
- Frequency range: 80-1100 Hz

**Piano**
- Onset threshold: 0.5
- Frame threshold: 0.3
- Min note length: 0.08s
- Frequency range: 27-4200 Hz

**Guitar**
- Onset threshold: 0.4
- Frame threshold: 0.25
- Min note length: 0.05s
- Frequency range: 80-1200 Hz

**Bass**
- Onset threshold: 0.5
- Frame threshold: 0.3
- Min note length: 0.1s
- Frequency range: 40-400 Hz

### Custom Settings

**Onset Threshold** (0.1-0.9)
- Lower = more notes detected
- Higher = fewer, more confident notes
- Default: 0.5

**Frame Threshold** (0.1-0.6)
- Lower = more sensitive
- Higher = less noise
- Default: 0.3

**Min Note Length** (0.05-0.5 seconds)
- Filters out very short notes
- Lower = catch faster notes
- Default: 0.127s

**Frequency Range** (Hz)
- Limit detection to specific frequency ranges
- Useful for isolating instruments
- Leave blank for no limit

## Keyboard Shortcuts

- **Space**: Play/Pause
- **Click**: Select note
- **Shift+Click**: Add to selection
- **Drag**: Move notes
- **Delete**: Delete selected notes

## Tips

1. **Missing notes?** Lower the onset threshold to 0.3-0.4
2. **Too many wrong notes?** Raise the onset threshold to 0.6-0.7
3. **Noisy output?** Raise frame threshold or min note length
4. **Fast notes cut off?** Lower min note length to 0.05-0.08
5. **Best results**: Use high-quality audio with one instrument
6. **Vocals**: Use the "Singing" preset for best results

## File Structure

```
audio-midi/
├── midi-editor.html       # Frontend interface
├── midi-editor.js         # Editor logic
├── server.py              # Flask backend
├── start-editor.sh        # Startup script
├── temp_uploads/          # Temporary audio files
└── temp_output/           # Generated MIDI files
```

## Troubleshooting

**Server won't start**
- Make sure you're in the correct conda environment
- Install dependencies: `pip install flask flask-cors basic-pitch`

**Transcription fails**
- Check that your audio file is valid
- Try with a shorter audio clip first
- Ensure Basic Pitch is installed correctly

**Browser can't connect**
- Make sure server is running (should say "Running on http://127.0.0.1:5000")
- Try http://127.0.0.1:5000 instead of localhost
- Check firewall settings

**MIDI playback doesn't work**
- Click anywhere on the page first (browser audio policy)
- Check browser console for errors
- Try refreshing the page

## Technologies Used

- **Frontend**: HTML, CSS, JavaScript
- **MIDI Library**: @tonejs/midi
- **Audio Playback**: Tone.js
- **Backend**: Flask (Python)
- **Transcription**: Basic Pitch (Spotify)

## License

MIT License - Feel free to use and modify!
