// Use global React from UMD build loaded in daw-editor.html
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/**
 * Loop Arranger (Pattern Sequencer)
 * -------------------------------------------------------------
 * v5 Changes:
 * - Bar Selection: Replaced dropdown with a number input (5-100).
 * - Naming: Sequencers now default to "Drum Pattern 1", "Drum Pattern 2",
 * etc., while still allowing custom names.
 * - Melody Sequencer: Fixed "unhittable" notes. The Bass & Synth
 * sequencers are now a 6-note piano roll (C,D,E,F,G,A) and
 * all white keys are clickable.
 * - Clip Editing: Added "Cut", "Copy", "Paste", and "Delete" buttons.
 * - Clip Selection: You can now click to select a clip on the timeline.
 * - Keyboard Shortcuts: Added support for:
 * - Ctrl/Cmd + C: Copy selected clip
 * - Ctrl/Cmd + X: Cut selected clip
 * - Ctrl/Cmd + V: Paste clip at playhead position
 * - Delete/Backspace: Delete selected clip
 */

// ---------- Config ----------
const DEFAULT_BPM = 120;
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4; // 16th notes
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;
const NUM_BARS_DEFAULT = 16; // Default timeline length
const PIXELS_PER_BAR = 128; // Timeline horizontal scale
const PIANO_RECORDING_BARS = 4;

