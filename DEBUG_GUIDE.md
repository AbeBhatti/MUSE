# Audio Separation Debugging Guide

## Overview
This guide helps you debug the audio separation feature that should generate 5 tracks:
1. **Full Mix** (original audio transcribed)
2. **Vocals** (separated vocals stem)
3. **Drums** (separated drums stem)
4. **Bass** (separated bass stem)
5. **Other/Synth** (separated other instruments stem)

## Expected Flow

### 1. Frontend (React Component)
**File:** `/frontend/dashboard.jsx` - `AudioTranscriber` component

**Debug Logs to Watch:**
- `[AudioTranscriber] Component mounting/rendering`
- `[AudioTranscriber] handleSubmit called`
- `[AudioTranscriber] Options:` - Check that `useSeparation: true`
- `[AudioTranscriber] Received transcription data:` - Should show track count
- `[AudioTranscriber] Processing X tracks`
- `[AudioTranscriber] Track N: {stem} notes: {count}`
- `[AudioTranscriber] Saving X patterns`

### 2. Frontend API Client
**File:** `/frontend/audio-transcriber.js`

**Debug Logs to Watch:**
- `[AudioTranscriber] Fetching: http://localhost:1234/separate`
- `[AudioTranscriber] Response status: 200`
- `[AudioTranscriber] Raw response data:` - Full JSON response
- `[AudioTranscriber] Track count:` - Should be 5
- `[AudioTranscriber.processSeparatedTracks] Starting processing...`
- `[AudioTranscriber.processSeparatedTracks] Track N:` - Details for each track

### 3. Backend Server
**File:** `/backend/server.js` - `/separate` endpoint

**Debug Logs to Watch:**
- `=== SEPARATE ENDPOINT CALLED ===`
- `File received:` - Uploaded file info
- `Using Python:` - Should use `.venv/bin/python` or `python3`
- `Python process started, PID:` - Process ID
- `[Python STDOUT]:` and `[Python STDERR]:` - All Python output
- `=== PARSED PAYLOAD ===`
- `Number of tracks:` - Should be 5
- `Track 0:`, `Track 1:`, etc. - Details for each track

### 4. Python Audio Processor
**File:** `/audio-midi/audio_processor.py`

**Debug Logs to Watch:**
```
=== AUDIO PROCESSOR STARTED ===
[STEP 1] Transcribing original audio...
[audio_to_midi] Converting original: {path}
[audio_to_midi] ✓ Extracted X notes for original

[STEP 2] Starting Demucs separation...
[separate_audio_demucs] Called with input: {path}
[separate_audio_demucs] Model loaded. Sample rate: 44100
[separate_audio_demucs] Model sources: ['drums', 'bass', 'other', 'vocals']
[separate_audio_demucs] Applying Demucs model (this may take a while)...
[separate_audio_demucs] Separation complete! Sources shape: (1, 4, 2, N)
[separate_audio_demucs] Saving 4 stems: ['drums', 'bass', 'other', 'vocals']
[separate_audio_demucs] ✓ Saved drums
[separate_audio_demucs] ✓ Saved bass
[separate_audio_demucs] ✓ Saved other
[separate_audio_demucs] ✓ Saved vocals

[STEP 3] Converting stems to MIDI...
Processing stem 1/4: drums
  ✓ Stem drums has sufficient audio (max amp X.XXXXXX)
  Converting drums to MIDI...
  [audio_to_midi] ✓ Extracted X notes for drums
  ✓ Converted drums: X notes

[... repeat for bass, other, vocals ...]

[FINAL] Total tracks created: 5
  Track 1: original - X notes
  Track 2: drums - X notes
  Track 3: bass - X notes
  Track 4: other - X notes
  Track 5: vocals - X notes
Overall success: True
```

## Common Issues and Solutions

### Issue 1: Only 1 Track Generated

**Symptoms:**
- Only "Full Mix" track appears
- No separated stems

**Possible Causes:**
1. **Demucs not installed or not available**
   - Check logs for: `Demucs available: False`
   - Solution: Run `pip install demucs` in virtual environment

2. **Stems being skipped as silent**
   - Check logs for: `Skipping silent stem: {name}`
   - The threshold is now 0.001 (was 0.01)
   - If stems are still being skipped, the audio might be too quiet

3. **Separation failing**
   - Check for: `Demucs separation failed:` error
   - Look for Python traceback in stderr

4. **useSeparation is false**
   - Check frontend logs for: `Options: { useSeparation: false }`
   - The default should be `true` in `transcriptionOptions`

### Issue 2: Backend Errors

**Symptoms:**
- HTTP 500 error
- "Transcription failed" message

**Debug Steps:**
1. Check Python path: Should use `.venv/bin/python`
2. Check Python dependencies are installed
3. Review full Python stderr output for exceptions
4. Check file upload succeeded: File size > 0

### Issue 3: Frontend Not Receiving All Tracks

**Symptoms:**
- Backend logs show 5 tracks
- Frontend only receives 1 track

**Debug Steps:**
1. Check backend JSON output: `=== SENDING RESPONSE ===`
2. Check frontend receives full response: `[AudioTranscriber] Raw response data:`
3. Check `processSeparatedTracks` is being called
4. Check all tracks have notes

## Testing Steps

1. **Start the server:**
   ```bash
   cd /Users/tahmidjamal/Desktop/muse/VYBE
   ./start-all.sh
   ```

2. **Open browser:**
   - Navigate to http://localhost:1234
   - Open DevTools Console (F12)

3. **Upload audio file:**
   - Click "Transcribe Audio" button
   - Select an audio file (MP3, WAV)
   - Verify "Use Separation" is enabled (should be default)
   - Click "Transcribe & Add"

4. **Watch console logs:**
   - Browser console: Frontend logs
   - Terminal: Backend and Python logs

5. **Expected result:**
   - 5 patterns added to the library
   - Each pattern labeled: "Full Mix:", "Vocals:", "Drums:", "Bass:", "Other/Synth:"

## Key Files Modified

1. `/frontend/audio-transcriber.js` - Enhanced debug logging
2. `/frontend/dashboard.jsx` - Enhanced debug logging
3. `/audio-midi/audio_processor.py` - Enhanced debug logging, lowered silence threshold
4. `/backend/server.js` - Enhanced debug logging (already had good logging)

## Next Steps

After reviewing logs:
1. Identify which step is failing
2. Check specific error messages
3. Verify all dependencies are installed
4. Ensure audio file is valid and has sufficient content
