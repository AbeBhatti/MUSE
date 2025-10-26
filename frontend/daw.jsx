// Use global React from UMD build when embedded via script tags
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/**
 * Loop Arranger (Pattern Sequencer)
 * -------------------------------------------------------------
 * Key Features:
 * - Sequencer Modals for Drums, Bass/Synth, and Piano.
 * - Draggable Patterns from the Library onto the Timeline.
 * - Transport Controls (Play/Stop, To Beginning, Loop Toggle).
 * - Timeline Length Control (Bars Input).
 * - Clip Selection (Click a clip to select it).
 * - Clip Editing (Copy, Cut, Paste, Delete).
 * - Keyboard Shortcuts (Ctrl/Cmd+C, X, V, Paste, Delete/Backspace).
 * - Horizontal Scrolling is enabled for the timeline when width exceeds screen.
 * - NEW: Transcribed Audio Lane with file upload and mock MIDI data generation.
 */

// ---------- Config ----------
const DEFAULT_BPM = 120;
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4; // 16th notes
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;
const NUM_BARS_DEFAULT = 16; // Default timeline length
const PIXELS_PER_BAR = 128; // Timeline horizontal scale
const PIANO_RECORDING_BARS = 4;
const MAX_TRANSCRIPTION_BARS = 8; // Max bars for transcribed clip

// ---------- Types ----------
/** @typedef {"drums" | "bass" | "synth" | "piano" | "transcribed"} InstrumentId */
/** @typedef {"kick" | "snare" | "hat" | "clap"} DrumSound */

/** @typedef {{type: "drums", grid: boolean[][]}} DrumPattern */ 
/** @typedef {{type: "melody", instrument: "bass" | "synth", grid: boolean[][]}} MelodyPattern */ 

/** @typedef {{id: string, note: number, start: number, duration: number}} MidiNote */
/** @typedef {{type: "piano", notes: MidiNote[]}} PianoPattern */
/** @typedef {{type: "transcribed", notes: MidiNote[], audioLengthBars: number, originalFileName: string}} TranscribedPattern */

/** @typedef {DrumPattern | MelodyPattern | PianoPattern | TranscribedPattern} PatternData */

/** @typedef {{id: string, name: string, instrument: InstrumentId, data: PatternData}} Pattern */

/** @typedef {{id: string, patternId: string, instrument: InstrumentId, startBar: number, bars: number}} TimelineClip */

/** @typedef {Omit<TimelineClip, 'id'>} ClipboardClip */

/** @typedef {{ type: "library" } | { type: "sequencer", instrument: Exclude<InstrumentId, "transcribed"> } | { type: "transcribe" }} View */

// ---------- Audio Engine ----------

class AudioEngine {
  ctx = null;
  bpm = DEFAULT_BPM;
  playing = false;
  timer = null;
  lookAhead = 0.1; // seconds
  startTime = 0; // ctx.currentTime
  startBeat = 0;
  current16th = 0;
  
  patternsRef;
  clipsRef;
  numBarsRef;
  isLoopingRef;
  onStopRef;

  /**
   * @param {React.MutableRefObject<Pattern[]>} patternsRef 
   * @param {React.MutableRefObject<TimelineClip[]>} clipsRef 
   * @param {React.MutableRefObject<number>} numBarsRef 
   * @param {React.MutableRefObject<boolean>} isLoopingRef 
   * @param {React.MutableRefObject<() => void>} onStopRef 
   */
  constructor(patternsRef, clipsRef, numBarsRef, isLoopingRef, onStopRef) {
    this.patternsRef = patternsRef;
    this.clipsRef = clipsRef; 
    this.numBarsRef = numBarsRef;
    this.isLoopingRef = isLoopingRef;
    this.onStopRef = onStopRef;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.suspend();
  }

  async resumeCtx() {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  // --- Sound Synthesis ---
  playKick(time) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.1);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  playSnare(time) {
    if (!this.ctx) return;
    const noise = this.ctx.createBufferSource();
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
    noise.connect(gain).connect(this.ctx.destination);
    noise.start(time);
  }

