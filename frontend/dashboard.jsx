// Import React for ES modules
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

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
const API_BASE =
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:1234'
    : '';

// ---------- Types ----------
/** @typedef {"drums" | "bass" | "synth" | "piano" | "transcribed" | "vocals"} InstrumentId */
/** @typedef {"kick" | "snare" | "hat" | "clap"} DrumSound */

/** @typedef {{type: "drums", grid: boolean[][]}} DrumPattern */ 
/** @typedef {{type: "melody", instrument: "bass" | "synth", grid: boolean[][]}} MelodyPattern */ 

/** @typedef {{id: string, note: number, start: number, duration: number}} MidiNote */
/** @typedef {{type: "piano", notes: MidiNote[]}} PianoPattern */
/** @typedef {{type: "transcribed", notes: MidiNote[], audioLengthBars: number, originalFileName: string}} TranscribedPattern */
/** @typedef {{type: "vocals", audioBuffer: AudioBuffer, lengthBars: number, originalFileName: string}} VocalPattern */

/** @typedef {DrumPattern | MelodyPattern | PianoPattern | TranscribedPattern | VocalPattern} PatternData */

/** @typedef {{id: string, name: string, instrument: InstrumentId, data: PatternData}} Pattern */

/** @typedef {{id: string, patternId: string, instrument: InstrumentId, startBar: number, bars: number}} TimelineClip */

/** @typedef {Omit<TimelineClip, 'id'>} ClipboardClip */

