/**
 * Audio Transcriber
 * Handles MP3-to-MIDI transcription using the backend API
 */

(function() {
  'use strict';

class AudioTranscriber {
  constructor() {
    this.baseUrl = window.location.origin;
  }

  /**
   * Initialize the transcriber
   * @returns {Promise<void>}
   */
  async init() {
    // No initialization needed for backend-based transcription
    return Promise.resolve();
  }

  /**
   * Transcribe an audio file to MIDI
   * @param {File} file - The audio file to transcribe
   * @param {Object} options - Transcription options
   * @param {number} options.confidenceThreshold - Confidence threshold (maps to onset_threshold)
   * @param {number} options.minNoteDuration - Minimum note duration in seconds (maps to min_note_len)
   * @param {number} options.bpm - BPM of the audio
   * @param {number} options.maxBars - Maximum number of bars for the transcription
   * @param {number} [options.minFreq] - Minimum frequency in Hz
   * @param {number} [options.maxFreq] - Maximum frequency in Hz
   * @returns {Promise<{notes: Array, audioLengthBars: number, originalFileName: string}>}
   */
  async transcribeAudio(file, options = {}) {
    const {
      confidenceThreshold = 0.5,
      minNoteDuration = 0.127,
      bpm = 120,
      maxBars = 8,
      minFreq,
      maxFreq
    } = options;

    // Create FormData to upload the file
    const formData = new FormData();
    formData.append('file', file);

    // Add transcription parameters
    formData.append('onset_threshold', confidenceThreshold.toString());
    formData.append('frame_threshold', '0.3');
    formData.append('min_note_len', minNoteDuration.toString());
    formData.append('melodia_trick', 'true');

    if (minFreq) {
      formData.append('min_freq', minFreq.toString());
    }
    if (maxFreq) {
      formData.append('max_freq', maxFreq.toString());
    }

    try {
      // Upload and transcribe
      const response = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Transcription failed: ${errorText}`);
      }

      const data = await response.json();

      // Parse the transcription data
      // Expected format from backend:
      // {
      //   midi_filename: "output.mid",
      //   notes: [{pitch: 60, start: 0.0, duration: 0.5}, ...]
      // }

      if (!data.notes || !Array.isArray(data.notes)) {
        throw new Error('Invalid transcription response format');
      }

      // Convert backend format to DAW format
      const beatsPerBar = 4;
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
      if (audioLengthBars > maxBars) {
        audioLengthBars = maxBars;
      }

      // Ensure at least 1 bar
      if (audioLengthBars < 1) {
        audioLengthBars = 1;
      }

      // Convert notes to DAW format
      // Backend sends: {pitch: 60, start: 0.0, duration: 0.5}
      // DAW expects: {id: string, note: 60, start: 0.0 (in beats), duration: 0.5 (in beats)}
      const formattedNotes = data.notes.map((note, index) => {
        // Convert time from seconds to beats
        const startInBeats = note.start / secondsPerBeat;
        const durationInBeats = note.duration / secondsPerBeat;

        // Filter out notes beyond maxBars
        const maxBeats = maxBars * beatsPerBar;
        if (startInBeats >= maxBeats) {
          return null;
        }

        return {
          id: `note_${index}_${Date.now()}`,
          note: note.pitch,
          start: startInBeats,
          duration: Math.min(durationInBeats, maxBeats - startInBeats)
        };
      }).filter(note => note !== null);

      return {
        notes: formattedNotes,
        audioLengthBars,
        originalFileName: file.name,
        midiFilename: data.midi_filename
      };

    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  /**
   * Download the generated MIDI file
   * @param {string} filename - The MIDI filename returned from transcription
   * @returns {Promise<Blob>}
   */
  async downloadMidi(filename) {
    const response = await fetch(`${this.baseUrl}/midi/${filename}`);
    if (!response.ok) {
      throw new Error('Failed to download MIDI file');
    }
    return response.blob();
  }
}

// Make it available globally
window.AudioTranscriber = AudioTranscriber;

// Also support ES6 module import
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioTranscriber };
}

})();