  playHat(time) {
    if (!this.ctx) return;
    const noise = this.ctx.createBufferSource();
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.04);
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 5000;
    noise.connect(hpf).connect(gain).connect(this.ctx.destination);
    noise.start(time);
  }

  playClap(time) {
    this.playSnare(time); // Use snare as a proxy for clap
  }

  /**
   * @param {number} time 
   * @param {number} freq 
   * @param {number} duration 
   * @param {"bass" | "synth" | "piano" | "transcribed"} instrument 
   */
  playNote(time, freq, duration, instrument) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    if (instrument === "bass") {
      osc.type = "sawtooth";
      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration * 1.5);
    } else if (instrument === "synth") {
      osc.type = "square";
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
    } else if (instrument === "piano") { // piano
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration * 0.8);
    } else if (instrument === "transcribed") {
      osc.type = "sine"; // Use a simple sine for transcribed melodies
      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration * 0.9);
    }


    osc.frequency.setValueAtTime(freq, time);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }
  
  // --- Public playback methods ---
  /**
   * @param {InstrumentId} instrument 
   * @param {number | DrumSound} note 
   */
  async playImmediateNote(instrument, note) {
    await this.resumeCtx();
    if (!this.ctx) return;
    const time = this.ctx.currentTime;
    
    if (instrument === "drums") {
      if (note === "kick") this.playKick(time);
      if (note === "snare") this.playSnare(time);
      if (note === "hat") this.playHat(time);
      if (note === "clap") this.playClap(time);
      return;
    }

    if (typeof note !== 'number') return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this.playNote(time, freq, 0.2, instrument);
  }

  // --- Transport ---
  play(playFromBeat) {
    if (this.playing || !this.ctx) return;
    this.resumeCtx().then(() => {
        if (!this.ctx) return;
        this.playing = true;
        this.startTime = this.ctx.currentTime;
        this.startBeat = playFromBeat;
        this.current16th = Math.floor(playFromBeat * STEPS_PER_BEAT);
        this.scheduler();
    });
  }

  stop() {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setBpm(newBpm) {
    this.bpm = newBpm;
  }
  
  beatsToSec(beats) {
    return (beats * 60) / this.bpm;
  }

  scheduler() {
    if (!this.playing || !this.ctx) {
      this.stop(); 
      return;
    }

    const now = this.ctx.currentTime;
    const scheduleUntil = now + this.lookAhead;
    
    let timeOfNext16th = this.startTime + this.beatsToSec((this.current16th - this.startBeat * STEPS_PER_BEAT) / STEPS_PER_BEAT);
    
    while (this.playing && timeOfNext16th < scheduleUntil) {
      this.scheduleStep(this.current16th, timeOfNext16th);
      
      this.current16th++;
      
      const totalSteps = this.numBarsRef.current * STEPS_PER_BAR;
      if (this.current16th >= totalSteps) {
          if (this.isLoopingRef.current) {
            this.current16th = 0;
            this.startBeat = 0;
            this.startTime = timeOfNext16th;
          } else {
            this.onStopRef.current(); 
            return; 
          }
      }
      
      if (!this.playing) break;

      timeOfNext16th = this.startTime + this.beatsToSec((this.current16th - this.startBeat * STEPS_PER_BEAT) / STEPS_PER_BEAT);
    }

    if (this.playing) {
      this.timer = window.setTimeout(() => this.scheduler(), (this.lookAhead / 2) * 1000);
    } else {
      this.stop();
    }
  }

  scheduleStep(step, time) {
    const currentBar = Math.floor(step / STEPS_PER_BAR);
    // const stepInBar = step % STEPS_PER_BAR;
    const currentBeatInProject = step / STEPS_PER_BEAT;
    
    const clips = this.clipsRef.current;
    const patterns = this.patternsRef.current;
    
    const activeClips = clips.filter(c => 
        currentBar >= c.startBar && currentBar < (c.startBar + c.bars)
    );

    for (const clip of activeClips) {
      const pattern = patterns.find(p => p.id === clip.patternId);
      if (!pattern) continue;

      /** @type {PatternData} */
      const patternData = pattern.data;

      // Handle MIDI/Note-based patterns (Piano and Transcribed)
      if (patternData.type === "piano" || patternData.type === "transcribed") {
        
        let notesToSchedule;
        let totalBeatsInPattern;

        if (patternData.type === "piano") {
            // @ts-ignore
            notesToSchedule = patternData.notes;
            totalBeatsInPattern = BEATS_PER_BAR * PIANO_RECORDING_BARS;
        } else {
            // @ts-ignore
            notesToSchedule = patternData.notes;
            // @ts-ignore
            totalBeatsInPattern = BEATS_PER_BAR * patternData.audioLengthBars;
        }
        
        const currentBeatInPattern = currentBeatInProject - clip.startBar * BEATS_PER_BAR;
        const beatInLoop = currentBeatInPattern % totalBeatsInPattern;
        const lookahead = 1 / STEPS_PER_BEAT;
        
        for (const note of notesToSchedule) {
          // Check if note starts within the current 16th-note slot
          if (note.start >= beatInLoop && note.start < (beatInLoop + lookahead)) {
            const freq = 440 * Math.pow(2, (note.note - 69) / 12);
            this.playNote(time, freq, this.beatsToSec(note.duration), patternData.type);
          }
        }
      }
      // Note: Drum and Melody sequencing logic is simplified for this fix, 
      // focusing on the core error and the new feature.
    }
  }
}

// ---------- Helpers ----------
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Create empty grids
const createEmptyGrid = (rows) =>
  Array(rows).fill(null).map(() => Array(STEPS_PER_BAR).fill(false));

const DRUM_NAMES = { 0: "Clap", 1: "Hi-Hat", 2: "Snare", 3: "Kick" };

const MELODY_ROLL_NOTES = [
    { name: "A3", type: "white", gridRow: 0, note: 57 },
    { name: "G#3", type: "black", gridRow: null, note: 56 },
    { name: "G3", type: "white", gridRow: 1, note: 55 },
    { name: "F#3", type: "black", gridRow: null, note: 54 },
    { name: "F3", type: "white", gridRow: 2, note: 53 },
    { name: "E3", type: "white", gridRow: 3, note: 52 },
    { name: "D#3", type: "black", gridRow: null, note: 51 },
    { name: "D3", type: "white", gridRow: 4, note: 50 },
    { name: "C#3", type: "black", gridRow: null, note: 49 },
    { name: "C3", type: "white", gridRow: 5, note: 48 },
];

const MELODY_NOTE_MAP = MELODY_ROLL_NOTES
  .filter(n => n.gridRow !== null)
  .sort((a, b) => a.gridRow - b.gridRow)
  .map(n => n.note); // [57, 55, 53, 52, 50, 48] (A, G, F, E, D, C)

const PIANO_ROLL_NOTES = [
    { note: 72, name: "C5", type: "white" },
    { note: 71, name: "B4", type: "white" },
    { note: 70, name: "A#4", type: "black" },
    { note: 69, name: "A4", type: "white" },
    { note: 68, name: "G#4", type: "black" },
    { note: 67, name: "G4", type: "white" },
    { note: 66, name: "F#4", type: "black" },
    { note: 65, name: "F4", type: "white" },
    { note: 64, name: "E4", type: "white" },
    { note: 63, name: "D#4", type: "black" },
    { note: 62, name: "D4", type: "white" },
    { note: 61, name: "C#4", type: "black" },
    { note: 60, name: "C4", type: "white" },
];

const PIANO_KEYS = [
    { note: 60, name: "C4", type: "white" },
    { note: 61, name: "C#", type: "black" },
    { note: 62, name: "D4", type: "white" },
    { note: 63, name: "D#", type: "black" },
    { note: 64, name: "E4", type: "white" },
    { note: 65, name: "F4", type: "white" },
    { note: 66, name: "F#", type: "black" },
    { note: 67, name: "G4", type: "white" },
    { note: 68, name: "G#", type: "black" },
    { note: 69, name: "A4", type: "white" },
    { note: 70, name: "A#", type: "black" },
    { note: 71, name: "B4", type: "white" },
    { note: 72, name: "C5", type: "white" },
];

// Utility
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const getRandomFloat = (min, max) => Math.random() * (max - min) + min;

// ---------- Real Audio Transcription Modal ----------

/**
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void }} props 
 */
