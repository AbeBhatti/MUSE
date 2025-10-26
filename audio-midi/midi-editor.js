// Global state
let midiData = null;
let notes = [];
let isPlaying = false;
let currentTime = 0;
let duration = 0;
let playInterval = null;
let synth = null;
let activeNotes = new Set();
let selectedNotes = new Set();
let currentAudioFile = null;
let maxConcurrentNotes = 32; // Limit concurrent notes for better playback

// API configuration
const API_URL = 'http://localhost:8080';

// Constants
const NOTE_HEIGHT = 20;
let PIXELS_PER_SECOND = 100; // Now variable for zoom
const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Zoom functionality
function changeZoom(delta) {
    PIXELS_PER_SECOND = Math.max(25, Math.min(400, PIXELS_PER_SECOND + delta));
    const zoomPercent = Math.round((PIXELS_PER_SECOND / 100) * 100);
    document.getElementById('zoomLevel').textContent = zoomPercent + '%';

    if (notes.length > 0) {
        renderPianoRoll();
    }
    console.log('Zoom changed to', PIXELS_PER_SECOND, 'px/s');
}

// Initialize Tone.js synth
async function initSynth() {
    if (!synth) {
        await Tone.start();
        // Increase max polyphony to handle dense MIDI files
        synth = new Tone.PolySynth(Tone.Synth, {
            maxPolyphony: 128, // Increase from default 32
            oscillator: { type: 'triangle' },
            envelope: {
                attack: 0.005,
                decay: 0.1,
                sustain: 0.3,
                release: 0.5
            }
        }).toDestination();
        synth.volume.value = -10;
        console.log('Synth initialized with maxPolyphony: 128');
    }
}

// Audio file input handler
document.getElementById('audioInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentAudioFile = file;
    showModal('transcriptionModal');
});

// MIDI file input handler
document.getElementById('midiInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    loadMIDI(arrayBuffer, file.name);
});

// Preset configurations
const presets = {
    default: { onset: 0.5, frame: 0.3, minNote: 0.127, minFreq: '', maxFreq: '' },
    singing: { onset: 0.4, frame: 0.25, minNote: 0.1, minFreq: '80', maxFreq: '1100' },
    piano: { onset: 0.5, frame: 0.3, minNote: 0.08, minFreq: '27', maxFreq: '4200' },
    guitar: { onset: 0.4, frame: 0.25, minNote: 0.05, minFreq: '80', maxFreq: '1200' },
    bass: { onset: 0.5, frame: 0.3, minNote: 0.1, minFreq: '40', maxFreq: '400' }
};