// Note: Removed TypeScript types to make this plain JSX.

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

  constructor(
    patternsRef,
    clipsRef,
    numBarsRef,
    isLoopingRef,
    onStopRef
  ) {
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
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  // --- Sound Synthesis ---
  playKick(time) {
    // ... existing sound synthesis code ...
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
    // ... existing sound synthesis code ...
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
    // ... existing sound synthesis code ...
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

  playNote(time, freq, duration, instrument) {
    // ... existing sound synthesis code ...
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
    } else { // piano
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + duration * 0.8);
    }

    osc.frequency.setValueAtTime(freq, time);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }
  
  // --- Public playback methods ---
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
    // NEW: Use "bass" or "synth" for immediate play
    this.playNote(time, freq, 0.2, instrument === "piano" ? "piano" : instrument);
  }

  // --- Transport ---
  play(playFromBeat) {
    // ... existing transport code ...
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
    // ... existing transport code ...
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
    // ... existing transport code ...
    if (!this.playing || !this.ctx) {
      this.stop(); // Ensure timer is cleared
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
    // ... existing scheduleStep code ...
    const currentBar = Math.floor(step / STEPS_PER_BAR);
    const stepInBar = step % STEPS_PER_BAR;
    
    const clips = this.clipsRef.current;
    const patterns = this.patternsRef.current;
    
    const activeClips = clips.filter(c => 
        currentBar >= c.startBar && currentBar < (c.startBar + c.bars)
    );

    for (const clip of activeClips) {
      const pattern = patterns.find(p => p.id === clip.patternId);
      if (!pattern) continue;

      const patternData = pattern.data;
      
      if (patternData.type === "drums") {
        const drumMap = ["clap", "hat", "snare", "kick"];
        for (let row = 0; row < 4; row++) {
          if (patternData.grid[row][stepInBar]) {
            const sound = drumMap[row];
            if (sound === 'kick') this.playKick(time);
            else if (sound === 'snare') this.playSnare(time);
            else if (sound === 'hat') this.playHat(time);
            else if (sound === 'clap') this.playClap(time);
          }
        }
      } 
      else if (patternData.type === "melody") {
        // NEW: Use the 6-note map
        const noteMap = MELODY_NOTE_MAP; // [69, 67, 65, 64, 62, 60]
        for (let row = 0; row < noteMap.length; row++) {
          if (patternData.grid[row][stepInBar]) {
            const freq = 440 * Math.pow(2, (noteMap[row] - 69) / 12);
            this.playNote(time, freq, this.beatsToSec(1 / STEPS_PER_BEAT), patternData.instrument);
          }
        }
      }
      else if (patternData.type === "piano") {
        // ... existing piano scheduling logic ...
        const currentBeatInBar = stepInBar / STEPS_PER_BEAT;
        const currentBeatInPattern = (currentBar - clip.startBar) * BEATS_PER_BAR + currentBeatInBar;
        const beatInLoop = currentBeatInPattern % (BEATS_PER_BAR * PIANO_RECORDING_BARS);
        const lookahead = 1 / STEPS_PER_BEAT;
        
        for (const note of patternData.notes) {
          if (note.start >= beatInLoop && note.start < (beatInLoop + lookahead)) {
            const freq = 440 * Math.pow(2, (note.note - 69) / 12);
            this.playNote(time, freq, this.beatsToSec(note.duration), "piano");
          }
        }
      }
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

// NEW: Refactored Melody/Bass sequencer to use 6 notes (C3-A3)
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
// NEW: Note map for the 6 grid rows
const MELODY_NOTE_MAP = MELODY_ROLL_NOTES
  .filter(n => n.gridRow !== null)
  .sort((a, b) => (a.gridRow ?? 0) - (b.gridRow ?? 0))
  .map(n => n.note); // [57, 55, 53, 52, 50, 48] (A, G, F, E, D, C)

const PIANO_ROLL_NOTES = [
    // ... existing piano roll notes ...
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


// ---------- React Components ----------

// --- Sequencers ---

function DrumSequencer({ onSave, onExit, engine, patterns }) {
  const [grid, setGrid] = useState(() => createEmptyGrid(4));
  // NEW: Default naming
  const [name, setName] = useState(
    `Drum Pattern ${patterns.filter(p => p.instrument === "drums").length + 1}`
  );
  const soundMap = ["clap", "hat", "snare", "kick"];

  const toggle = (row, step) => {
    // ... existing toggle logic ...
    setGrid(g => {
      const newGrid = g.map(r => [...r]);
      newGrid[row][step] = !newGrid[row][step];
      return newGrid;
    });
    if (!grid[row][step] && engine) {
        engine.playImmediateNote("drums", soundMap[row]);
    }
  };

  const save = () => {
    // ... existing save logic ...
    onSave({
      id: uid(),
      name: name.trim() || "Drum Pattern", // Ensure name isn't empty
      instrument: "drums",
      data: { type: "drums", grid },
    });
  };

  return (
    // ... existing DrumSequencer JSX ...
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

function MelodySequencer({ instrument, onSave, onExit, engine, patterns }) {
  // NEW: Grid is now 6 rows
  const [grid, setGrid] = useState(() => createEmptyGrid(6));
  // NEW: Default naming
  const [name, setName] = useState(
    `${instrument === 'bass' ? 'Bass' : 'Synth'} Pattern ${patterns.filter(p => p.instrument === instrument).length + 1}`
  );
  // NEW: Note map uses all 6 notes
  const noteMap = MELODY_NOTE_MAP;

  const toggle = (gridRow, step) => {
    setGrid(g => {
      const newGrid = g.map(r => [...r]);
      const isOn = !newGrid[gridRow][step];
      
      // Allow only one note per step
      for(let i=0; i < noteMap.length; i++) {
        newGrid[i][step] = false;
      }
      newGrid[gridRow][step] = isOn;
      
      return newGrid;
    });
     // Play sound on click
     if (engine) {
        engine.playImmediateNote(instrument, noteMap[gridRow]);
    }
  };
  
  const save = () => {
    onSave({
      id: uid(),
      name: name.trim() || "Melody Pattern", // Ensure name isn't empty
      instrument: instrument,
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
      {/* NEW: Piano Roll Layout (now fully clickable) */}
      <div className="w-full overflow-x-auto">
        <div className="flex flex-col gap-px" style={{ width: STEPS_PER_BAR * 24 }}>
          {MELODY_ROLL_NOTES.map((note, noteIdx) => {
            const isClickable = note.gridRow !== null;
            const gridRow = note.gridRow;
            
            return (
              <div key={note.name} className="flex items-center gap-px">
                <div 
                    className={`w-12 h-6 flex items-center justify-end text-xs pr-2 sticky left-0 ${
                        note.type === 'white' ? 'bg-zinc-600 text-white' : 'bg-zinc-700 text-zinc-400'
                    }`}
                >
                  {note.name}
                </div>
                {[...Array(STEPS_PER_BAR)].map((_, s) => {
                  const rowIdx = typeof gridRow === 'number' ? gridRow : -1;
                  const isActive = isClickable && rowIdx >= 0 && grid[rowIdx][s];
                  return (
                    <div
                      key={`${noteIdx}-${s}`}
                      onClick={() => { if (isClickable && rowIdx >= 0) toggle(rowIdx, s); }}
                      className={`w-6 h-6 rounded-sm ${
                        isActive ? (instrument === 'bass' ? 'bg-fuchsia-500' : 'bg-cyan-500') 
                        // NEW: All white keys are clickable
                        : (note.type === 'white' ? 'bg-zinc-700' : 'bg-zinc-800')
                      } ${s % 4 === 0 ? "opacity-100" : "opacity-80"} ${
                        // NEW: All white keys are clickable
                        isClickable ? 'cursor-pointer hover:bg-zinc-600' : 'opacity-50'
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

// --- Piano ---
const PIANO_KEYS = [
  // ... existing PIANO_KEYS ...
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

function PianoSequencer({ onSave, onExit, engine, patterns }) {
  // NEW: Default naming
  const [name, setName] = useState(
    `Piano Pattern ${patterns.filter(p => p.instrument === "piano").length + 1}`
  );
  const [isRecording, setIsRecording] = useState(false);
  const [recordedNotes, setRecordedNotes] = useState([]);
  const recordingStartTime = useRef(0);
  const notesDown = useRef(new Map());
  const [recordingProgress, setRecordingProgress] = useState(0);
  const animFrameRef = useRef(0);
  
  const PIXELS_PER_BEAT = 64;
  const ROW_HEIGHT = 20;
  const TOTAL_RECORDING_BEATS = BEATS_PER_BAR * PIANO_RECORDING_BARS;
  const TOTAL_RECORDING_MS = (60 / DEFAULT_BPM) * TOTAL_RECORDING_BEATS * 1000;

  const getBeat = () => (Date.now() - recordingStartTime.current) / 1000 / (60 / DEFAULT_BPM);

  const recordingLoop = useCallback(() => {
    // ... existing recordingLoop logic ...
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
    // ... existing recordingLoop useEffect ...
    if (isRecording) {
      animFrameRef.current = requestAnimationFrame(recordingLoop);
    } else {
      cancelAnimationFrame(animFrameRef.current);
      setRecordingProgress(0);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isRecording, recordingLoop]);


  const onNoteDown = (note) => {
    // ... existing onNoteDown logic ...
    if (engine) engine.playImmediateNote("piano", note);
    if (isRecording) {
      notesDown.current.set(note, getBeat());
    }
  };

  const onNoteUp = (note) => {
    // ... existing onNoteUp logic ...
    if (isRecording) {
      const startTime = notesDown.current.get(note);
      if (startTime === undefined) return;
      let duration = getBeat() - startTime;
      if (startTime < TOTAL_RECORDING_BEATS) {
        if (startTime + duration > TOTAL_RECORDING_BEATS) {
            duration = TOTAL_RECORDING_BEATS - startTime;
        }
        setRecordedNotes(notes => [...notes, { id: uid(), note, start: startTime, duration }]);
      }
      notesDown.current.delete(note);
    }
  };
  
  const startRecording = () => {
    // ... existing startRecording logic ...
    setRecordedNotes([]);
    setIsRecording(true);
    recordingStartTime.current = Date.now();
  };

  const stopRecording = () => {
    // ... existing stopRecording logic ...
    setIsRecording(false);
    notesDown.current.clear();
  };

  const addNote = (e) => {
    // ... existing addNote logic ...
    if (isRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const noteIndex = Math.floor(y / ROW_HEIGHT);
    const note = PIANO_ROLL_NOTES[noteIndex]?.note;
    if (!note) return;
    const start = Math.floor(x / (PIXELS_PER_BEAT / STEPS_PER_BEAT)) / STEPS_PER_BEAT;
    const duration = 1 / STEPS_PER_BEAT;
    if (engine) engine.playImmediateNote("piano", note);
    setRecordedNotes(notes => [
      ...notes,
      { id: uid(), note, start, duration }
    ]);
  };
  
  const removeNote = (e, noteId) => {
    // ... existing removeNote logic ...
    e.stopPropagation();
    if (isRecording) return;
    setRecordedNotes(notes => notes.filter(n => n.id !== noteId));
  };

  const save = () => {
    onSave({
      id: uid(),
      name: name.trim() || "Piano Pattern", // Ensure name isn't empty
      instrument: "piano",
      data: { type: "piano", notes: recordedNotes },
    });
  };

  return (
    // ... existing PianoSequencer JSX ...
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
        <div 
            className="relative bg-zinc-700 cursor-cell"
            style={{ 
                width: PIXELS_PER_BEAT * TOTAL_RECORDING_BEATS,
                height: PIANO_ROLL_NOTES.length * ROW_HEIGHT
            }}
            onClick={addNote}
        >
            {[...Array(TOTAL_RECORDING_BEATS)].map((_, beat) => (
                <div key={beat} className="absolute top-0 bottom-0 border-l border-zinc-600/50"
                    style={{ 
                      left: beat * PIXELS_PER_BEAT,
                      borderLeftWidth: beat % BEATS_PER_BAR === 0 ? '2px' : '1px'
                    }}
                />
            ))}
            {recordedNotes.map((note) => {
                const row = PIANO_ROLL_NOTES.findIndex(k => k.note === note.note);
                if (row === -1) return null;
                return (
                    <div
                        key={note.id}
                        className="absolute bg-amber-500/80 border border-amber-400 rounded-sm cursor-pointer hover:bg-amber-400"
                        style={{
                            top: row * ROW_HEIGHT + 1,
                            left: note.start * PIXELS_PER_BEAT,
                            width: Math.max(note.duration * PIXELS_PER_BEAT - 2, 5),
                            height: ROW_HEIGHT - 2
                        }}
                        onClick={(e) => removeNote(e, note.id)}
                    >
                        <span className="text-[10px] text-black/70 px-1 truncate pointer-events-none">{note.note}</span>
                    </div>
                )
            })}
            
            {isRecording && (
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                style={{ left: `${recordingProgress * 100}%` }}
              />
            )}
        </div>
      </div>

      <div className="flex justify-between items-end">
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
        
        <div className="flex items-center gap-4">
          <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-20 px-3 py-2 rounded-lg text-black font-medium ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-red-700'}`}
          >
              {isRecording ? "Stop" : "Record"}
          </button>
          <div className="text-sm opacity-70">
              {isRecording ? "Recording..." : "Click Record"}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main App Components ---

function LibraryPanel({ onSelectInstrument, patterns }) {
  // ... existing LibraryPanel JSX ...
  const instruments = [
    { id: "drums", name: "Drums", color: "bg-emerald-500" },
    { id: "bass", name: "Bass", color: "bg-fuchsia-500" },
    { id: "synth", name: "Synth", color: "bg-cyan-500" },
    { id: "piano", name: "Piano", color: "bg-amber-500" },
  ];
  
  const onDragStart = (e, pattern) => {
    e.dataTransfer.setData("application/json", JSON.stringify(pattern));
  };

  return (
    <div className="col-span-12 md:col-span-3 bg-zinc-900 p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-4">Library</h2>
      
      {instruments.map(inst => (
        <div key={inst.id} className="mb-4">
          <button 
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
        </div>
      ))}
    </div>
  );
}

function TimelinePanel({ 
  patterns, 
  clips, 
  setClips, 
  numBars, 
  playhead, 
  playing,
  selectedClipId, // NEW
  setSelectedClipId, // NEW
  onCopy, // NEW
  onCut, // NEW
  onPaste, // NEW
  onDelete // NEW
}) {
  const lanes = ["drums", "bass", "synth", "piano"];
  const timelineRef = useRef(null);
  const [dragError, setDragError] = useState(null);
  
  const totalWidth = numBars * PIXELS_PER_BAR;
  const playheadLeft = playhead * totalWidth;
  const hasSelection = selectedClipId !== null;

  useEffect(() => {
    // ... existing dragError useEffect ...
    if (dragError) {
      const timer = setTimeout(() => setDragError(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [dragError]);
  
  const onDrop = (e, lane) => {
    // ... existing onDrop logic ...
    e.preventDefault();
    setDragError(null);
    setSelectedClipId(null); // Deselect on drop
    if (!timelineRef.current) return;
    
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
    
    const newClip = {
      id: uid(),
      patternId: pattern.id,
      instrument: lane,
      startBar: clamp(startBar, 0, numBars - 1),
      bars: pattern.instrument === 'piano' ? PIANO_RECORDING_BARS : 1,
    };
    
    setClips(c => [...c, newClip]);
  };
  
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  
  return (
    <div 
      className="col-span-12 md:col-span-9 bg-zinc-900 p-4 rounded-lg relative"
      onClick={() => setSelectedClipId(null)} // NEW: Deselect on panel click
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Timeline</h2>
        {/* NEW: Edit Buttons */}
        <div className="flex gap-2">
          <button 
            onClick={(e) => { e.stopPropagation(); onCopy(); }} 
            disabled={!hasSelection}
            className="px-3 py-1 text-sm rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30"
          >Copy</button>
          <button 
            onClick={(e) => { e.stopPropagation(); onCut(); }}
            disabled={!hasSelection}
            className="px-3 py-1 text-sm rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30"
          >Cut</button>
          <button 
            onClick={(e) => { e.stopPropagation(); onPaste(); }}
            className="px-3 py-1 text-sm rounded bg-zinc-700 hover:bg-zinc-600"
          >Paste</button>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={!hasSelection}
            className="px-3 py-1 text-sm rounded bg-red-700 hover:bg-red-600 disabled:opacity-30"
          >Delete</button>
        </div>
      </div>

      {dragError && (
        // ... existing dragError JSX ...
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-red-600 text-white font-medium shadow-lg">
          {dragError}
        </div>
      )}
      
      {/* This is the scrolling container */}
      <div ref={timelineRef} className="w-full overflow-x-auto relative"
        style={{ width: '100%' }}
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
          {lanes.map((lane, i) => (
            <div
              key={lane}
              onDrop={(e) => onDrop(e, lane)}
              onDragOver={onDragOver}
              className="relative border-b border-zinc-700 bg-zinc-800/30 capitalize"
              style={{ height: 80 }}
            >
              <span className="absolute top-1 left-1 text-xs font-bold opacity-70 z-10">{lane}</span>
              
              {/* Render Clips */}
              {clips.filter(c => c.instrument === lane).map(clip => {
                const pattern = patterns.find(p => p.id === clip.patternId);
                let clipBars = clip.bars;
                if (pattern?.instrument === 'piano') {
                    clipBars = PIANO_RECORDING_BARS;
                }
                const isSelected = clip.id === selectedClipId; // NEW
                
                return (
                  <div
                    key={clip.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }} // NEW
                    className={`absolute top-6 bottom-2 rounded-lg bg-zinc-700 shadow p-2 cursor-grab active:cursor-grabbing overflow-hidden transition-all ${
                      isSelected ? 'ring-2 ring-lime-400 z-20' : 'border border-zinc-600 z-10'
                    }`} // NEW
                    style={{
                      left: clip.startBar * PIXELS_PER_BAR,
                      width: clipBars * PIXELS_PER_BAR,
                    }}
                  >
                    <span className="text-sm font-medium truncate pointer-events-none">
                      {pattern ? pattern.name : clip.patternId}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
          
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

// --- Main App ---

function LoopArranger() {
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [numBars, setNumBars] = useState(NUM_BARS_DEFAULT);
  const [isLooping, setIsLooping] = useState(true);
  const [view, setView] = useState({ type: "library" });
  const [patterns, setPatterns] = useState([]);
  const [clips, setClips] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0); // 0 to 1
  const playheadFrameRef = useRef(0);
  
  // NEW: State for clip editing
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [clipboard, setClipboard] = useState(null);

  // Keep refs to state for the audio engine
  const patternsRef = useRef(patterns);
  const clipsRef = useRef(clips);
  const numBarsRef = useRef(numBars);
  const isLoopingRef = useRef(isLooping);
  
  const onStopRef = useRef(() => {});
  const onStop = useCallback(() => {
    engine.stop();
    setPlaying(false);
    cancelAnimationFrame(playheadFrameRef.current);
  }, []); // engine is stable
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
    // ... existing animatePlayhead logic ...
    if (!engine.playing || !engine.ctx) {
      cancelAnimationFrame(playheadFrameRef.current);
      return;
    }
    const secPerBeat = 60 / engine.bpm;
    const currentBeat = engine.startBeat + (engine.ctx.currentTime - engine.startTime) / secPerBeat;
    const totalBeats = numBars * BEATS_PER_BAR;
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
  
  // NEW: Handle number input
  const handleBarInputChange = (e) => {
    if (playing) onStop();
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 5;
    val = clamp(val, 5, 100); // Clamp between 5 and 100
    setNumBars(val);
    setPlayhead(0);
  };

  // --- NEW: Clip Editing Handlers ---
  const onCopy = useCallback(() => {
    if (!selectedClipId) return;
    const clipToCopy = clips.find(c => c.id === selectedClipId);
    if (clipToCopy) {
      const { id, ...rest } = clipToCopy; // Copy everything except ID
      setClipboard(rest);
    }
  }, [selectedClipId, clips]);

  const onCut = useCallback(() => {
    if (!selectedClipId) return;
    onCopy();
    setClips(cs => cs.filter(c => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId, clips, onCopy]);
  
  const onDelete = useCallback(() => {
    if (!selectedClipId) return;
    setClips(cs => cs.filter(c => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId, clips]);

  const onPaste = useCallback(() => {
    if (!clipboard) return;
    
    // Paste at playhead position
    const newStartBar = Math.floor(playhead * numBars);
    
    const newClip = {
      ...clipboard,
      id: uid(),
      startBar: clamp(newStartBar, 0, numBars - 1),
    };

    setClips(c => [...c, newClip]);
  }, [clipboard, playhead, numBars]);

  // NEW: Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isModKey = e.metaKey || e.ctrlKey;

      if (isModKey && e.key === 'c') {
        e.preventDefault();
        onCopy();
      } else if (isModKey && e.key === 'x') {
        e.preventDefault();
        onCut();
      } else if (isModKey && e.key === 'v') {
        e.preventDefault();
        onPaste();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCopy, onCut, onPaste, onDelete]);


  // --- Sequencer Modal Handlers ---
  const onSavePattern = (pattern) => {
    setPatterns(p => [...p, pattern]);
    setView({ type: "library" });
  };
  
  const renderSequencer = () => {
    if (view.type !== "sequencer") return null;
    
    let sequencerComponent;
    if (view.instrument === "drums") {
      sequencerComponent = <DrumSequencer onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} />;
    } else if (view.instrument === "bass" || view.instrument === "synth") {
      sequencerComponent = <MelodySequencer instrument={view.instrument} onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} />;
    } else if (view.instrument === "piano") {
      sequencerComponent = <PianoSequencer onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} />;
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4 overflow-auto">
            {sequencerComponent}
        </div>
    );
  };
  

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-zinc-100 font-sans p-4">
      
      {renderSequencer()}
      
      <div className="max-w-7xl mx-auto">
        {/* Transport Header */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={playing ? onStop : onPlay}
            className="px-4 py-2 rounded-lg bg-lime-500 text-black font-medium shadow hover:shadow-lg hover:bg-lime-400 transition-all active:translate-y-px"
          >
            {playing ? "■ Stop" : "▶︎ Play"}
          </button>
          <button
            onClick={onToStart}
            className="px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-all active:translate-y-px"
          >
            ↺ To Beginning
          </button>
          
          <button
            onClick={() => setIsLooping(l => !l)}
            className={`px-4 py-2 rounded-lg border transition-all ${
              isLooping 
                ? 'bg-lime-900 border-lime-600 text-lime-300' 
                : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Toggle Loop"
          >
            Loop {isLooping ? 'On' : 'Off'}
          </button>

          <div className="ml-4 flex items-center gap-4">
            <span className="text-sm opacity-80">BPM: {bpm}</span>
            
            {/* NEW: Bar Count Input */}
            <div className="flex items-center gap-2">
              <label htmlFor="numBarsInput" className="text-sm opacity-80">Bars:</label>
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
            onSelectInstrument={(inst) => setView({ type: "sequencer", instrument: inst })}
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

// Utility
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