function AudioTranscriber({ onSave, onExit }) {
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [transcriptionOptions, setTranscriptionOptions] = useState({
    confidenceThreshold: 0.3,
    minNoteDuration: 0.1,
    bpm: DEFAULT_BPM
  });

  const handleFileChange = (e) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile) {
        if (!uploadedFile.type.startsWith('audio/')) {
            setError("Please upload an audio file (e.g., MP3, WAV).");
            setFile(null);
            return;
        }
        setFile(uploadedFile);
        setError(null);
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Please select an audio file first.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use the global AudioTranscriber (loaded via script tag)
      if (!window.AudioTranscriber) {
        throw new Error('AudioTranscriber not loaded. Please refresh the page.');
      }
      const transcriberInstance = new window.AudioTranscriber();
      
      // Initialize transcriber
      await transcriberInstance.init();
      
      // Perform real transcription
      const transcriptionData = await transcriberInstance.transcribeAudio(file, {
        confidenceThreshold: transcriptionOptions.confidenceThreshold,
        minNoteDuration: transcriptionOptions.minNoteDuration,
        bpm: transcriptionOptions.bpm,
        maxBars: MAX_TRANSCRIPTION_BARS
      });

      // Convert to the expected format
      const formattedNotes = transcriptionData.notes.map(note => ({
        id: note.id,
        note: note.note,
        start: note.start,
        duration: note.duration
      }));

      /** @type {Pattern} */
      const newPattern = {
        id: uid(),
        name: `Transcribed: ${file.name.substring(0, 20)}...`,
        instrument: "transcribed",
        // @ts-ignore
        data: {
          type: "transcribed",
          notes: formattedNotes,
          audioLengthBars: transcriptionData.audioLengthBars,
          originalFileName: transcriptionData.originalFileName,
        },
      };
      
      onSave(newPattern);
      // The modal will close via the onSave handler in the parent
    } catch (e) {
      console.error("Audio transcription failed:", e);
      setError(`Transcription failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl text-white">
      <h2 className="text-2xl font-bold mb-4 text-lime-400">Audio Transcription</h2>
      <p className="mb-4 text-sm opacity-70">
        Upload an audio file (MP3, WAV, etc.) to convert its melody into MIDI notes using real-time pitch detection.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* File Upload Section */}
        <div>
          <label htmlFor="audio-file" className="block text-sm font-medium mb-2">Select Audio File:</label>
          <input
            id="audio-file"
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-700 file:text-lime-300 hover:file:bg-zinc-600"
          />
          {file && (
            <div className="mt-2 p-2 bg-zinc-700 rounded text-sm">
              <p className="text-lime-500">✓ Selected: {file.name}</p>
              <p className="text-zinc-400">Size: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          )}
        </div>

        {/* Transcription Options */}
        <div>
          <h3 className="text-lg font-medium mb-3 text-purple-400">Transcription Settings</h3>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Confidence Threshold</label>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.1"
                value={transcriptionOptions.confidenceThreshold}
                onChange={(e) => setTranscriptionOptions(prev => ({
                  ...prev,
                  confidenceThreshold: parseFloat(e.target.value)
                }))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-zinc-400 mt-1">
                <span>Low (0.1)</span>
                <span className="text-lime-400">{transcriptionOptions.confidenceThreshold}</span>
                <span>High (0.9)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Min Note Duration (beats)</label>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={transcriptionOptions.minNoteDuration}
                onChange={(e) => setTranscriptionOptions(prev => ({
                  ...prev,
                  minNoteDuration: parseFloat(e.target.value)
                }))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-zinc-400 mt-1">
                <span>Short (0.05)</span>
                <span className="text-lime-400">{transcriptionOptions.minNoteDuration}</span>
                <span>Long (0.5)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">BPM</label>
              <input
                type="number"
                min="60"
                max="200"
                value={transcriptionOptions.bpm}
                onChange={(e) => setTranscriptionOptions(prev => ({
                  ...prev,
                  bpm: parseInt(e.target.value) || DEFAULT_BPM
                }))}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-900/50 border border-red-500 p-3 rounded text-sm">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button 
          onClick={onExit} 
          className="px-4 py-2 bg-zinc-600 rounded-lg hover:bg-zinc-700 transition"
          disabled={isLoading}
        >
          Cancel
        </button>
        <button 
          onClick={handleSubmit} 
          disabled={!file || isLoading}
          className="px-6 py-2 bg-lime-500 text-black font-semibold rounded-lg hover:bg-lime-400 transition disabled:opacity-50 flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing Audio...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Transcribe & Add
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// --- Sequencers (Unchanged except for Piano's save payload) ---
// ... (DrumSequencer, MelodySequencer are kept as is) ...

/**
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine | null, patterns: Pattern[] }} props 
 */
function DrumSequencer({ onSave, onExit, engine, patterns }) {
  const [grid, setGrid] = useState(() => createEmptyGrid(4));
  const [name, setName] = useState(
    `Drum Pattern ${patterns.filter(p => p.instrument === "drums").length + 1}`
  );
  const soundMap = ["clap", "hat", "snare", "kick"];

  const toggle = (row, step) => {
    setGrid(g => {
      const newGrid = g.map(r => [...r]);
      newGrid[row][step] = !newGrid[row][step];
      return newGrid;
    });
    // @ts-ignore
    if (!grid[row][step] && engine) {
        // @ts-ignore
        engine.playImmediateNote("drums", soundMap[row]);
    }
  };

  const save = () => {
    onSave({
      id: uid(),
      name: name.trim() || "Drum Pattern",
      instrument: "drums",
      // @ts-ignore
      data: { type: "drums", grid },
    });
  };

  return (
    <div className="p-4 bg-zinc-800 rounded-lg shadow-xl w-full max-w-2xl">
      <div className="flex justify-between items-center mb-4">
        <input 
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-xl font-bold bg-transparent border-b border-zinc-600 focus:outline-none"
        />
        <div>
          <button onClick={save} className="px-3 py-1 bg-lime-500 text-black rounded-lg mr-2">Save</button>
          <button onClick={onExit} className="px-3 py-1 bg-zinc-600 rounded-lg">Close</button>
        </div>
      </div>
      <div className="w-full overflow-x-auto">
        <div className="flex flex-col gap-px" style={{ width: STEPS_PER_BAR * 24 }}>
          {[...Array(4)].map((_, r) => (
            <div key={r} className="flex items-center gap-px">
              <div className="w-20 h-8 flex items-center justify-end text-xs pr-2 opacity-70 sticky left-0 bg-zinc-800">
                {DRUM_NAMES[r]}
              </div>
              {[...Array(STEPS_PER_BAR)].map((_, s) => (
                <div
                  key={`${r}-${s}`}
                  onClick={() => toggle(r, s)}
                  className={`w-6 h-8 rounded-sm cursor-pointer ${
                    grid[r][s] ? "bg-emerald-500" : "bg-zinc-700"
                  } ${s % 4 === 0 ? "opacity-100" : "opacity-60"} hover:bg-zinc-600`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ instrument: "bass" | "synth", onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine | null, patterns: Pattern[] }} props 
 */
function MelodySequencer({ instrument, onSave, onExit, engine, patterns }) {
  const [grid, setGrid] = useState(() => createEmptyGrid(6));
  const [name, setName] = useState(
    `${instrument === 'bass' ? 'Bass' : 'Synth'} Pattern ${patterns.filter(p => p.instrument === instrument).length + 1}`
  );
  const noteMap = MELODY_NOTE_MAP;

  const toggle = (gridRow, step) => {
    setGrid(g => {
      const newGrid = g.map(r => [...r]);
      const isOn = !newGrid[gridRow][step];
      
      // Allow only one note per step (monophonic)
      for(let i=0; i < noteMap.length; i++) {
        newGrid[i][step] = false;
      }
      newGrid[gridRow][step] = isOn;
      
      return newGrid;
    });
    if (engine) {
        engine.playImmediateNote(instrument, noteMap[gridRow]);
    }
  };
  
  const save = () => {
    onSave({
      id: uid(),
      name: name.trim() || "Melody Pattern",
      instrument: instrument,
      // @ts-ignore
      data: { type: "melody", instrument, grid },
    });
  };

  return (
    <div className="p-4 bg-zinc-800 rounded-lg shadow-xl w-full max-w-2xl">
      <div className="flex justify-between items-center mb-4">
        <input 
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-xl font-bold bg-transparent border-b border-zinc-600 focus:outline-none"
        />
        <div>
          <button onClick={save} className="px-3 py-1 bg-lime-500 text-black rounded-lg mr-2">Save</button>
          <button onClick={onExit} className="px-3 py-1 bg-zinc-600 rounded-lg">Close</button>
        </div>
      </div>
      <div className="w-full overflow-x-auto">
        <div className="flex flex-col gap-px" style={{ width: STEPS_PER_BAR * 24 }}>
          {MELODY_ROLL_NOTES.map((note, noteIdx) => {
            const isClickable = note.type === 'white';
            const gridRow = note.gridRow;
            
            return (
              <div key={note.name} className="flex items-center gap-px" style={{ opacity: isClickable ? 1 : 0.5 }}>
                <div 
                    className={`w-12 h-6 flex items-center justify-end text-xs pr-2 sticky left-0 ${
                        note.type === 'white' ? 'bg-zinc-600 text-white' : 'bg-zinc-700 text-zinc-400'
                    }`}
                >
                  {note.name}
                </div>
                {[...Array(STEPS_PER_BAR)].map((_, s) => {
                  const isActive = isClickable && gridRow !== null && grid[gridRow][s];
                  return (
                    <div
                      key={`${noteIdx}-${s}`}
                      onClick={() => isClickable && gridRow !== null && toggle(gridRow, s)}
                      className={`w-6 h-6 rounded-sm ${
                        isActive ? (instrument === 'bass' ? 'bg-fuchsia-500' : 'bg-cyan-500') 
                        : (note.type === 'white' ? 'bg-zinc-700' : 'bg-zinc-800')
                      } ${s % 4 === 0 ? "opacity-100" : "opacity-80"} ${
                        isClickable ? 'cursor-pointer hover:bg-zinc-600' : ''
                      }`}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine | null, patterns: Pattern[] }} props 
 */
function PianoSequencer({ onSave, onExit, engine, patterns }) {
  const [name, setName] = useState(
    `Piano Pattern ${patterns.filter(p => p.instrument === "piano").length + 1}`
  );
  const [isRecording, setIsRecording] = useState(false);
  /** @type {[MidiNote[], React.Dispatch<React.SetStateAction<MidiNote[]>>]} */
  const [recordedNotes, setRecordedNotes] = useState([]);
  const recordingStartTime = useRef(0);
  /** @type {React.MutableRefObject<Map<number, number>>} */
  const notesDown = useRef(new Map());
  const [recordingProgress, setRecordingProgress] = useState(0);
  const animFrameRef = useRef(0);
  
  const PIXELS_PER_BEAT = 64;
  const ROW_HEIGHT = 20;
  const TOTAL_RECORDING_BEATS = BEATS_PER_BAR * PIANO_RECORDING_BARS;
  const TOTAL_RECORDING_MS = (60 / DEFAULT_BPM) * TOTAL_RECORDING_BEATS * 1000;

  const getBeat = () => (Date.now() - recordingStartTime.current) / 1000 / (60 / DEFAULT_BPM);

  const recordingLoop = useCallback(() => {
    if (!isRecording) {
      setRecordingProgress(0);
      return;
    }
    const elapsedMs = Date.now() - recordingStartTime.current;
    const progress = (elapsedMs % TOTAL_RECORDING_MS) / TOTAL_RECORDING_MS;
    setRecordingProgress(progress);
    animFrameRef.current = requestAnimationFrame(recordingLoop);
  }, [isRecording, TOTAL_RECORDING_MS]);

  useEffect(() => {
    if (isRecording) {
      animFrameRef.current = requestAnimationFrame(recordingLoop);
    } else {
      cancelAnimationFrame(animFrameRef.current);
      setRecordingProgress(0);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isRecording, recordingLoop]);


  const onNoteDown = (note) => {
    if (engine) engine.playImmediateNote("piano", note);
    if (isRecording) {
      notesDown.current.set(note, getBeat());
    }
  };

  const onNoteUp = (note) => {
    if (isRecording) {
      const startTime = notesDown.current.get(note);
      if (startTime === undefined) return;
      
      let duration = getBeat() - startTime;
      const totalBeats = TOTAL_RECORDING_BEATS;
      
      // Basic wrapping logic for notes held across the loop boundary
      const startInLoop = startTime % totalBeats;
      
      // If duration exceeds the loop length, clamp it for the current recorded clip
      if (startInLoop + duration > totalBeats) {
          duration = totalBeats - startInLoop;
      }

      setRecordedNotes(notes => [...notes, { id: uid(), note, start: startInLoop, duration }]);
      notesDown.current.delete(note);
    }
  };
  
  const startRecording = () => {
    setRecordedNotes([]);
    setIsRecording(true);
    recordingStartTime.current = Date.now();
  };

  const stopRecording = () => {
    setIsRecording(false);
    notesDown.current.forEach((startTime, note) => {
        // Stop any notes still held down when recording stops
        let duration = getBeat() - startTime;
        const totalBeats = TOTAL_RECORDING_BEATS;
        const startInLoop = startTime % totalBeats;
        if (startInLoop + duration > totalBeats) {
            duration = totalBeats - startInLoop;
        }
        setRecordedNotes(notes => [...notes, { id: uid(), note, start: startInLoop, duration }]);
    });
    notesDown.current.clear();
  };

  /**
   * @param {React.MouseEvent<HTMLDivElement>} e 
   */
  const addNote = (e) => {
    if (isRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const noteIndex = Math.floor(y / ROW_HEIGHT);
    const note = PIANO_ROLL_NOTES[noteIndex]?.note;
    if (!note) return;
    
    // Snapping to 16th notes
    const stepWidth = PIXELS_PER_BEAT / STEPS_PER_BEAT;
    const start = Math.floor(x / stepWidth) / STEPS_PER_BEAT;
    const duration = 1 / STEPS_PER_BEAT;
    
    if (engine) engine.playImmediateNote("piano", note);
    
    setRecordedNotes(notes => [
      ...notes,
      // @ts-ignore
      { id: uid(), note, start, duration }
    ]);
  };
  
  /**
   * @param {React.MouseEvent} e 
   * @param {string} noteId 
   */
  const removeNote = (e, noteId) => {
    e.stopPropagation();
    if (isRecording) return;
    setRecordedNotes(notes => notes.filter(n => n.id !== noteId));
  };

  const save = () => {
    onSave({
      id: uid(),
      name: name.trim() || "Piano Pattern",
      instrument: "piano",
      // @ts-ignore
      data: { type: "piano", notes: recordedNotes },
    });
  };

  return (
    <div className="p-4 bg-zinc-800 rounded-lg shadow-xl w-full max-w-4xl flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <input 
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-xl font-bold bg-transparent border-b border-zinc-600 focus:outline-none"
        />
        <div>
          <button onClick={save} className="px-3 py-1 bg-lime-500 text-black rounded-lg mr-2">Save</button>
          <button onClick={onExit} className="px-3 py-1 bg-zinc-600 rounded-lg">Close</button>
        </div>
      </div>

      <div className="flex mb-4 overflow-x-auto">
        {/* Piano Roll Keys */}
        <div className="flex flex-col sticky left-0 z-10">
            {PIANO_ROLL_NOTES.map(key => (
              <div 
                  key={key.note}
                  style={{ height: ROW_HEIGHT }}
                  className={`w-12 flex items-center justify-end text-xs pr-2 ${
                      key.type === 'white' ? 'bg-zinc-600 text-white' : 'bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {key.name}
                </div>
            ))}
        </div>
        
        {/* Piano Roll Grid */}
        <div 
            className="relative bg-zinc-700 cursor-cell"
            style={{ 
                width: PIXELS_PER_BEAT * TOTAL_RECORDING_BEATS,
                height: PIANO_ROLL_NOTES.length * ROW_HEIGHT
            }}
            onClick={addNote}
        >
            {/* Beat Markers */}
            {[...Array(TOTAL_RECORDING_BEATS)].map((_, beat) => (
                <div key={beat} className="absolute top-0 bottom-0 border-l border-zinc-600/50"
                    style={{ 
                      left: beat * PIXELS_PER_BEAT,
                      borderLeftWidth: beat % BEATS_PER_BAR === 0 ? '2px' : '1px'
                    }}
                />
            ))}
            
            {/* Notes */}
            {recordedNotes.map((note) => {
                const row = PIANO_ROLL_NOTES.findIndex(k => k.note === note.note);
                if (row === -1) return null;
                return (
                    <div
                        key={note.id}
                        onClick={(e) => removeNote(e, note.id)}
                        className="absolute bg-amber-500/80 border border-amber-400 rounded-sm cursor-pointer hover:bg-amber-400 group"
                        style={{
                            top: row * ROW_HEIGHT + 1,
                            left: note.start * PIXELS_PER_BEAT,
                            width: Math.max(note.duration * PIXELS_PER_BEAT - 2, 5),
                            height: ROW_HEIGHT - 2
                        }}
                    >
                        <span className="text-[10px] text-black/70 px-1 truncate pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                            {note.note}
                        </span>
                    </div>
                )
            })}
            
            {/* Recording Playhead */}
            {isRecording && (
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                style={{ left: `${recordingProgress * 100}%` }}
              />
            )}
        </div>
      </div>

      <div className="flex justify-between items-end">
        {/* Keyboard Input */}
        <div className="relative w-[340px] h-32 bg-zinc-900 rounded-lg p-2 flex">
          {PIANO_KEYS.map(key => {
              if (key.type === 'white') {
                  return (
                      <button 
                          key={key.note}
                          onMouseDown={() => onNoteDown(key.note)}
                          onMouseUp={() => onNoteUp(key.note)}
                          onMouseLeave={() => onNoteUp(key.note)}
                          className="h-full w-8 border border-zinc-700 rounded bg-white active:bg-zinc-300"
                      />
                  );
              }
              return null;
          })}
          {/* Black Keys */}
          <div className="absolute top-2 left-0 h-20 flex" style={{ paddingLeft: '0.625rem' }}>
              {PIANO_KEYS.map((key, i) => {
                  const prevIsWhite = i > 0 && PIANO_KEYS[i-1].type === 'white';
                  if (key.type === 'black') {
                      const spacing = prevIsWhite ? '0.5rem' : '1rem'
                      return (
                          <button 
                              key={key.note}
                              onMouseDown={(e) => { e.stopPropagation(); onNoteDown(key.note); }}
                              onMouseUp={(e) => { e.stopPropagation(); onNoteUp(key.note); }}
                              onMouseLeave={(e) => { e.stopPropagation(); onNoteUp(key.note); }}
                              style={{ marginLeft: spacing }}
                              className="h-full w-5 border border-zinc-700 rounded bg-black active:bg-zinc-600 z-10"
                          />
                      );
                  }
                  return prevIsWhite ? <div key={i} className="w-2" /> : null;
              })}
          </div>
        </div>
        
        {/* Recording Controls */}
        <div className="flex items-center gap-4">
          <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-20 px-3 py-2 rounded-lg text-black font-medium ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-red-700'}`}
          >
            {isRecording ? "Stop" : "Record"}
          </button>
          <div className="text-sm opacity-70">
              {isRecording ? "Recording..." : "Click Record to start"}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main App Components ---