// Apply preset
function applyPreset(presetName) {
    const preset = presets[presetName];
    if (!preset) return;

    document.getElementById('onsetThreshold').value = preset.onset;
    document.getElementById('frameThreshold').value = preset.frame;
    document.getElementById('minNoteLen').value = preset.minNote;
    document.getElementById('minFreq').value = preset.minFreq;
    document.getElementById('maxFreq').value = preset.maxFreq;

    updateRangeValue('onset', preset.onset);
    updateRangeValue('frame', preset.frame);
    updateRangeValue('minNote', preset.minNote);

    // Highlight active preset
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

// Update range display
function updateRangeValue(type, value) {
    const displayId = type === 'onset' ? 'onsetValue' :
                     type === 'frame' ? 'frameValue' : 'minNoteValue';
    document.getElementById(displayId).textContent = parseFloat(value).toFixed(3);
}

// Show modal
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

// Close modal
function closeModal() {
    document.getElementById('transcriptionModal').classList.remove('active');
    document.getElementById('loadingModal').classList.remove('active');
}

// Start transcription
async function startTranscription() {
    if (!currentAudioFile) return;

    closeModal();
    showModal('loadingModal');

    try {
        console.log('Starting transcription for:', currentAudioFile.name);

        const formData = new FormData();
        formData.append('file', currentAudioFile);
        formData.append('onset_threshold', document.getElementById('onsetThreshold').value);
        formData.append('frame_threshold', document.getElementById('frameThreshold').value);
        formData.append('min_note_len', document.getElementById('minNoteLen').value);
        formData.append('min_freq', document.getElementById('minFreq').value || '');
        formData.append('max_freq', document.getElementById('maxFreq').value || '');
        formData.append('melodia_trick', 'true');

        console.log('Uploading to:', `${API_URL}/upload`);

        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
        });

        console.log('Upload response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error:', errorText);
            throw new Error(`Transcription failed: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        console.log('Transcription result:', result);

        // Load the transcribed MIDI file
        console.log('Fetching MIDI file:', result.filename);
        const midiResponse = await fetch(`${API_URL}/midi/${result.filename}`);

        if (!midiResponse.ok) {
            throw new Error(`Failed to fetch MIDI file: ${midiResponse.status}`);
        }

        const midiBuffer = await midiResponse.arrayBuffer();
        console.log('MIDI file downloaded, size:', midiBuffer.byteLength);

        closeModal();
        loadMIDI(midiBuffer, result.filename);

    } catch (error) {
        closeModal();
        alert('Error during transcription: ' + error.message);
        console.error('Transcription error:', error);
    }
}

// Load MIDI file
async function loadMIDI(arrayBuffer, filename) {
    try {
        console.log('Loading MIDI file:', filename);
        console.log('ArrayBuffer size:', arrayBuffer.byteLength);

        midiData = new Midi(arrayBuffer);
        notes = [];

        console.log('MIDI parsed. Tracks:', midiData.tracks.length);

        // Extract all notes from all tracks
        midiData.tracks.forEach((track, trackIndex) => {
            console.log(`Track ${trackIndex}: ${track.notes.length} notes`);
            track.notes.forEach(note => {
                // Ensure duration is positive and reasonable
                const duration = Math.max(note.duration || 0.1, 0.1);
                const time = Math.max(note.time || 0, 0);
                
                notes.push({
                    midi: note.midi,
                    time: time,
                    duration: duration,
                    velocity: note.velocity,
                    name: note.name,
                    trackIndex: trackIndex,
                    id: `${trackIndex}-${time}-${note.midi}`
                });
            });
        });

        console.log('Total notes extracted:', notes.length);

        duration = midiData.duration || 10; // Default to 10 seconds if duration is 0
        currentTime = 0;

        // Calculate max duration from notes if midiData.duration is 0
        if (notes.length > 0 && duration === 0) {
            duration = Math.max(...notes.map(n => n.time + n.duration));
            console.log('Calculated duration from notes:', duration);
        }

        // Update UI
        document.getElementById('fileInfo').textContent = `${filename} - ${notes.length} notes`;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('saveBtn').disabled = false;

        await initSynth();
        renderPianoRoll();
        renderPianoKeys();
        updateTimeDisplay();

        console.log('MIDI loaded successfully');

    } catch (error) {
        console.error('Error loading MIDI:', error);
        alert('Error loading MIDI file: ' + error.message);
    }
}

// Render piano keys
function renderPianoKeys() {
    const pianoKeys = document.getElementById('pianoKeys');
    pianoKeys.innerHTML = '';

    // MIDI notes 0-127, show reversed (high to low)
    for (let i = 127; i >= 0; i--) {
        const key = document.createElement('div');
        const noteName = MIDI_NOTE_NAMES[i % 12];
        const octave = Math.floor(i / 12) - 1;

        key.className = `piano-key ${noteName.includes('#') ? 'black' : 'white'}`;
        key.textContent = `${noteName}${octave}`;
        key.style.height = NOTE_HEIGHT + 'px';

        pianoKeys.appendChild(key);
    }
}

// Render piano roll
function renderPianoRoll() {
    console.log('Rendering piano roll with', notes.length, 'notes');
    const pianoRoll = document.getElementById('pianoRoll');
    pianoRoll.innerHTML = '';

    const canvas = document.createElement('div');
    canvas.className = 'piano-roll-canvas';
    const width = Math.max(duration * PIXELS_PER_SECOND, 1000); // Minimum width
    canvas.style.width = width + 'px';
    canvas.style.height = (128 * NOTE_HEIGHT) + 'px';
    canvas.style.position = 'relative';

    console.log('Canvas size:', width, 'x', (128 * NOTE_HEIGHT));

    // Draw grid lines
    // Horizontal lines (for each note)
    for (let i = 0; i < 128; i++) {
        const line = document.createElement('div');
        line.className = 'grid-line horizontal';
        line.style.top = (i * NOTE_HEIGHT) + 'px';
        line.style.background = MIDI_NOTE_NAMES[i % 12].includes('#') ? '#0a0a0a' : '#151515';
        canvas.appendChild(line);
    }

    // Vertical lines (for each second)
    for (let i = 0; i <= duration; i++) {
        const line = document.createElement('div');
        line.className = 'grid-line vertical';
        line.style.left = (i * PIXELS_PER_SECOND) + 'px';
        canvas.appendChild(line);
    }

    // Draw notes
    console.log('Drawing', notes.length, 'note elements');
    notes.forEach((note, index) => {
        const noteEl = createNoteElement(note);
        canvas.appendChild(noteEl);
        if (index < 5) {
            console.log(`Note ${index}:`, note.name, 'at', note.time, 'duration', note.duration);
        }
    });

    // Add playhead
    const playhead = document.createElement('div');
    playhead.className = 'playhead';
    playhead.id = 'playhead';
    canvas.appendChild(playhead);

    pianoRoll.appendChild(canvas);

    // Add click handler for deselection
    canvas.addEventListener('click', (e) => {
        if (e.target === canvas || e.target.classList.contains('grid-line')) {
            clearSelection();
        }
    });

    console.log('Piano roll rendered');
}

// Create note element
function createNoteElement(note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'note';
    noteEl.dataset.noteId = note.id;

    const x = note.time * PIXELS_PER_SECOND;
    const y = (127 - note.midi) * NOTE_HEIGHT;
    const width = Math.max(note.duration * PIXELS_PER_SECOND, 5);

    noteEl.style.left = x + 'px';
    noteEl.style.top = y + 'px';
    noteEl.style.width = width + 'px';
    noteEl.style.height = NOTE_HEIGHT + 'px';
    noteEl.style.opacity = note.velocity;

    // Add drag functionality
    let isDragging = false;
    let startX, startY, startNoteX, startNoteY;

    noteEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();

        // Select note
        if (!e.shiftKey) {
            clearSelection();
        }
        selectNote(note.id);

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startNoteX = note.time;
        startNoteY = note.midi;

        noteEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = (e.clientX - startX) / PIXELS_PER_SECOND;
        const deltaY = Math.round((startY - e.clientY) / NOTE_HEIGHT);

        note.time = Math.max(0, startNoteX + deltaX);
        note.midi = Math.max(0, Math.min(127, startNoteY + deltaY));

        const newX = note.time * PIXELS_PER_SECOND;
        const newY = (127 - note.midi) * NOTE_HEIGHT;

        noteEl.style.left = newX + 'px';
        noteEl.style.top = newY + 'px';

        updateSelectionInfo();
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            noteEl.style.cursor = 'move';
        }
    });

    // Play note on click
    noteEl.addEventListener('click', (e) => {
        e.stopPropagation();
        playNote(note);
    });

    return noteEl;
}

// Play a single note
function playNote(note) {
    const noteName = Tone.Frequency(note.midi, 'midi').toNote();
    synth.triggerAttackRelease(noteName, note.duration);
}

// Select note
function selectNote(noteId) {
    selectedNotes.add(noteId);
    const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
    if (noteEl) {
        noteEl.classList.add('selected');
    }
    document.getElementById('deleteBtn').disabled = false;
    updateSelectionInfo();
}

// Clear selection
function clearSelection() {
    selectedNotes.forEach(noteId => {
        const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
        if (noteEl) {
            noteEl.classList.remove('selected');
        }
    });
    selectedNotes.clear();
    document.getElementById('deleteBtn').disabled = true;
    updateSelectionInfo();
}

// Update selection info
function updateSelectionInfo() {
    const count = selectedNotes.size;
    if (count === 0) {
        document.getElementById('selectionInfo').textContent = 'Click and drag notes to edit';
    } else if (count === 1) {
        const noteId = Array.from(selectedNotes)[0];
        const note = notes.find(n => n.id === noteId);
        if (note) {
            document.getElementById('selectionInfo').textContent =
                `${note.name} - ${note.time.toFixed(2)}s - ${note.duration.toFixed(2)}s`;
        }
    } else {
        document.getElementById('selectionInfo').textContent = `${count} notes selected`;
    }
}

// Delete selected notes
function deleteSelected() {
    if (selectedNotes.size === 0) return;

    if (!confirm(`Delete ${selectedNotes.size} note(s)?`)) return;

    notes = notes.filter(note => !selectedNotes.has(note.id));
    selectedNotes.clear();
    renderPianoRoll();
    document.getElementById('deleteBtn').disabled = true;
    updateSelectionInfo();
}

// Toggle play/pause
async function togglePlay() {
    if (isPlaying) {
        pause();
    } else {
        await play();
    }
}

// Play MIDI
async function play() {
    if (!midiData || !synth) {
        console.error('Cannot play: midiData or synth not initialized');
        return;
    }

    console.log('Starting playback from', currentTime);
    isPlaying = true;
    const playBtn = document.getElementById('playBtn');
    playBtn.classList.add('playing');
    playBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

    const startTime = Tone.now();
    const startOffset = currentTime;

    // Get notes to play and sort by time
    let notesToPlay = notes
        .filter(note => note.time >= currentTime)
        .sort((a, b) => a.time - b.time);

    console.log(`Total notes to play: ${notesToPlay.length}`);

    // Smart note scheduling with polyphony limiting
    let lastScheduleIndex = 0;
    const scheduleWindow = 2; // Schedule 2 seconds ahead

    function scheduleNotes() {
        if (!isPlaying) return;

        const now = Tone.now();
        const lookAheadTime = (currentTime || 0) + scheduleWindow;

        // Find notes in the next window that haven't been scheduled
        const notesInWindow = notesToPlay.slice(lastScheduleIndex).filter(note =>
            note.time >= currentTime && note.time <= lookAheadTime
        );

        // Limit concurrent notes by selecting highest velocity notes at each time slice
        const notesByTime = {};
        notesInWindow.forEach(note => {
            const timeKey = Math.floor(note.time * 10); // 100ms buckets
            if (!notesByTime[timeKey]) notesByTime[timeKey] = [];
            notesByTime[timeKey].push(note);
        });

        // For each time bucket, keep only top N notes by velocity
        const selectedNotes = [];
        Object.values(notesByTime).forEach(bucket => {
            const sorted = bucket.sort((a, b) => b.velocity - a.velocity);
            selectedNotes.push(...sorted.slice(0, maxConcurrentNotes));
        });

        // Schedule the selected notes
        selectedNotes.forEach(note => {
            const noteName = Tone.Frequency(note.midi, 'midi').toNote();
            const scheduleTime = startTime + (note.time - startOffset);
            const safeDuration = Math.max(note.duration, 0.1);

            if (scheduleTime >= now) {
                synth.triggerAttackRelease(noteName, safeDuration, scheduleTime, note.velocity);
            }
        });

        lastScheduleIndex = Math.min(
            notesToPlay.findIndex(n => n.time > lookAheadTime),
            notesToPlay.length
        );

        console.log(`Scheduled ${selectedNotes.length} notes (${lastScheduleIndex}/${notesToPlay.length})`);
    }

    // Initial scheduling
    scheduleNotes();

    // Update playhead and schedule more notes
    playInterval = setInterval(() => {
        currentTime = startOffset + (Tone.now() - startTime);

        if (currentTime >= duration) {
            console.log('Playback finished');
            pause();
            currentTime = 0;
            return;
        }

        // Schedule more notes as we progress
        if (lastScheduleIndex < notesToPlay.length) {
            scheduleNotes();
        }

        updatePlayhead();
        updateTimeDisplay();
    }, 100);
}

// Pause playback
function pause() {
    console.log('Pausing playback');
    isPlaying = false;

    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }

    if (synth) {
        synth.releaseAll();
    }

    const playBtn = document.getElementById('playBtn');
    playBtn.classList.remove('playing');
    playBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
}

// Seek to position
function seekTo(event) {
    const timeline = document.getElementById('timeline');
    const rect = timeline.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = x / rect.width;

    currentTime = percent * duration;
    updatePlayhead();
    updateTimeDisplay();
}

// Update playhead position
function updatePlayhead() {
    const playhead = document.getElementById('playhead');
    const progressBar = document.getElementById('progressBar');

    if (playhead) {
        playhead.style.left = (currentTime * PIXELS_PER_SECOND) + 'px';
    }

    if (progressBar) {
        const percent = (currentTime / duration) * 100;
        progressBar.style.width = percent + '%';
    }
}

// Update time display
function updateTimeDisplay() {
    const current = formatTime(currentTime);
    const total = formatTime(duration);
    document.getElementById('timeDisplay').textContent = `${current} / ${total}`;
}

// Format time as M:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Save MIDI file
function saveMIDI() {
    if (!midiData) return;

    // Update MIDI data with edited notes
    midiData.tracks.forEach((track, trackIndex) => {
        track.notes = notes
            .filter(note => note.trackIndex === trackIndex)
            .map(note => ({
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                velocity: note.velocity,
                name: note.name
            }));
    });

    // Convert to binary and download
    const arrayBuffer = midiData.toArray();
    const blob = new Blob([arrayBuffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'edited_midi.mid';
    a.click();

    URL.revokeObjectURL(url);
}