/** @typedef {{ type: "library" } | { type: "sequencer", instrument: Exclude<InstrumentId, "transcribed" | "vocals"> } | { type: "transcribe" } | { type: "record_vocals" } | { type: "edit", patternId: string }} View */

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
  instrumentParamsRef;
  metronomeOnRef;
  vocalsMap;

  /**
   * @param {React.MutableRefObject<Pattern[]>} patternsRef
   * @param {React.MutableRefObject<TimelineClip[]>} clipsRef
   * @param {React.MutableRefObject<number>} numBarsRef
   * @param {React.MutableRefObject<boolean>} isLoopingRef
   * @param {React.MutableRefObject<() => void>} onStopRef
   * @param {React.MutableRefObject<Object>} instrumentParamsRef
   * @param {React.MutableRefObject<boolean>} metronomeOnRef
   */
  constructor(patternsRef, clipsRef, numBarsRef, isLoopingRef, onStopRef, instrumentParamsRef, metronomeOnRef) {
    this.patternsRef = patternsRef;
    this.clipsRef = clipsRef;
    this.numBarsRef = numBarsRef;
    this.isLoopingRef = isLoopingRef;
    this.onStopRef = onStopRef;
    this.instrumentParamsRef = instrumentParamsRef;
    this.metronomeOnRef = metronomeOnRef;
    this.vocalsMap = new Map(); // Store vocal audio buffers
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
    const params = this.instrumentParamsRef?.current?.drums || { volume: 0.8, pan: 0 };

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.1); // Ramp to 50Hz instead of 0.01Hz
    gain.gain.setValueAtTime(params.volume || 0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    panner.pan.value = params.pan || 0;

    osc.connect(gain).connect(panner).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  playSnare(time) {
    if (!this.ctx) return;
    const params = this.instrumentParamsRef?.current?.drums || { volume: 0.8, pan: 0 };

    const noise = this.ctx.createBufferSource();
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    gain.gain.setValueAtTime(params.volume, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
    panner.pan.value = params.pan;

    noise.connect(gain).connect(panner).connect(this.ctx.destination);
    noise.start(time);
  }

  playHat(time) {
    if (!this.ctx) return;
    const params = this.instrumentParamsRef?.current?.drums || { volume: 0.8, pan: 0 };

    const noise = this.ctx.createBufferSource();
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    const hpf = this.ctx.createBiquadFilter();

    gain.gain.setValueAtTime(0.3 * params.volume, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.04);
    panner.pan.value = params.pan;
    hpf.type = "highpass";
    hpf.frequency.value = 5000;

    noise.connect(hpf).connect(gain).connect(panner).connect(this.ctx.destination);
    noise.start(time);
  }

  /**
   * Play vocal audio from a pattern
   * @param {string} patternId - The pattern ID containing the vocal audio
   * @param {number} time - When to play the audio
   * @param {number} offset - Offset in bars from clip start
   */
  playVocal(patternId, time, offset) {
    if (!this.ctx) return;
    const buffer = this.vocalsMap.get(patternId);
    if (!buffer) return;

    const params = this.instrumentParamsRef?.current?.vocals || { volume: 0.8, pan: 0 };

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    source.buffer = buffer;
    
    // Calculate offset time in seconds
    const offsetTime = (offset * BEATS_PER_BAR) * this.beatsToSec(1);
    
    gain.gain.setValueAtTime(params.volume || 0.8, time);
    panner.pan.value = params.pan || 0;

    source.connect(gain).connect(panner).connect(this.ctx.destination);
    
    // Start playing from the offset
    source.start(time, Math.max(0, offsetTime));
  }

  playClap(time) {
    this.playSnare(time); // Use snare as a proxy for clap
  }

  /**
   * Play a metronome click sound
   * @param {number} time - when to play the click
   * @param {boolean} isDownbeat - whether this is beat 1 (louder click)
   */
  playMetronomeClick(time, isDownbeat) {
    if (!this.ctx) return;
    
    // Create a short click sound
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // Higher frequency for accent on downbeat
    const freq = isDownbeat ? 800 : 600;
    osc.frequency.setValueAtTime(freq, time);
    
    // Louder volume for downbeat
    const volume = isDownbeat ? 0.15 : 0.08;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  /**
   * @param {number} time
   * @param {number} freq
   * @param {number} duration
   * @param {"bass" | "synth" | "piano" | "transcribed"} instrument
   */
  playNote(time, freq, duration, instrument) {
    if (!this.ctx) return;
    const params = this.instrumentParamsRef?.current?.[instrument] || {
      volume: 0.8, pan: 0, pitch: 0,
      filterType: 'none', filterCutoff: 1000, filterResonance: 1,
      attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3
    };

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    let baseVolume = 0.5;

    if (instrument === "bass") {
      osc.type = "sawtooth";
      baseVolume = 0.5;
    } else if (instrument === "synth") {
      osc.type = "square";
      baseVolume = 0.3;
    } else if (instrument === "piano") {
      osc.type = "triangle";
      baseVolume = 0.4;
    } else if (instrument === "transcribed") {
      osc.type = "sine";
      baseVolume = 0.5;
    }

    // Apply ADSR envelope
    const attack = params.attack || 0.01;
    const decay = params.decay || 0.1;
    const sustain = params.sustain || 0.7;
    const release = params.release || 0.3;

    const peakVolume = baseVolume * (params.volume || 0.8);
    const sustainVolume = Math.max(0.001, peakVolume * sustain); // Ensure sustain isn't too low for exponential ramp

    // Attack phase
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peakVolume), time + attack);

    // Decay phase to sustain level
    if (sustainVolume < peakVolume) {
      gain.gain.exponentialRampToValueAtTime(sustainVolume, time + attack + decay);
    }

    // Sustain phase (held at sustainVolume until note off)
    const noteOffTime = time + duration;

    // Release phase
    gain.gain.exponentialRampToValueAtTime(0.001, noteOffTime + release);

    // Apply pitch shift (semitones to frequency multiplier)
    const pitchMultiplier = Math.pow(2, (params.pitch || 0) / 12);
    const adjustedFreq = freq * pitchMultiplier;

    // Apply pan
    panner.pan.value = params.pan || 0;

    osc.frequency.setValueAtTime(adjustedFreq, time);

    // Apply filter if enabled
    let audioChain = osc;
    if (params.filterType && params.filterType !== 'none') {
      const filter = this.ctx.createBiquadFilter();
      filter.type = params.filterType;
      filter.frequency.value = params.filterCutoff || 1000;
      filter.Q.value = params.filterResonance || 1;
      audioChain.connect(filter);
      audioChain = filter;
    }

    // Connect audio chain: osc -> [filter] -> gain -> panner -> destination
    audioChain.connect(gain).connect(panner).connect(this.ctx.destination);

    osc.start(time);
    osc.stop(noteOffTime + release);
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
    
    // Play metronome if enabled
    if (this.metronomeOnRef?.current) {
      // Check if this is on a beat (every 4 steps)
      if (step % 4 === 0) {
        // Check if this is beat 1 (every 16 steps)
        const isDownbeat = step % 16 === 0;
        this.playMetronomeClick(time, isDownbeat);
      }
    }
    
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

      // Handle Drum patterns
      if (patternData.type === "drums") {
        const patternGrid = patternData.grid;
        const patternLength = patternGrid[0]?.length || STEPS_PER_BAR;
        
        // Calculate relative step within the pattern
        const clipStartSteps = clip.startBar * STEPS_PER_BAR;
        const relativeStep = step - clipStartSteps;
        const stepInPattern = ((relativeStep % patternLength) + patternLength) % patternLength;
        
        for (let row = 0; row < patternGrid.length; row++) {
          if (patternGrid[row] && patternGrid[row][stepInPattern]) {
            const drumSounds = ["clap", "hat", "snare", "kick"];
            if (row < drumSounds.length) {
              if (drumSounds[row] === "kick") this.playKick(time);
              if (drumSounds[row] === "snare") this.playSnare(time);
              if (drumSounds[row] === "hat") this.playHat(time);
              if (drumSounds[row] === "clap") this.playClap(time);
            }
          }
        }
      }
      
      // Handle Melody patterns (Bass and Synth)
      if (patternData.type === "melody") {
        const patternGrid = patternData.grid;
        const patternLength = patternGrid[0]?.length || STEPS_PER_BAR;
        const noteMap = MELODY_NOTE_MAP;
        
        // Calculate relative step within the pattern
        const clipStartSteps = clip.startBar * STEPS_PER_BAR;
        const relativeStep = step - clipStartSteps;
        const stepInPattern = ((relativeStep % patternLength) + patternLength) % patternLength;
        
        for (let row = 0; row < patternGrid.length; row++) {
          if (patternGrid[row] && patternGrid[row][stepInPattern]) {
            if (row < noteMap.length) {
              const midiNote = noteMap[row];
              const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
              this.playNote(time, freq, this.beatsToSec(1 / STEPS_PER_BEAT), patternData.instrument);
            }
          }
        }
      }
      
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

      // Handle Vocal patterns
      if (patternData.type === "vocals") {
        // Play vocal audio if we're at the start of the clip
        if (currentBar === clip.startBar) {
          const currentBeatInPattern = currentBeatInProject - clip.startBar * BEATS_PER_BAR;
          // Only play at the start of the clip (beat 0)
          if (Math.floor(currentBeatInPattern) === 0 && (currentBeatInPattern % 1) < (1 / STEPS_PER_BEAT)) {
            // @ts-ignore
            const lengthBars = patternData.lengthBars;
            const offsetBars = 0; // Start from beginning
            this.playVocal(clip.patternId, time, offsetBars);
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

// ---------- Mock Transcription Modal ----------

/**
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void }} props 
 */
function AudioTranscriber({ onSave, onExit }) {
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Real transcription using the backend API
   * @param {File} file - The audio file to transcribe
   */
  const realTranscription = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    // Add default transcription parameters
    formData.append('onset_threshold', '0.5');
    formData.append('frame_threshold', '0.3');
    formData.append('min_note_len', '0.127');
    formData.append('melodia_trick', 'true');

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Transcription failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!data.notes || !Array.isArray(data.notes)) {
      throw new Error('Invalid transcription response format');
    }

    // Convert backend format to DAW format
    const beatsPerBar = BEATS_PER_BAR;
    const bpm = DEFAULT_BPM;
    const secondsPerBeat = 60 / bpm;
    const secondsPerBar = secondsPerBeat * beatsPerBar;

    // Calculate total length in bars from the last note
    let maxTime = 0;
    data.notes.forEach(note => {
      const endTime = note.start + note.duration;
      if (endTime > maxTime) {
        maxTime = endTime;
      }
    });

    let audioLengthBars = Math.ceil(maxTime / secondsPerBar);

    // Clamp to maxBars
    if (audioLengthBars > MAX_TRANSCRIPTION_BARS) {
      audioLengthBars = MAX_TRANSCRIPTION_BARS;
    }

    // Ensure at least 1 bar
    if (audioLengthBars < 1) {
      audioLengthBars = 1;
    }

    // Convert notes from seconds to beats
    const maxBeats = MAX_TRANSCRIPTION_BARS * beatsPerBar;
    const formattedNotes = data.notes.map((note, index) => {
      // Convert time from seconds to beats
      const startInBeats = note.start / secondsPerBeat;
      const durationInBeats = note.duration / secondsPerBeat;

      // Filter out notes beyond maxBars
      if (startInBeats >= maxBeats) {
        return null;
      }

      return {
        id: uid(),
        note: note.pitch,
        start: parseFloat(startInBeats.toFixed(4)),
        duration: parseFloat(Math.min(durationInBeats, maxBeats - startInBeats).toFixed(4))
      };
    }).filter(note => note !== null);

    return {
      notes: formattedNotes,
      audioLengthBars,
      originalFileName: file.name,
    };
  };

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
      const transcriptionData = await realTranscription(file);

      /** @type {Pattern} */
      const newPattern = {
        id: uid(),
        name: `Transcribed: ${file.name.substring(0, 20)}...`,
        instrument: "transcribed",
        // @ts-ignore
        data: {
          type: "transcribed",
          notes: transcriptionData.notes,
          audioLengthBars: transcriptionData.audioLengthBars,
          originalFileName: transcriptionData.originalFileName,
        },
      };

      onSave(newPattern);
      // The modal will close via the onSave handler in the parent
    } catch (e) {
      console.error("Transcription failed:", e);
      setError(e.message || "An error occurred during transcription.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-zinc-800 rounded-xl shadow-2xl w-full max-w-lg text-white">
      <h2 className="text-2xl font-bold mb-4 text-lime-400">Audio Transcription</h2>
      <p className="mb-4 text-sm opacity-70">
        Upload an audio file (MP3, WAV, etc.) to convert its main melody into a non-editable timeline clip using a simulated transcription engine (Basic Pitch).
      </p>

      <div className="mb-4">
        <label htmlFor="audio-file" className="block text-sm font-medium mb-2">Select Audio File:</label>
        <input
          id="audio-file"
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-700 file:text-lime-300 hover:file:bg-zinc-600"
        />
        {file && (
            <p className="mt-2 text-lime-500 text-sm">Selected: {file.name} (Ready to transcribe)</p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 p-2 rounded text-sm mb-4">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
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
          className="px-4 py-2 bg-lime-500 text-black font-semibold rounded-lg hover:bg-lime-400 transition disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Transcribing...
            </span>
          ) : 'Transcribe & Add'}
        </button>
      </div>
    </div>
  );
}

// ---------- Vocal Recorder Component ----------

/**
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine }} props 
 */
function VocalRecorder({ onSave, onExit, engine }) {
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [audioSrc, setAudioSrc] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioSrc(url);
        
        // Convert blob to File
        const audioFile = new File([blob], 'recording.webm', { type: 'audio/webm' });
        setFile(audioFile);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setError(null);
    } catch (err) {
      setError("Failed to access microphone. Please check permissions.");
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Please upload or record an audio file first.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Load audio file as buffer
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
      
      // Calculate length in bars
      const durationSeconds = audioBuffer.duration;
      const secondsPerBar = BEATS_PER_BAR * (60 / DEFAULT_BPM);
      const lengthBars = Math.ceil(durationSeconds / secondsPerBar);
      
      // Store in vocals map
      engine.vocalsMap.set(uid(), audioBuffer);

      /** @type {Pattern} */
      const newPattern = {
        id: uid(),
        name: `Vocal: ${file.name.substring(0, 20)}`,
        instrument: "vocals",
        // @ts-ignore
        data: {
          type: "vocals",
          audioBuffer: audioBuffer,
          lengthBars: lengthBars,
          originalFileName: file.name,
        },
      };

      // Store pattern ID in vocals map for playback
      engine.vocalsMap.set(newPattern.id, audioBuffer);

      onSave(newPattern);
    } catch (e) {
      console.error("Vocal processing failed:", e);
      setError(e.message || "An error occurred while processing the audio.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-zinc-800 rounded-xl shadow-2xl w-full max-w-lg text-white">
      <h2 className="text-2xl font-bold mb-4 text-pink-400">🎤 Vocal Recording</h2>
      <p className="mb-4 text-sm opacity-70">
        Record your voice using the microphone or upload an audio file. The recording will be placed on the vocals lane.
      </p>

      {/* Recording Controls */}
      <div className="mb-4 p-4 bg-zinc-700/50 rounded-lg">
        <div className="flex items-center gap-4">
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              recording 
                ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                : 'bg-pink-500 hover:bg-pink-600'
            }`}
            disabled={isLoading}
          >
            {recording ? '⏹ Stop Recording' : '🎤 Start Recording'}
          </button>
          <div className="text-sm opacity-70">
            {recording ? "Recording..." : audioSrc ? "Recording saved" : "Click to record"}
          </div>
        </div>
        {audioSrc && (
          <audio src={audioSrc} controls className="mt-3 w-full" />
        )}
      </div>

      {/* File Upload */}
      <div className="mb-4">
        <label htmlFor="vocal-file" className="block text-sm font-medium mb-2">Or Upload Audio File:</label>
        <input
          id="vocal-file"
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-700 file:text-pink-300 hover:file:bg-zinc-600"
        />
        {file && (
          <p className="mt-2 text-pink-500 text-sm">Selected: {file.name}</p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 p-2 rounded text-sm mb-4">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
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
          className="px-4 py-2 bg-pink-500 text-white font-semibold rounded-lg hover:bg-pink-400 transition disabled:opacity-50"
        >
          {isLoading ? "Processing..." : "Add to Timeline"}
        </button>
      </div>
    </div>
  );
}

// --- Sequencers (Unchanged except for Piano's save payload) ---
// ... (DrumSequencer, MelodySequencer are kept as is) ...

/**
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine | null, patterns: Pattern[], initialPattern?: Pattern }} props 
 */
function DrumSequencer({ onSave, onExit, engine, patterns, initialPattern }) {
  const [grid, setGrid] = useState(() => 
    initialPattern?.data?.type === 'drums' ? initialPattern.data.grid : createEmptyGrid(4)
  );
  const [name, setName] = useState(initialPattern?.name || 
    `Drum Pattern ${patterns.filter(p => p.instrument === "drums").length + 1}`
  );
  const [patternSteps, setPatternSteps] = useState(() => {
    if (initialPattern?.data?.type === 'drums') {
      return initialPattern.data.grid[0]?.length || STEPS_PER_BAR;
    }
    return STEPS_PER_BAR;
  });
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

  const clearPattern = () => {
    setGrid(createEmptyGrid(4));
  };

  const adjustPatternLength = (newSteps) => {
    const clamped = Math.max(8, Math.min(64, newSteps)); // 8-64 steps
    setPatternSteps(clamped);
    setGrid(g => {
      return g.map(row => {
        const newRow = Array(clamped).fill(false);
        for (let i = 0; i < Math.min(row.length, clamped); i++) {
          newRow[i] = row[i];
        }
        return newRow;
      });
    });
  };

  const save = () => {
    onSave({
      id: initialPattern?.id || uid(),
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
        <div className="flex gap-2">
          <button onClick={save} className="px-3 py-1 bg-lime-500 text-black rounded-lg">Save</button>
          <button onClick={onExit} className="px-3 py-1 bg-zinc-600 rounded-lg">Close</button>
        </div>
      </div>

      {/* Pattern Tools */}
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-700">
        <button onClick={clearPattern} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm">
          Clear
        </button>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Steps:</label>
          <select
            value={patternSteps}
            onChange={(e) => adjustPatternLength(parseInt(e.target.value))}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm"
          >
            <option value={8}>8 (1/2 bar)</option>
            <option value={16}>16 (1 bar)</option>
            <option value={32}>32 (2 bars)</option>
            <option value={64}>64 (4 bars)</option>
          </select>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="flex flex-col gap-px" style={{ width: patternSteps * 32 }}>
          {[...Array(4)].map((_, r) => (
            <div key={r} className="flex items-center gap-px">
              <div className="w-24 h-10 flex items-center justify-end text-sm pr-2 opacity-70 sticky left-0 bg-zinc-800">
                {DRUM_NAMES[r]}
              </div>
              {[...Array(patternSteps)].map((_, s) => (
                <div
                  key={`${r}-${s}`}
                  onClick={() => toggle(r, s)}
                  className={`w-8 h-10 rounded-sm cursor-pointer ${
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
 * @param {{ instrument: "bass" | "synth", onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine | null, patterns: Pattern[], initialPattern?: Pattern }} props 
 */
function MelodySequencer({ instrument, onSave, onExit, engine, patterns, initialPattern }) {
  const [grid, setGrid] = useState(() => 
    initialPattern?.data?.type === 'melody' ? initialPattern.data.grid : createEmptyGrid(6)
  );
  const [name, setName] = useState(initialPattern?.name || 
    `${instrument === 'bass' ? 'Bass' : 'Synth'} Pattern ${patterns.filter(p => p.instrument === instrument).length + 1}`
  );
  const [patternSteps, setPatternSteps] = useState(() => {
    if (initialPattern?.data?.type === 'melody') {
      return initialPattern.data.grid[0]?.length || STEPS_PER_BAR;
    }
    return STEPS_PER_BAR;
  });
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

  const clearPattern = () => {
    setGrid(createEmptyGrid(6));
  };

  const adjustPatternLength = (newSteps) => {
    const clamped = Math.max(8, Math.min(64, newSteps)); // 8-64 steps
    setPatternSteps(clamped);
    setGrid(g => {
      return g.map(row => {
        const newRow = Array(clamped).fill(false);
        for (let i = 0; i < Math.min(row.length, clamped); i++) {
          newRow[i] = row[i];
        }
        return newRow;
      });
    });
  };

  const save = () => {
    onSave({
      id: initialPattern?.id || uid(),
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
        <div className="flex gap-2">
          <button onClick={save} className="px-3 py-1 bg-lime-500 text-black rounded-lg">Save</button>
          <button onClick={onExit} className="px-3 py-1 bg-zinc-600 rounded-lg">Close</button>
        </div>
      </div>

      {/* Pattern Tools */}
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-700">
        <button onClick={clearPattern} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm">
          Clear
        </button>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Steps:</label>
          <select
            value={patternSteps}
            onChange={(e) => adjustPatternLength(parseInt(e.target.value))}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm"
          >
            <option value={8}>8 (1/2 bar)</option>
            <option value={16}>16 (1 bar)</option>
            <option value={32}>32 (2 bars)</option>
            <option value={64}>64 (4 bars)</option>
          </select>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="flex flex-col gap-px" style={{ width: patternSteps * 32 }}>
          {MELODY_ROLL_NOTES.map((note, noteIdx) => {
            const isClickable = note.type === 'white';
            const gridRow = note.gridRow;

            return (
              <div key={note.name} className="flex items-center gap-px" style={{ opacity: isClickable ? 1 : 0.5 }}>
                <div
                    className={`w-16 h-8 flex items-center justify-end text-sm pr-2 sticky left-0 ${
                        note.type === 'white' ? 'bg-zinc-600 text-white' : 'bg-zinc-700 text-zinc-400'
                    }`}
                >
                  {note.name}
                </div>
                {[...Array(patternSteps)].map((_, s) => {
                  const isActive = isClickable && gridRow !== null && grid[gridRow][s];
                  return (
                    <div
                      key={`${noteIdx}-${s}`}
                      onClick={() => isClickable && gridRow !== null && toggle(gridRow, s)}
                      className={`w-8 h-8 rounded-sm ${
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
 * @param {{ onSave: (p: Pattern) => void, onExit: () => void, engine: AudioEngine | null, patterns: Pattern[], initialPattern?: Pattern }} props 
 */
function PianoSequencer({ onSave, onExit, engine, patterns, initialPattern }) {
  const [name, setName] = useState(initialPattern?.name || 
    `Piano Pattern ${patterns.filter(p => p.instrument === "piano").length + 1}`
  );
  const [isRecording, setIsRecording] = useState(false);
  /** @type {[MidiNote[], React.Dispatch<React.SetStateAction<MidiNote[]>>]} */
  const [recordedNotes, setRecordedNotes] = useState(() => 
    initialPattern?.data?.type === 'piano' ? initialPattern.data.notes : []
  );
  const [recordingBars, setRecordingBars] = useState(PIANO_RECORDING_BARS); // Default to 4 bars
  const recordingStartTime = useRef(0);
  /** @type {React.MutableRefObject<Map<number, number>>} */
  const notesDown = useRef(new Map());
  const [recordingProgress, setRecordingProgress] = useState(0);
  const animFrameRef = useRef(0);

  const PIXELS_PER_BEAT = 84;
  const ROW_HEIGHT = 26;
  const TOTAL_RECORDING_BEATS = BEATS_PER_BAR * recordingBars;
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

  const clearPattern = () => {
    setRecordedNotes([]);
    if (isRecording) {
      setIsRecording(false);
      notesDown.current.clear();
    }
  };

  const save = () => {
    onSave({
      id: initialPattern?.id || uid(),
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
        <div className="flex gap-2">
          <button onClick={save} className="px-3 py-1 bg-lime-500 text-black rounded-lg">Save</button>
          <button onClick={onExit} className="px-3 py-1 bg-zinc-600 rounded-lg">Close</button>
        </div>
      </div>

      {/* Pattern Tools */}
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-700">
        <button onClick={clearPattern} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm">
          Clear
        </button>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Pattern Length:</label>
          <select
            value={recordingBars}
            onChange={(e) => setRecordingBars(parseInt(e.target.value))}
            disabled={isRecording}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
            <option value={4}>4 bars</option>
            <option value={8}>8 bars</option>
          </select>
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
 * @param {{ onSelectInstrument: (inst: InstrumentId) => void, patterns: Pattern[], onSelectTranscribe: () => void, onSelectRecordVocals: () => void, instrumentParams: any, setInstrumentParams: any }} props
 */
function LibraryPanel({ onSelectInstrument, patterns, onSelectTranscribe, onSelectRecordVocals, instrumentParams, setInstrumentParams }) {
  const [expandedInstrument, setExpandedInstrument] = useState(null);

  const instruments = [
    { id: "drums", name: "Drums", color: "bg-emerald-500" },
    { id: "bass", name: "Bass", color: "bg-fuchsia-500" },
    { id: "synth", name: "Synth", color: "bg-cyan-500" },
    { id: "piano", name: "Piano", color: "bg-amber-500" },
    { id: "vocals", name: "Vocals", color: "bg-pink-500" },
    { id: "transcribed", name: "Transcribed Audio", color: "bg-purple-500" },
  ];

  /**
   * @param {React.DragEvent} e
   * @param {Pattern} pattern
   */
  const onDragStart = (e, pattern) => {
    e.dataTransfer.setData("application/json", JSON.stringify(pattern));
  };

  const updateParam = (instId, param, value) => {
    setInstrumentParams(prev => ({
      ...prev,
      [instId]: { ...prev[instId], [param]: value }
    }));
  };

  return (
    <div className="col-span-12 md:col-span-3 bg-zinc-900 p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-4">Library</h2>
      
      {instruments.filter(i => i.id !== 'transcribed' && i.id !== 'vocals').map(inst => {
        const isExpanded = expandedInstrument === inst.id;
        const params = instrumentParams[inst.id] || {};

        return (
          <div key={inst.id} className="mb-4">
            <button
              // @ts-ignore
              onClick={() => onSelectInstrument(inst.id)}
              className={`w-full px-4 py-3 rounded-lg font-medium text-left ${inst.color} text-black shadow-lg hover:opacity-90 transition-all`}
            >
              + Create {inst.name}
            </button>

            {/* Instrument Controls Toggle */}
            <button
              onClick={() => setExpandedInstrument(isExpanded ? null : inst.id)}
              className="w-full px-3 py-2 mt-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-left flex items-center justify-between transition"
            >
              <span>⚙️ Controls</span>
              <span>{isExpanded ? '▼' : '▶'}</span>
            </button>

            {/* Expandable Controls Panel */}
            {isExpanded && (
              <div className="mt-2 p-3 bg-zinc-800/50 rounded-lg space-y-3 border border-zinc-700">
                {/* Volume */}
                <div>
                  <label className="text-xs opacity-70">Volume: {Math.round((params.volume || 0.8) * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={params.volume || 0.8}
                    onChange={(e) => updateParam(inst.id, 'volume', parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-lime-500"
                  />
                </div>

                {/* Pan */}
                <div>
                  <label className="text-xs opacity-70">Pan: {params.pan === 0 ? 'C' : params.pan > 0 ? `R${Math.round((params.pan || 0) * 100)}` : `L${Math.round(Math.abs(params.pan || 0) * 100)}`}</label>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.01"
                    value={params.pan || 0}
                    onChange={(e) => updateParam(inst.id, 'pan', parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-lime-500"
                  />
                </div>

                {/* Pitch */}
                <div>
                  <label className="text-xs opacity-70">Pitch: {(params.pitch || 0) > 0 ? '+' : ''}{params.pitch || 0} semitones</label>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={params.pitch || 0}
                    onChange={(e) => updateParam(inst.id, 'pitch', parseInt(e.target.value))}
                    className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-lime-500"
                  />
                </div>

                {/* Filter Controls (for melodic instruments) */}
                {inst.id !== 'drums' && (
                  <>
                    <div className="pt-2 border-t border-zinc-700">
                      <label className="text-xs opacity-70">Filter Type</label>
                      <select
                        value={params.filterType || 'none'}
                        onChange={(e) => updateParam(inst.id, 'filterType', e.target.value)}
                        className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs mt-1"
                      >
                        <option value="none">None</option>
                        <option value="lowpass">Low Pass</option>
                        <option value="highpass">High Pass</option>
                      </select>
                    </div>

                    {params.filterType !== 'none' && (
                      <>
                        <div>
                          <label className="text-xs opacity-70">Filter Cutoff: {Math.round(params.filterCutoff || 1000)} Hz</label>
                          <input
                            type="range"
                            min="100"
                            max="5000"
                            step="50"
                            value={params.filterCutoff || 1000}
                            onChange={(e) => updateParam(inst.id, 'filterCutoff', parseInt(e.target.value))}
                            className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                          />
                        </div>

                        <div>
                          <label className="text-xs opacity-70">Resonance: {(params.filterResonance || 1).toFixed(1)}</label>
                          <input
                            type="range"
                            min="0.1"
                            max="10"
                            step="0.1"
                            value={params.filterResonance || 1}
                            onChange={(e) => updateParam(inst.id, 'filterResonance', parseFloat(e.target.value))}
                            className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ADSR Envelope (for melodic instruments) */}
                {inst.id !== 'drums' && (
                  <>
                    <div className="pt-2 border-t border-zinc-700">
                      <label className="text-xs opacity-70 font-semibold">ADSR Envelope</label>
                    </div>

                    <div>
                      <label className="text-xs opacity-70">Attack: {((params.attack || 0.01) * 1000).toFixed(0)}ms</label>
                      <input
                        type="range"
                        min="0.001"
                        max="1"
                        step="0.01"
                        value={params.attack || 0.01}
                        onChange={(e) => updateParam(inst.id, 'attack', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs opacity-70">Decay: {((params.decay || 0.1) * 1000).toFixed(0)}ms</label>
                      <input
                        type="range"
                        min="0.01"
                        max="2"
                        step="0.01"
                        value={params.decay || 0.1}
                        onChange={(e) => updateParam(inst.id, 'decay', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs opacity-70">Sustain: {Math.round((params.sustain || 0.7) * 100)}%</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={params.sustain || 0.7}
                        onChange={(e) => updateParam(inst.id, 'sustain', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs opacity-70">Release: {((params.release || 0.3) * 1000).toFixed(0)}ms</label>
                      <input
                        type="range"
                        min="0.01"
                        max="3"
                        step="0.01"
                        value={params.release || 0.3}
                        onChange={(e) => updateParam(inst.id, 'release', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

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
        );
      })}
      
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

      {/* Vocals Section */}
      <div className="mb-4 border-t border-zinc-800 pt-4">
        <h3 className="text-lg font-medium text-pink-400 mb-2">Vocals</h3>
        <button
          onClick={onSelectRecordVocals}
          className="w-full px-4 py-3 rounded-lg font-medium text-left bg-pink-500 text-white shadow-lg hover:bg-pink-600 transition-all mb-3"
        >
          🎤 Record or Upload Vocals
        </button>
        <div className="mt-2 space-y-1">
            {patterns.filter(p => p.instrument === 'vocals').map(p => (
                <div
                key={p.id}
                draggable
                onDragStart={(e) => onDragStart(e, p)}
                className={`w-full px-3 py-2 rounded bg-zinc-800 border border-pink-700 cursor-grab active:cursor-grabbing text-sm hover:bg-zinc-700 text-pink-200`}
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
 * onDelete: () => void,
 * onEditClip: (clipId: string) => void
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
  onDelete,
  onEditClip
}) {
  /** @type {InstrumentId[]} */
  const lanes = ["drums", "bass", "synth", "piano", "vocals", "transcribed"];
  const timelineRef = useRef(null);
  const [dragError, setDragError] = useState(null);
  const [resizingClipId, setResizingClipId] = useState(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartBars, setResizeStartBars] = useState(0);
  
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
    } else if (pattern.instrument === 'vocals') {
        // @ts-ignore
        clipBars = pattern.data.lengthBars;
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
  
  /**
   * Handle start of resize drag
   * @param {React.MouseEvent} e 
   * @param {TimelineClip} clip 
   */
  const onResizeStart = (e, clip) => {
    e.stopPropagation();
    setResizingClipId(clip.id);
    setResizeStartX(e.clientX);
    setResizeStartBars(clip.bars);
    setSelectedClipId(clip.id);
  };
  
  /**
   * Handle mouse move during resize
   * @param {MouseEvent} e 
   */
  const onMouseMove = useCallback((e) => {
    if (!resizingClipId || !timelineRef.current) return;
    
    const deltaX = e.clientX - resizeStartX;
    const deltaBars = Math.round(deltaX / PIXELS_PER_BAR);
    const newBars = Math.max(1, resizeStartBars + deltaBars);
    
    setClips(currentClips => {
      const clip = currentClips.find(c => c.id === resizingClipId);
      if (!clip) return currentClips;
      
      // Calculate max bars without going beyond timeline
      const maxBars = numBars - clip.startBar;
      const clampedBars = Math.min(newBars, maxBars);
      
      return currentClips.map(c => 
        c.id === resizingClipId ? { ...c, bars: clampedBars } : c
      );
    });
  }, [resizingClipId, resizeStartX, resizeStartBars, numBars]);
  
  /**
   * Handle end of resize drag
   */
  const onMouseUp = useCallback(() => {
    setResizingClipId(null);
  }, []);
  
  // Add global mouse handlers when resizing
  useEffect(() => {
    if (resizingClipId) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      return () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    }
  }, [resizingClipId, onMouseMove, onMouseUp]);
  
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
            if (lane === 'vocals') colorClass = 'bg-pink-600/80';
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
                    const isResizing = clip.id === resizingClipId;
                    
                    return (
                    <div
                        key={clip.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                        onDoubleClick={(e) => { e.stopPropagation(); onEditClip(clip.patternId); }} 
                        className={`absolute top-6 bottom-2 rounded-lg shadow p-2 ${isResizing ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'} overflow-visible transition-all ${
                            clip.instrument === 'drums' ? 'bg-emerald-600/80' : 
                            clip.instrument === 'bass' ? 'bg-fuchsia-600/80' : 
                            clip.instrument === 'synth' ? 'bg-cyan-600/80' : 
                            clip.instrument === 'piano' ? 'bg-amber-600/80' : 
                            clip.instrument === 'vocals' ? 'bg-pink-600/80' : 
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
                        
                        {/* Resize handle */}
                        <div
                          onMouseDown={(e) => onResizeStart(e, clip)}
                          className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 transition-colors ${
                            isSelected ? 'block' : 'hidden'
                          }`}
                          style={{ cursor: 'ew-resize' }}
                          title="Drag to resize"
                        />
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

function Modal({ onExit, children }) {
  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onExit}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ShareModal({ onExit, projectId }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!email || !projectId) {
      setError('Email and project ID are required.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const token = localStorage.getItem('idToken');
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email, role })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to invite user.');
      }

      setSuccess(`Successfully invited ${email} as ${role}.`);
      setEmail('');
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-zinc-800 rounded-xl shadow-2xl w-full max-w-lg text-white">
      <h2 className="text-2xl font-bold mb-4 text-blue-400">Share Project</h2>
      <form onSubmit={handleInvite}>
        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium mb-2">User's Email:</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full text-sm text-zinc-300 bg-zinc-700 rounded-lg px-3 py-2"
            required
          />
        </div>
        <div className="mb-4">
          <label htmlFor="role" className="block text-sm font-medium mb-2">Role:</label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full text-sm text-zinc-300 bg-zinc-700 rounded-lg px-3 py-2"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        {error && (
          <div className="bg-red-900/50 border border-red-500 p-2 rounded text-sm mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900/50 border border-green-500 p-2 rounded text-sm mb-4">
            {success}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onExit}
            className="px-4 py-2 bg-zinc-600 rounded-lg hover:bg-zinc-700 transition"
            disabled={isLoading}
          >
            Close
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-400 transition disabled:opacity-50"
          >
            {isLoading ? 'Sending...' : 'Send Invite'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LoopArranger() {
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [collabStatus, setCollabStatus] = useState('disconnected');
  const [numBars, setNumBars] = useState(NUM_BARS_DEFAULT);
  const [isLooping, setIsLooping] = useState(true);
  const [metronomeOn, setMetronomeOn] = useState(false);
  /** @type {[View, React.Dispatch<React.SetStateAction<View>>]} */
  const [view, setView] = useState({ type: "library" });
  const [showShareModal, setShowShareModal] = useState(false);
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

  // Per-instrument parameters (volume, pan, pitch, filter, ADSR)
  const [instrumentParams, setInstrumentParams] = useState({
    drums: { volume: 0.8, pan: 0, pitch: 0, filterType: 'none', filterCutoff: 1000, filterResonance: 1, attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
    bass: { volume: 0.8, pan: 0, pitch: 0, filterType: 'lowpass', filterCutoff: 800, filterResonance: 1, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4 },
    synth: { volume: 0.8, pan: 0, pitch: 0, filterType: 'lowpass', filterCutoff: 1200, filterResonance: 1, attack: 0.05, decay: 0.1, sustain: 0.5, release: 0.3 },
    piano: { volume: 0.8, pan: 0, pitch: 0, filterType: 'none', filterCutoff: 2000, filterResonance: 1, attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.5 },
    vocals: { volume: 0.8, pan: 0 },
    transcribed: { volume: 0.8, pan: 0, pitch: 0, filterType: 'none', filterCutoff: 1500, filterResonance: 1, attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.3 }
  });

  const patternsRef = useRef(patterns);
  const clipsRef = useRef(clips);
  const numBarsRef = useRef(numBars);
  const isLoopingRef = useRef(isLooping);
  const instrumentParamsRef = useRef(instrumentParams);
  const metronomeOnRef = useRef(metronomeOn);

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
  useEffect(() => { instrumentParamsRef.current = instrumentParams; }, [instrumentParams]);
  useEffect(() => { metronomeOnRef.current = metronomeOn; }, [metronomeOn]);

  const engine = useMemo(() => new AudioEngine(
    patternsRef,
    clipsRef,
    numBarsRef,
    isLoopingRef,
    onStopRef,
    instrumentParamsRef,
    metronomeOnRef
  ), []);
  
  useEffect(() => {
    engine.init();
  }, [engine]);

  useEffect(() => {
    engine.setBpm(bpm);
  }, [engine, bpm]);

  // Collaboration bootstrap + listeners
  useEffect(() => {
    const projectId = localStorage.getItem('currentProjectId') || 'demo';
    try { window.Collab?.init(projectId); } catch {}

    const offBpm = window.Collab?.on('bpm', (remoteBpm) => {
      if (typeof remoteBpm === 'number' && !Number.isNaN(remoteBpm)) {
        setBpm(prev => (prev === remoteBpm ? prev : remoteBpm));
      }
    });
    const offStatus = window.Collab?.on('status', (s) => setCollabStatus(s?.status || 'disconnected'));

    // Push a minimal presence snapshot
    const email = localStorage.getItem('email');
    try {
      window.Collab?.updatePresence({ user: { email: email || 'anonymous' }, playing, bpm });
    } catch {}

    return () => {
      try { offBpm?.(); offStatus?.(); } catch {}
      try { window.Collab?.destroy(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
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

  /**
   * Handle BPM change
   * @param {number} newBpm
   */
  const handleBpmChange = (newBpm) => {
    const clamped = clamp(newBpm, 40, 240);
    setBpm(clamped);
    try { window.Collab?.setBpm(clamped); } catch {}
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
    // Check if we're editing an existing pattern
    const existingPattern = patterns.find(p => p.id === pattern.id);
    
    if (existingPattern) {
      // Update existing pattern
      setPatterns(p => p.map(pat => pat.id === pattern.id ? pattern : pat));
    } else {
      // Create new pattern
      setPatterns(p => [...p, pattern]);
      
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

      // Auto-place vocal clip on timeline at bar 0
      if (pattern.instrument === 'vocals') {
          // @ts-ignore
          const clipBars = pattern.data.lengthBars;
          /** @type {TimelineClip} */
          const newClip = {
              id: uid(),
              patternId: pattern.id,
              instrument: 'vocals',
              startBar: 0,
              bars: clipBars,
          };
          setClips(c => [...c, newClip]);
      }
    }
    
    setView({ type: "library" });
  };
  
  const renderSequencer = () => {
    if (view.type === "library") return null;
    
    let component;
    if (view.type === "transcribe") {
        component = <AudioTranscriber onSave={onSavePattern} onExit={() => setView({type: 'library'})} />;
    } else if (view.type === "record_vocals") {
        component = <VocalRecorder onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} />;
    } else if (view.type === "edit") {
      // Edit mode - find the pattern and open appropriate sequencer
      const patternToEdit = patterns.find(p => p.id === view.patternId);
      if (patternToEdit) {
        if (patternToEdit.instrument === "drums") {
          component = <DrumSequencer onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} initialPattern={patternToEdit} />;
        } else if (patternToEdit.instrument === "bass" || patternToEdit.instrument === "synth") {
          component = <MelodySequencer instrument={patternToEdit.instrument} onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} initialPattern={patternToEdit} />;
        } else if (patternToEdit.instrument === "piano") {
          component = <PianoSequencer onSave={onSavePattern} onExit={() => setView({type: 'library'})} engine={engine} patterns={patterns} initialPattern={patternToEdit} />;
        }
      }
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
      
      {showShareModal && (
        <Modal onExit={() => setShowShareModal(false)}>
          <ShareModal 
            onExit={() => setShowShareModal(false)} 
            projectId={activeProject ? activeProject.projectId : null}
          />
        </Modal>
      )}
      
      <div className="max-w-7xl mx-auto">
        <div className="flex-1 flex items-center">
        <h1 className="text-2xl font-bold text-white">VYBE</h1>
        <span className="ml-3 text-xs bg-zinc-700 px-2 py-1 rounded-full">DAW</span>
        <button
          onClick={() => setShowShareModal(true)}
          className="ml-4 px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
        >
          Share
        </button>
      </div>
        
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

          <div className="ml-4 flex items-center gap-6 flex-wrap">
            {/* BPM Controls */}
            <div className="flex items-center gap-3 border-r border-zinc-700 pr-6">
              <label className="text-sm opacity-80">BPM:</label>
              <input
                type="number"
                min="40"
                max="240"
                value={bpm}
                onChange={(e) => handleBpmChange(parseInt(e.target.value) || 120)}
                className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm font-mono text-center focus:outline-none focus:ring-1 focus:ring-lime-500"
              />
              <input
                type="range"
                min="40"
                max="240"
                value={bpm}
                onChange={(e) => handleBpmChange(parseInt(e.target.value))}
                className="w-24 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-lime-500"
              />
              <button
                onClick={() => setMetronomeOn(!metronomeOn)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  metronomeOn ? 'bg-lime-600 text-black' : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
                title="Toggle metronome"
              >
                {metronomeOn ? '🔔 ON' : '🔕 OFF'}
              </button>
            </div>

            {/* Timeline Length */}
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
            {/* Collab status */}
            <span className={`ml-4 inline-flex items-center gap-2 px-2 py-1 rounded text-xs ${collabStatus === 'connected' ? 'bg-emerald-600/20 text-emerald-300' : 'bg-zinc-700 text-zinc-300'}`}>
              <span style={{ width: 8, height: 8, borderRadius: '9999px', background: collabStatus === 'connected' ? '#22c55e' : '#71717a' }} />
              {collabStatus === 'connected' ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
        
        {/* Main Layout */}
        <div className="grid grid-cols-12 gap-6">
          <LibraryPanel
            // @ts-ignore
            onSelectInstrument={(inst) => setView({ type: "sequencer", instrument: inst })}
            onSelectTranscribe={() => setView({ type: "transcribe" })}
            onSelectRecordVocals={() => setView({ type: "record_vocals" })}
            patterns={patterns}
            instrumentParams={instrumentParams}
            setInstrumentParams={setInstrumentParams}
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
            onEditClip={(patternId) => setView({ type: "edit", patternId })}
          />
        </div>
        
        {showShareModal && (
          <Modal onExit={() => setShowShareModal(false)}>
            <ShareModal 
              onExit={() => setShowShareModal(false)} 
              projectId={activeProject ? activeProject.projectId : null}
            />
          </Modal>
        )}
        
      </div>
    </div>
  );
}

// Export the main component
function App() {
  return <LoopArranger />;
}

// Export for ES modules
export default App;