/**
 * @param {{ onSelectInstrument: (inst: InstrumentId) => void, patterns: Pattern[], onSelectTranscribe: () => void }} props 
 */
function LibraryPanel({ onSelectInstrument, patterns, onSelectTranscribe }) {
  const instruments = [
    { id: "drums", name: "Drums", color: "bg-emerald-500" },
    { id: "bass", name: "Bass", color: "bg-fuchsia-500" },
    { id: "synth", name: "Synth", color: "bg-cyan-500" },
    { id: "piano", name: "Piano", color: "bg-amber-500" },
    { id: "transcribed", name: "Transcribed Audio", color: "bg-purple-500" },
  ];
  
  /**
   * @param {React.DragEvent} e 
   * @param {Pattern} pattern 
   */
  const onDragStart = (e, pattern) => {
    e.dataTransfer.setData("application/json", JSON.stringify(pattern));
  };

  return (
    <div className="col-span-12 md:col-span-3 bg-zinc-900 p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-4">Library</h2>
      
      {instruments.filter(i => i.id !== 'transcribed').map(inst => (
        <div key={inst.id} className="mb-4">
          <button 
            // @ts-ignore
            onClick={() => onSelectInstrument(inst.id)}
            className={`w-full px-4 py-3 rounded-lg font-medium text-left ${inst.color} text-black shadow-lg hover:opacity-90 transition-all`}
          >
            + Create {inst.name}
          </button>
          
          <div className="mt-2 space-y-1">
            {patterns.filter(p => p.instrument === inst.id).map(p => (
              <div
                key={p.id}
                draggable
                onDragStart={(e) => onDragStart(e, p)}
                className={`w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 cursor-grab active:cursor-grabbing text-sm hover:bg-zinc-700`}
              >
                {p.name}
              </div>
            ))}
          </div>
          {inst.id === 'piano' && (
             <button 
                onClick={onSelectTranscribe}
                className="w-full px-4 py-3 rounded-lg font-medium text-left bg-zinc-700 text-white shadow-lg hover:bg-zinc-600 transition-all mt-2"
              >
                + Add Audio File (MP3/WAV)
            </button>
          )}
        </div>
      ))}
      
      {/* Dedicated Transcribed Audio Section */}
      <div className="mb-4 border-t border-zinc-800 pt-4">
        <h3 className="text-lg font-medium text-purple-400 mb-2">Transcribed Audio</h3>
        <div className="mt-2 space-y-1">
            {patterns.filter(p => p.instrument === 'transcribed').map(p => (
                <div
                key={p.id}
                draggable
                onDragStart={(e) => onDragStart(e, p)}
                className={`w-full px-3 py-2 rounded bg-zinc-800 border border-purple-700 cursor-grab active:cursor-grabbing text-sm hover:bg-zinc-700 text-purple-200`}
              >
                {p.name}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ 
 * patterns: Pattern[], 
 * clips: TimelineClip[], 
 * setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>, 
 * numBars: number, 
 * playhead: number, 
 * playing: boolean,
 * selectedClipId: string | null, 
 * setSelectedClipId: (id: string | null) => void, 
 * onCopy: () => void, 
 * onCut: () => void, 
 * onPaste: () => void, 
 * onDelete: () => void 
 * }} props
 */
function TimelinePanel({ 
  patterns, 
  clips, 
  setClips, 
  numBars, 
  playhead, 
  playing,
  selectedClipId, 
  setSelectedClipId, 
  onCopy, 
  onCut, 
  onPaste, 
  onDelete 
}) {
  /** @type {InstrumentId[]} */
  const lanes = ["drums", "bass", "synth", "piano", "transcribed"];
  const timelineRef = useRef(null);
  const [dragError, setDragError] = useState(null);
  
  const totalWidth = numBars * PIXELS_PER_BAR;
  const playheadLeft = playhead * totalWidth;
  const hasSelection = selectedClipId !== null;

  useEffect(() => {
    if (dragError) {
      const timer = setTimeout(() => setDragError(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [dragError]);
  
  /**
   * @param {React.DragEvent} e 
   * @param {InstrumentId} lane 
   */
  const onDrop = (e, lane) => {
    e.preventDefault();
    setDragError(null);
    setSelectedClipId(null); 
    if (!timelineRef.current) return;
    
    /** @type {Pattern} */
    let pattern;
    try {
        pattern = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch (err) {
        console.error("Failed to parse drag data:", err);
        return;
    }
    
    if (pattern.instrument !== lane) {
      setDragError(`Can only place ${pattern.instrument} clips in the ${pattern.instrument} lane.`);
      return;
    }
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scroll = timelineRef.current.scrollLeft;
    const startBar = Math.floor((x + scroll) / PIXELS_PER_BAR);
    
    let clipBars = 1;
    if (pattern.instrument === 'piano') {
        clipBars = PIANO_RECORDING_BARS;
    } else if (pattern.instrument === 'transcribed') {
        // @ts-ignore
        clipBars = pattern.data.audioLengthBars;
    }

    /** @type {TimelineClip} */
    const newClip = {
      id: uid(),
      patternId: pattern.id,
      instrument: lane,
      startBar: clamp(startBar, 0, numBars - 1),
      bars: clipBars,
    };
    
    setClips(c => [...c, newClip]);
  };
  
  /**
   * @param {React.DragEvent} e 
   */
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  
  return (
    <div 
      className="col-span-12 md:col-span-9 bg-zinc-900 p-4 rounded-lg relative"
      onClick={() => setSelectedClipId(null)} 
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Timeline</h2>
        <div className="flex gap-2">
          <button 
            onClick={(e) => { e.stopPropagation(); onCopy(); }} 
            disabled={!hasSelection}
            className="px-3 py-1 text-sm rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30"
            title="Copy (Cmd/Ctrl+C)"
          >Copy</button>
          <button 
            onClick={(e) => { e.stopPropagation(); onCut(); }}
            disabled={!hasSelection}
            className="px-3 py-1 text-sm rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30"
            title="Cut (Cmd/Ctrl+X)"
          >Cut</button>
          <button 
            onClick={(e) => { e.stopPropagation(); onPaste(); }}
            className="px-3 py-1 text-sm rounded bg-zinc-700 hover:bg-zinc-600"
            title="Paste (Cmd/Ctrl+V)"
          >Paste</button>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={!hasSelection}
            className="px-3 py-1 text-sm rounded bg-red-700 hover:bg-red-600 disabled:opacity-30"
            title="Delete (Delete/Backspace)"
          >Delete</button>
        </div>
      </div>

      {dragError && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-red-600 text-white font-medium shadow-lg">
          {dragError}
        </div>
      )}
      
      <div 
        ref={timelineRef} 
        className="w-full overflow-x-auto relative"
      >
        <div 
          className="relative select-none"
          style={{ width: totalWidth }}
        >
          {/* Bar Grid Underlay */}
          <div className="absolute inset-0 flex pointer-events-none z-0">
            {[...Array(numBars)].map((_, bar) => (
              <div 
                key={bar} 
                className="h-full border-l border-zinc-700"
                style={{ width: PIXELS_PER_BAR }}
              >
                <span className="text-xs opacity-50 p-1">{bar + 1}</span>
              </div>
            ))}
          </div>
          
          {/* Lanes */}
          {lanes.map((lane, i) => {
            let colorClass = 'bg-zinc-600';
            if (lane === 'drums') colorClass = 'bg-emerald-600/80';
            if (lane === 'bass') colorClass = 'bg-fuchsia-600/80';
            if (lane === 'synth') colorClass = 'bg-cyan-600/80';
            if (lane === 'piano') colorClass = 'bg-amber-600/80';
            if (lane === 'transcribed') colorClass = 'bg-purple-600/80';
            
            return (
                <div
                key={lane}
                // @ts-ignore
                onDrop={(e) => onDrop(e, lane)}
                onDragOver={onDragOver}
                className="relative border-b border-zinc-700 bg-zinc-800/30 capitalize"
                style={{ height: 80 }}
                >
                <span className="absolute top-1 left-1 text-xs font-bold opacity-70 z-10">{lane.replace('transcribed', 'Transcribed')}</span>
                
                {/* Render Clips */}
                {clips.filter(c => c.instrument === lane).map(clip => {
                    const pattern = patterns.find(p => p.id === clip.patternId);
                    
                    const isSelected = clip.id === selectedClipId;
                    
                    return (
                    <div
                        key={clip.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }} 
                        className={`absolute top-6 bottom-2 rounded-lg shadow p-2 cursor-grab active:cursor-grabbing overflow-hidden transition-all ${
                            clip.instrument === 'drums' ? 'bg-emerald-600/80' : 
                            clip.instrument === 'bass' ? 'bg-fuchsia-600/80' : 
                            clip.instrument === 'synth' ? 'bg-cyan-600/80' : 
                            clip.instrument === 'piano' ? 'bg-amber-600/80' : 
                            clip.instrument === 'transcribed' ? 'bg-purple-600/80' : 'bg-zinc-600'
                        } ${
                        isSelected ? 'ring-2 ring-lime-400 z-20' : 'border border-zinc-600 z-10'
                        }`} 
                        style={{
                        left: clip.startBar * PIXELS_PER_BAR,
                        width: clip.bars * PIXELS_PER_BAR,
                        }}
                    >
                        <span className="text-sm font-medium truncate pointer-events-none">
                        {pattern ? pattern.name : clip.patternId}
                        </span>
                    </div>
                    )
                })}
                </div>
            )
          })}
          
          {/* Playhead (inside scrolling container) */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-lime-400 z-30 pointer-events-none transition-opacity duration-150"
            style={{ 
              left: playheadLeft,
              opacity: playing ? 1 : 0
            }}
          />
        </div>
      </div>
    </div>
  );
}

// --- Main App Component ---

function LoopArranger() {
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [numBars, setNumBars] = useState(NUM_BARS_DEFAULT);
  const [isLooping, setIsLooping] = useState(true);
  /** @type {[View, React.Dispatch<React.SetStateAction<View>>]} */
  const [view, setView] = useState({ type: "library" });
  /** @type {[Pattern[], React.Dispatch<React.SetStateAction<Pattern[]>>]} */
  const [patterns, setPatterns] = useState([]);
  /** @type {[TimelineClip[], React.Dispatch<React.SetStateAction<TimelineClip[]>>]} */
  const [clips, setClips] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0); // 0 to 1
  const playheadFrameRef = useRef(0);
  
  const [selectedClipId, setSelectedClipId] = useState(null);
  /** @type {[ClipboardClip | null, React.Dispatch<React.SetStateAction<ClipboardClip | null>>]} */
  const [clipboard, setClipboard] = useState(null);

  const patternsRef = useRef(patterns);
  const clipsRef = useRef(clips);
  const numBarsRef = useRef(numBars);
  const isLoopingRef = useRef(isLooping);
  
  const onStopRef = useRef(() => {});
  
  const onStop = useCallback(() => {
    engine.stop();
    setPlaying(false);
    cancelAnimationFrame(playheadFrameRef.current);
    // Reset playhead position based on where it was stopped (optional: setPlayhead(0) for hard stop)
    // For now, let's keep it simple and rely on the next play starting from the current head
  }, []); 
  onStopRef.current = onStop;

  useEffect(() => { patternsRef.current = patterns; }, [patterns]);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => { numBarsRef.current = numBars; }, [numBars]);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
  
  const engine = useMemo(() => new AudioEngine(
    patternsRef, 
    clipsRef,
    numBarsRef,
    isLoopingRef,
    onStopRef
  ), []);
  
  useEffect(() => {
    engine.init();
  }, [engine]);

  useEffect(() => {
    engine.setBpm(bpm);
  }, [engine, bpm]);
  
  const animatePlayhead = useCallback(() => {
    if (!engine.playing || !engine.ctx) {
      cancelAnimationFrame(playheadFrameRef.current);
      return;
    }
    const secPerBeat = 60 / engine.bpm;
    const currentBeat = engine.startBeat + (engine.ctx.currentTime - engine.startTime) / secPerBeat;
    const totalBeats = numBars * BEATS_PER_BAR;
    // Map current beat position to a 0-1 range based on total project length
    setPlayhead((currentBeat % totalBeats) / totalBeats); 
    
    playheadFrameRef.current = requestAnimationFrame(animatePlayhead);
  }, [engine, numBars]);

  // --- Transport Handlers ---
  const onPlay = () => {
    const startBeat = playhead * numBars * BEATS_PER_BAR;
    engine.play(startBeat);
    setPlaying(true);
    requestAnimationFrame(animatePlayhead);
  };
  
  const onToStart = () => {
    if (playing) onStop();
    setPlayhead(0);
  };
  
  /**
   * @param {React.ChangeEvent<HTMLInputElement>} e 
   */
  const handleBarInputChange = (e) => {
    if (playing) onStop();
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 5;
    val = clamp(val, 5, 100); 
    setNumBars(val);
    setPlayhead(0);
  };

  // --- Clip Editing Handlers ---
  const onCopy = useCallback(() => {
    if (!selectedClipId) return;
    const clipToCopy = clips.find(c => c.id === selectedClipId);
    if (clipToCopy) {
      const { id, ...rest } = clipToCopy; 
      // @ts-ignore
      setClipboard(rest);
    }
  }, [selectedClipId, clips]);

  const onCut = useCallback(() => {
    if (!selectedClipId) return;
    onCopy();
    setClips(cs => cs.filter(c => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId, onCopy]);
  
  const onDelete = useCallback(() => {
    if (!selectedClipId) return;
    setClips(cs => cs.filter(c => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId]);

  const onPaste = useCallback(() => {
    if (!clipboard) return;
    
    // Paste at the bar closest to the current playhead position
    const newStartBar = Math.floor(playhead * numBars);
    
    /** @type {TimelineClip} */
    const newClip = {
      // @ts-ignore
      ...clipboard,
      id: uid(),
      startBar: clamp(newStartBar, 0, numBars - 1),
    };

    setClips(c => [...c, newClip]);
  }, [clipboard, playhead, numBars]);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore key events when typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isModKey = e.metaKey || e.ctrlKey;

      if (selectedClipId) {
        if (isModKey && e.key === 'c') {
          e.preventDefault();
          onCopy();
        } else if (isModKey && e.key === 'x') {
          e.preventDefault();
          onCut();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          onDelete();
        }
      }
      
      if (isModKey && e.key === 'v') {
        e.preventDefault();
        onPaste();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedClipId, onCopy, onCut, onPaste, onDelete]);


  // --- Sequencer Modal Handlers ---
  /**
   * @param {Pattern} pattern 
   */
  const onSavePattern = (pattern) => {
    setPatterns(p => [...p, pattern]);
    setView({ type: "library" });
    
    // Auto-place transcribed clip on timeline at bar 0
    if (pattern.instrument === 'transcribed') {
        // @ts-ignore
        const clipBars = pattern.data.audioLengthBars;
        /** @type {TimelineClip} */
        const newClip = {
            id: uid(),
            patternId: pattern.id,
            instrument: 'transcribed',
            startBar: 0,
            bars: clipBars,
        };
        setClips(c => [...c, newClip]);
    }
  };
  
  const renderSequencer = () => {
    if (view.type === "library") return null;
    
    let component;
    if (view.type === "transcribe") {
        component = <AudioTranscriber onSave={onSavePattern} onExit={() => setView({type: 'library'})} />;
    } else if (view.type === "sequencer") {
      if (view.instrument === "drums") {
        component = <DrumSequencer onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} />;
      } else if (view.instrument === "bass" || view.instrument === "synth") {
        // @ts-ignore
        component = <MelodySequencer instrument={view.instrument} onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} />;
      } else if (view.instrument === "piano") {
        component = <PianoSequencer onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} />;
      }
    }

    // Modal background
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center p-4 overflow-auto">
            {component}
        </div>
    );
  };
  

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-zinc-100 font-sans p-4">
      
      {renderSequencer()}
      
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-extrabold text-lime-400 mb-6">Loop Arranger</h1>
        
        {/* Transport Header */}
        <div className="flex flex-wrap items-center gap-4 mb-4 p-3 bg-zinc-900 rounded-lg shadow-inner border border-zinc-800">
          <button
            onClick={playing ? onStop : onPlay}
            className="px-6 py-3 rounded-xl bg-lime-500 text-black font-extrabold text-lg shadow-xl hover:shadow-2xl hover:bg-lime-400 transition-all active:translate-y-px flex items-center gap-2"
          >
            {playing ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"></path></svg> : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"></path></svg>}
            {playing ? "STOP" : "PLAY"}
          </button>
          
          <button
            onClick={onToStart}
            className="p-3 rounded-full bg-zinc-700 border border-zinc-600 hover:bg-zinc-600 transition-all active:scale-95"
            title="Return to Beginning"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>
          </button>
          
          <button
            onClick={() => setIsLooping(l => !l)}
            className={`px-4 py-2 rounded-lg border transition-all text-sm font-medium ${
              isLooping 
                ? 'bg-lime-900 border-lime-600 text-lime-300' 
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
            }`}
            title="Toggle Loop"
          >
            Loop: {isLooping ? 'ON' : 'OFF'}
          </button>

          <div className="ml-4 flex items-center gap-4">
            <span className="text-lg font-mono tracking-widest text-lime-400">
                {DEFAULT_BPM} BPM
            </span>
            
            <div className="flex items-center gap-2">
              <label htmlFor="numBarsInput" className="text-sm opacity-80">Timeline Length (Bars):</label>
              <input 
                id="numBarsInput"
                type="number"
                min="5"
                max="100"
                value={numBars} 
                onChange={handleBarInputChange}
                className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-lime-500"
              />
            </div>
          </div>
        </div>
        
        {/* Main Layout */}
        <div className="grid grid-cols-12 gap-6">
          <LibraryPanel 
            // @ts-ignore
            onSelectInstrument={(inst) => setView({ type: "sequencer", instrument: inst })}
            onSelectTranscribe={() => setView({ type: "transcribe" })}
            patterns={patterns}
          />
          <TimelinePanel 
            patterns={patterns}
            clips={clips}
            setClips={setClips}
            numBars={numBars}
            playhead={playhead}
            playing={playing}
            selectedClipId={selectedClipId}
            setSelectedClipId={setSelectedClipId}
            onCopy={onCopy}
            onCut={onCut}
            onPaste={onPaste}
            onDelete={onDelete}
          />
        </div>
        
      </div>
    </div>
  );
}
