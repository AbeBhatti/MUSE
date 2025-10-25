// frontend/app.js
// Main application logic: Tone.js (audio) + Y.js (collaboration)

import * as Tone from 'https://cdn.skypack.dev/tone';
import * as Y from 'https://cdn.skypack.dev/yjs';
import { WebsocketProvider } from 'https://cdn.skypack.dev/y-websocket';

// ==========================================
// 1. TONE.JS SETUP (Audio Engine)
// ==========================================

// Create drum sounds using Tone.js
const kick = new Tone.MembraneSynth({
  pitchDecay: 0.05,
  octaves: 10,
  oscillator: { type: 'sine' },
  envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 }
}).toDestination();

const snare = new Tone.NoiseSynth({
  noise: { type: 'white' },
  envelope: { attack: 0.001, decay: 0.2, sustain: 0 }
}).toDestination();

const hihat = new Tone.MetalSynth({
  frequency: 200,
  envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  octaves: 1.5
}).toDestination();

const clap = new Tone.NoiseSynth({
  noise: { type: 'pink' },
  envelope: { attack: 0.001, decay: 0.15, sustain: 0 }
}).toDestination();

// Array of instruments (order matters - matches grid rows)
const instruments = [kick, snare, hihat, clap];

// ==========================================
// 2. Y.JS SETUP (Collaboration)
// ==========================================

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'beat-room-main',
  ydoc
);

// Shared beat grid state (4 instruments x 16 steps)
const yBeats = ydoc.getArray('beats');

// Initialize empty grid if this is the first user
if (yBeats.length === 0) {
  const emptyGrid = Array(4).fill(null).map(() => Array(16).fill(0));
  yBeats.insert(0, emptyGrid);
}

// User awareness (for showing online users)
const awareness = provider.awareness;

// ==========================================
// 3. UI SETUP
// ==========================================

const beatGrid = document.getElementById('beat-grid');
const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const bpmSlider = document.getElementById('bpm');
const bpmValue = document.getElementById('bpm-value');
const connectionStatus = document.getElementById('connection-status');
const userCount = document.getElementById('user-count');

// Generate grid cells (4 rows x 16 columns)
function createGrid() {
  beatGrid.innerHTML = '';
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 16; col++) {
      const cell = document.createElement('div');
      cell.className = 'beat-cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      
      // Click handler
      cell.addEventListener('click', () => toggleBeat(row, col));
      
      beatGrid.appendChild(cell);
    }
  }
}

// Render grid from Y.js state
function renderGrid() {
  const beats = yBeats.toJSON();
  const cells = beatGrid.querySelectorAll('.beat-cell');
  
  cells.forEach(cell => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    
    if (beats[row] && beats[row][col] === 1) {
      cell.classList.add('active');
    } else {
      cell.classList.remove('active');
    }
  });
}

// Toggle beat on/off
function toggleBeat(row, col) {
  const beats = yBeats.toJSON();
  beats[row][col] = beats[row][col] === 1 ? 0 : 1;
  
  // Update Y.js (automatically syncs to other users)
  yBeats.delete(0, yBeats.length);
  yBeats.insert(0, beats);
}

// ==========================================
// 4. PLAYBACK (Sequencer Loop)
// ==========================================

let currentStep = 0;
let isPlaying = false;

const loop = new Tone.Loop((time) => {
  const beats = yBeats.toJSON();
  
  // Play sounds for active cells in current step
  beats.forEach((row, instrumentIndex) => {
    if (row[currentStep] === 1) {
      // Trigger the instrument
      if (instrumentIndex === 0) {
        kick.triggerAttackRelease('C1', '8n', time);
      } else if (instrumentIndex === 1) {
        snare.triggerAttackRelease('8n', time);
      } else if (instrumentIndex === 2) {
        hihat.triggerAttackRelease('32n', time);
      } else if (instrumentIndex === 3) {
        clap.triggerAttackRelease('8n', time);
      }
    }
  });
  
  // Visual feedback
  highlightCurrentStep(currentStep);
  
  // Move to next step
  currentStep = (currentStep + 1) % 16;
}, '16n'); // 16th note intervals

function highlightCurrentStep(step) {
  // Remove previous highlighting
  document.querySelectorAll('.beat-cell.playing').forEach(cell => {
    cell.classList.remove('playing');
  });
  
  // Highlight current column
  document.querySelectorAll(`[data-col="${step}"]`).forEach(cell => {
    cell.classList.add('playing');
  });
}

// ==========================================
// 5. TRANSPORT CONTROLS
// ==========================================

playBtn.addEventListener('click', async () => {
  if (!isPlaying) {
    await Tone.start(); // Required for browser audio policy
    Tone.Transport.start();
    loop.start(0);
    isPlaying = true;
    playBtn.textContent = '⏸ Pause';
  } else {
    Tone.Transport.pause();
    isPlaying = false;
    playBtn.textContent = '▶ Play';
  }
});

stopBtn.addEventListener('click', () => {
  Tone.Transport.stop();
  loop.stop();
  currentStep = 0;
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  
  // Clear visual feedback
  document.querySelectorAll('.beat-cell.playing').forEach(cell => {
    cell.classList.remove('playing');
  });
});

// BPM control
bpmSlider.addEventListener('input', (e) => {
  const bpm = e.target.value;
  Tone.Transport.bpm.value = bpm;
  bpmValue.textContent = bpm;
});

// ==========================================
// 6. COLLABORATION LISTENERS
// ==========================================

// Listen for changes from other users
yBeats.observe(() => {
  renderGrid();
});

// Connection status
provider.on('status', (event) => {
  if (event.status === 'connected') {
    connectionStatus.textContent = '🟢 Connected';
    connectionStatus.classList.add('connected');
    connectionStatus.classList.remove('disconnected');
  } else {
    connectionStatus.textContent = '🔴 Disconnected';
    connectionStatus.classList.add('disconnected');
    connectionStatus.classList.remove('connected');
  }
});

// Track online users
awareness.on('change', () => {
  const states = Array.from(awareness.getStates().values());
  userCount.textContent = `${states.length} user${states.length !== 1 ? 's' : ''} online`;
});

// Set local user info
awareness.setLocalState({
  user: {
    name: `User${Math.floor(Math.random() * 1000)}`,
    color: `hsl(${Math.random() * 360}, 70%, 60%)`
  }
});

// ==========================================
// 7. INITIALIZE
// ==========================================

createGrid();
renderGrid();

console.log('🎵 Beat maker initialized!');
console.log('🔗 Connected to collaboration server');
console.log('Click the grid to create beats, press Play to hear them!');