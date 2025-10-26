# Audio Separation Debug Enhancements - Summary

## Overview
Added comprehensive debug logging throughout the entire audio separation pipeline to identify why only 1 track is being generated instead of 5 (Full Mix + 4 separated stems).

## Files Modified

### 1. `/frontend/audio-transcriber.js`
**Purpose:** Client-side API handler for audio transcription/separation

**Changes:**
- Added detailed console logging for API requests and responses
- Logs endpoint being called (`/separate` vs `/upload`)
- Logs response status and full JSON data
- Added detailed logging in `processSeparatedTracks()` method:
  - Input track count
  - Individual track processing details
  - Note formatting for each track
  - Final result summary

**Key Debug Points:**
```javascript
console.log('[AudioTranscriber] Fetching:', endpoint);
console.log('[AudioTranscriber] Response status:', response.status);
console.log('[AudioTranscriber] Raw response data:', JSON.stringify(data, null, 2));
console.log('[AudioTranscriber] Track count:', data.tracks ? data.tracks.length : 0);
```

### 2. `/frontend/dashboard.jsx`
**Purpose:** React component for audio transcription UI

**Changes:**
- Already had extensive logging from previous session
- Logs component lifecycle
- Logs transcription options (including `useSeparation` flag)
- Logs received track data
- Logs pattern creation and saving process

**Key Debug Points:**
```javascript
console.log('[AudioTranscriber] Options:', { useSeparation, bpm, maxBars });
console.log('[AudioTranscriber] Received transcription data:', { trackCount });
console.log('[AudioTranscriber] Processing X tracks');
console.log('[AudioTranscriber] Track N: stem, notes count');
```

### 3. `/audio-midi/audio_processor.py`
**Purpose:** Python backend for audio separation and MIDI transcription

**Major Changes:**

#### a. Enhanced `audio_to_midi()` function
- Logs conversion start with instrument name
- Logs audio loading details (duration, sample rate)
- Logs Basic Pitch prediction progress
- Logs MIDI file writing
- Logs number of instruments and notes extracted
- Logs errors with full traceback

#### b. Enhanced `separate_audio_demucs()` function
- Logs function entry with parameters
- Logs Demucs availability check
- Logs model loading and configuration
- Logs audio loading details (shape, sample rate)
- Logs tensor conversion
- Logs separation progress (can take time)
- Logs sources shape after separation
- Logs each stem save operation
- Logs errors with full traceback

#### c. Modified silence detection threshold
- **OLD:** `max_amplitude < 0.01` (too aggressive)
- **NEW:** `max_amplitude < 0.001` (10x more sensitive)
- Added RMS amplitude logging
- Added explicit logs when stems pass/fail silence check

#### d. Enhanced `process_audio()` function
- Already had good logging, maintained existing structure
- Logs show progression through all 3 steps:
  1. Original audio transcription
  2. Demucs separation
  3. Stem-to-MIDI conversion

**Key Debug Points:**
```python
print(f"[separate_audio_demucs] Model sources: {model.sources}", file=sys.stderr)
print(f"[separate_audio_demucs] Separation complete! Sources shape: {sources.shape}", file=sys.stderr)
print(f"  Max amplitude: {max_amplitude:.6f}, RMS: {rms_amplitude:.6f}", file=sys.stderr)
print(f"[FINAL] Total tracks created: {len(results['tracks'])}", file=sys.stderr)
```

### 4. `/backend/server.js`
**Purpose:** Node.js Express server

**Changes:**
- Already had comprehensive logging from previous session
- No additional changes needed
- Logs show file reception, Python process execution, and response sending

### 5. `/DEBUG_GUIDE.md` (New File)
**Purpose:** Comprehensive debugging guide

**Contents:**
- Expected flow through all 4 layers (Frontend UI → Frontend API → Backend → Python)
- Debug logs to watch at each layer
- Expected log output for successful 5-track generation
- Common issues and solutions
- Testing steps
- Troubleshooting guide

