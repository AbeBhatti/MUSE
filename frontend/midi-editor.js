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

// API configuration (same-origin)
const API_URL = '';

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
        synth = new Tone.PolySynth(Tone.Synth, {
            maxPolyphony: 128,
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
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('audioInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      currentAudioFile = file;
      showModal('transcriptionModal');
  });

  document.getElementById('midiInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const arrayBuffer = await file.arrayBuffer();
      loadMIDI(arrayBuffer, file.name);
  });
});

// Preset configurations
const presets = {
    default: { onset: 0.5, frame: 0.3, minNote: 0.127, minFreq: '', maxFreq: '' },
    singing: { onset: 0.4, frame: 0.25, minNote: 0.1, minFreq: '80', maxFreq: '1100' },
    piano: { onset: 0.5, frame: 0.3, minNote: 0.08, minFreq: '27', maxFreq: '4200' },
    guitar: { onset: 0.4, frame: 0.25, minNote: 0.05, minFreq: '80', maxFreq: '1200' },
    bass: { onset: 0.5, frame: 0.3, minNote: 0.1, minFreq: '40', maxFreq: '400' }
};

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
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

function updateRangeValue(type, value) {
    const displayId = type === 'onset' ? 'onsetValue' :
                     type === 'frame' ? 'frameValue' : 'minNoteValue';
    document.getElementById(displayId).textContent = parseFloat(value).toFixed(3);
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal() {
    document.getElementById('transcriptionModal').classList.remove('active');
    document.getElementById('loadingModal').classList.remove('active');
}

async function startTranscription() {
    if (!currentAudioFile) return;

    closeModal();
    showModal('loadingModal');

    try {
        const formData = new FormData();
        formData.append('file', currentAudioFile);
        formData.append('onset_threshold', document.getElementById('onsetThreshold').value);
        formData.append('frame_threshold', document.getElementById('frameThreshold').value);
        formData.append('min_note_len', document.getElementById('minNoteLen').value);
        formData.append('min_freq', document.getElementById('minFreq').value || '');
        formData.append('max_freq', document.getElementById('maxFreq').value || '');
        formData.append('melodia_trick', 'true');

        const response = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Transcription failed: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        const midiResponse = await fetch(`${API_URL}/midi/${result.filename}`);
        if (!midiResponse.ok) throw new Error(`Failed to fetch MIDI file: ${midiResponse.status}`);
        const midiBuffer = await midiResponse.arrayBuffer();
        closeModal();
        loadMIDI(midiBuffer, result.filename);
    } catch (error) {
        closeModal();
        alert('Error during transcription: ' + error.message);
        console.error('Transcription error:', error);
    }
}

async function loadMIDI(arrayBuffer, filename) {
    try {
        midiData = new Midi(arrayBuffer);
        notes = [];
        midiData.tracks.forEach((track, trackIndex) => {
            track.notes.forEach(note => {
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

        duration = midiData.duration || 10;
        currentTime = 0;
        if (notes.length > 0 && duration === 0) {
            duration = Math.max(...notes.map(n => n.time + n.duration));
        }

        document.getElementById('fileInfo').textContent = `${filename} - ${notes.length} notes`;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('saveBtn').disabled = false;
        await initSynth();
        renderPianoRoll();
        renderPianoKeys();
        updateTimeDisplay();
    } catch (error) {
        console.error('Error loading MIDI:', error);
        alert('Error loading MIDI file: ' + error.message);
    }
}

function renderPianoKeys() {
    const pianoKeys = document.getElementById('pianoKeys');
    pianoKeys.innerHTML = '';
    for (let midi = 108; midi >= 21; midi--) {
        const noteName = MIDI_NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
        const key = document.createElement('div');
        key.className = 'piano-key ' + ((midi % 12 === 1 || midi % 12 === 3 || midi % 12 === 6 || midi % 12 === 8 || midi % 12 === 10) ? 'black' : 'white');
        key.textContent = noteName;
        pianoKeys.appendChild(key);
    }
}

function renderPianoRoll() {
    const roll = document.getElementById('pianoRoll');
    roll.innerHTML = '';
    const content = document.createElement('div');
    content.className = 'piano-roll-canvas';
    const height = (108 - 21 + 1) * NOTE_HEIGHT;
    const width = Math.max(800, Math.ceil(duration * PIXELS_PER_SECOND));
    content.style.height = height + 'px';
    content.style.width = width + 'px';
    roll.appendChild(content);

    for (let midi = 21; midi <= 108; midi++) {
        const y = (108 - midi) * NOTE_HEIGHT;
        const hline = document.createElement('div');
        hline.className = 'grid-line horizontal';
        hline.style.top = (y + NOTE_HEIGHT - 1) + 'px';
        content.appendChild(hline);
    }
    const totalSeconds = Math.ceil(duration);
    for (let s = 0; s <= totalSeconds; s++) {
        const x = s * PIXELS_PER_SECOND;
        const vline = document.createElement('div');
        vline.className = 'grid-line vertical';
        vline.style.left = x + 'px';
        content.appendChild(vline);
    }

    notes.forEach(n => {
        const div = document.createElement('div');
        div.className = 'note';
        const x = Math.max(0, Math.min(width, n.time * PIXELS_PER_SECOND));
        const w = Math.max(2, n.duration * PIXELS_PER_SECOND);
        const y = (108 - n.midi) * NOTE_HEIGHT;
        div.style.left = x + 'px';
        div.style.top = y + 'px';
        div.style.width = w + 'px';
        div.style.height = (NOTE_HEIGHT - 2) + 'px';
        div.title = `${n.name} @ ${n.time.toFixed(2)}s`;
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedNotes.has(n.id)) {
                selectedNotes.delete(n.id);
                div.classList.remove('selected');
            } else {
                selectedNotes.add(n.id);
                div.classList.add('selected');
            }
            document.getElementById('deleteBtn').disabled = selectedNotes.size === 0;
        });
        content.appendChild(div);
    });

    const playhead = document.createElement('div');
    playhead.id = 'playhead';
    playhead.className = 'playhead';
    content.appendChild(playhead);

    roll.addEventListener('click', (e) => {
        const rect = roll.getBoundingClientRect();
        const x = e.clientX - rect.left + roll.scrollLeft;
        seekToPosition(x / PIXELS_PER_SECOND);
    });
}

function updateTimeDisplay() {
    const fmt = (t) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };
    document.getElementById('timeDisplay').textContent = `${fmt(currentTime)} / ${fmt(duration)}`;
}

function togglePlay() {
    if (!isPlaying) {
        isPlaying = true;
        document.getElementById('playBtn').classList.add('playing');
        startPlayback();
    } else {
        isPlaying = false;
        document.getElementById('playBtn').classList.remove('playing');
        stopPlayback();
    }
}

function startPlayback() {
    const startTime = Tone.now();
    const startOffset = currentTime;
    const scheduled = [];
    const MAX_AT_ONCE = maxConcurrentNotes;

    let concurrent = 0;
    notes.forEach(n => {
        if (n.time + n.duration < startOffset) return;
        const scheduleAt = startTime + Math.max(0, n.time - startOffset);
        if (concurrent < MAX_AT_ONCE) {
            scheduled.push(setTimeout(() => {
                if (!isPlaying) return;
                try {
                    const freq = Tone.Frequency(n.midi, 'midi');
                    synth.triggerAttackRelease(freq, n.duration, undefined, n.velocity);
                } catch {}
            }, Math.max(0, (scheduleAt - Tone.now()) * 1000)));
            concurrent++;
        }
    });

    playInterval = setInterval(() => {
        currentTime += 0.05;
        if (currentTime >= duration) {
            currentTime = duration;
            togglePlay();
        }
        const playhead = document.getElementById('playhead');
        if (playhead) playhead.style.left = (currentTime * PIXELS_PER_SECOND) + 'px';
        const progress = document.getElementById('progressBar');
        if (progress) progress.style.width = ((currentTime / duration) * 100) + '%';
        updateTimeDisplay();
    }, 50);
}

function stopPlayback() {
    clearInterval(playInterval);
    playInterval = null;
}

function seekTo(e) {
    const rect = document.getElementById('timeline').getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(duration, (x / rect.width) * duration));
    seekToPosition(newTime);
}

function seekToPosition(t) {
    currentTime = t;
    const playhead = document.getElementById('playhead');
    if (playhead) playhead.style.left = (currentTime * PIXELS_PER_SECOND) + 'px';
    const progress = document.getElementById('progressBar');
    if (progress) progress.style.width = ((currentTime / duration) * 100) + '%';
    updateTimeDisplay();
}

function saveMIDI() {
    alert('Save not implemented yet.');
}

function deleteSelected() {
    if (selectedNotes.size === 0) return;
    notes = notes.filter(n => !selectedNotes.has(n.id));
    selectedNotes.clear();
    document.getElementById('deleteBtn').disabled = true;
    renderPianoRoll();
}