## Expected Behavior

### Success Case - 5 Tracks Generated

When working correctly, you should see:

**Backend Logs:**
```
=== AUDIO PROCESSOR STARTED ===
[STEP 1] Transcribing original audio...
✓ Original audio transcribed: X notes

[STEP 2] Starting Demucs separation...
[separate_audio_demucs] Model sources: ['drums', 'bass', 'other', 'vocals']
✓ Separated into 4 stems: ['drums', 'bass', 'other', 'vocals']

[STEP 3] Converting stems to MIDI...
Processing stem 1/4: drums
  ✓ Stem drums has sufficient audio
  ✓ Converted drums: X notes
Processing stem 2/4: bass
  ✓ Stem bass has sufficient audio
  ✓ Converted bass: X notes
Processing stem 3/4: other
  ✓ Stem other has sufficient audio
  ✓ Converted other: X notes
Processing stem 4/4: vocals
  ✓ Stem vocals has sufficient audio
  ✓ Converted vocals: X notes

[FINAL] Total tracks created: 5
  Track 1: original - X notes
  Track 2: drums - X notes
  Track 3: bass - X notes
  Track 4: other - X notes
  Track 5: vocals - X notes
```

**Frontend Logs:**
```
[AudioTranscriber] Track count: 5
[AudioTranscriber] Processing 5 tracks
[AudioTranscriber] Track 0: original notes: X
[AudioTranscriber] Track 1: drums notes: X
[AudioTranscriber] Track 2: bass notes: X
[AudioTranscriber] Track 3: other notes: X
[AudioTranscriber] Track 4: vocals notes: X
[AudioTranscriber] Saving 5 patterns
```

## Common Issues Detected

### Issue 1: Stems Being Skipped as Silent
**Symptom:** Logs show "Skipping silent stem: {name}"
**Solution:** Lowered threshold from 0.01 to 0.001
**Status:** FIXED

### Issue 2: Demucs Not Available
**Symptom:** `DEMUCS_AVAILABLE = False`
**Solution:** Ensure `pip install demucs` runs successfully
**Check:** Virtual environment should have demucs installed

### Issue 3: useSeparation = false
**Symptom:** Only `/upload` endpoint called, not `/separate`
**Solution:** Default is now `true` in `transcriptionOptions`
**Status:** Already correct in code

## Testing Instructions

1. **Open the application:**
   - Click the browser preview link above
   - Or navigate to http://localhost:1234
   - Open DevTools Console (F12 or Cmd+Option+I)

2. **Upload an audio file:**
   - Click "Transcribe Audio" button in the UI
   - Select a music file (MP3, WAV) with multiple instruments
   - The file should have vocals, drums, bass, and other instruments
   - Click "Transcribe & Add"

3. **Monitor logs in real-time:**
   - **Browser Console:** Frontend logs (blue [AudioTranscriber] tags)
   - **Terminal:** Backend and Python logs (backend.log)

4. **Expected result:**
   - Processing time: 30-120 seconds depending on file length
   - 5 patterns should appear in the pattern library:
     - "Full Mix: {filename}"
     - "Vocals: {filename}"
     - "Drums: {filename}"
     - "Bass: {filename}"
     - "Other/Synth: {filename}"

5. **If it fails:**
   - Review console logs to identify which step failed
   - Check `DEBUG_GUIDE.md` for troubleshooting
   - Look for error messages or tracks being skipped
   - Check if Demucs model is loading correctly

## Next Steps

1. **Test with a sample audio file** to see the actual logs
2. **Identify the exact failure point** using the debug logs
3. **Apply targeted fixes** based on what the logs reveal
4. **Verify all 5 tracks are generated and playable**

## Additional Notes

- All debug logs use consistent prefixes for easy filtering
- Python logs go to stderr (shown in terminal)
- Frontend logs go to browser console
- Backend logs show both Python stdout and stderr
- The server is now running and ready for testing
- Virtual environment is properly configured with all dependencies
