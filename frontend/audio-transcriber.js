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
   * Transcribe an audio file to MIDI with optional stem separation
   * @param {File} file - The audio file to transcribe
   * @param {Object} options - Transcription options
   * @param {boolean} options.useSeparation - Whether to separate audio into stems
   * @param {number} options.confidenceThreshold - Confidence threshold (maps to onset_threshold)
   * @param {number} options.minNoteDuration - Minimum note duration in seconds (maps to min_note_len)
   * @param {number} options.bpm - BPM of the audio
   * @param {number} options.maxBars - Maximum number of bars for the transcription
   * @param {number} [options.minFreq] - Minimum frequency in Hz
   * @param {number} [options.maxFreq] - Maximum frequency in Hz
   * @returns {Promise<{notes: Array, audioLengthBars: number, originalFileName: string, tracks?: Array}>}
   */
  async transcribeAudio(file, options = {}) {
    const {
      useSeparation = false,
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

    // Choose endpoint based on separation option
    console.log('AudioTranscriber: useSeparation =', useSeparation);
    let endpoint = '/upload';
    if (useSeparation) {
      endpoint = '/separate';
      formData.append('use_demucs', 'true');
      console.log('AudioTranscriber: Using /separate endpoint for stem separation');
    } else {
      console.log('AudioTranscriber: Using /upload endpoint for basic transcription');
      // Add transcription parameters for basic upload
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
    }

    console.log('[AudioTranscriber.transcribeAudio] Starting transcription...');
    console.log('[AudioTranscriber.transcribeAudio] File:', file.name, 'Size:', file.size, 'Type:', file.type);
    
    try {
      // Upload and transcribe/separate
      console.log('[AudioTranscriber.transcribeAudio] Fetching:', `${this.baseUrl}${endpoint}`);
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        body: formData
      });

      console.log('[AudioTranscriber.transcribeAudio] Response status:', response.status, response.statusText);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AudioTranscriber.transcribeAudio] Error response:', errorText);
        const errorMsg = `Server error (${response.status}): ${errorText.substring(0, 200)}`;
        throw new Error(errorMsg);
      }

      console.log('[AudioTranscriber.transcribeAudio] Parsing JSON response...');
      const data = await response.json();
      console.log('[AudioTranscriber.transcribeAudio] Raw response data:', JSON.stringify(data, null, 2));
      console.log('[AudioTranscriber.transcribeAudio] Has tracks?', !!data.tracks);
      console.log('[AudioTranscriber.transcribeAudio] Track count:', data.tracks ? data.tracks.length : 0);
      console.log('[AudioTranscriber.transcribeAudio] Success flag:', data.success);

      // Handle separation response (multiple tracks)
      if (useSeparation && data.tracks) {
        console.log('[AudioTranscriber.transcribeAudio] Processing separated tracks...');
        return this.processSeparatedTracks(data, file.name, bpm, maxBars);
      }

      // Parse the basic transcription data
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
      console.error('[AudioTranscriber.transcribeAudio] ERROR caught:', error);
      console.error('[AudioTranscriber.transcribeAudio] Error type:', typeof error);
      console.error('[AudioTranscriber.transcribeAudio] Error constructor:', error?.constructor?.name);
      console.error('[AudioTranscriber.transcribeAudio] Error message:', error?.message);
      console.error('[AudioTranscriber.transcribeAudio] Error stack:', error?.stack);
      
      // Ensure we throw a proper Error object with a message
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`Transcription failed: ${String(error)}`);
      }
    }
  }

  /**
   * Process separated tracks from audio separation
   * @param {Object} data - Separation response data
   * @param {string} originalFileName - Original audio file name
   * @param {number} bpm - BPM for timing conversion
   * @param {number} maxBars - Maximum bars to include
   * @returns {Object} Processed tracks data
   */
  processSeparatedTracks(data, originalFileName, bpm, maxBars) {
    console.log('[AudioTranscriber.processSeparatedTracks] Starting processing...');
    console.log('[AudioTranscriber.processSeparatedTracks] Input tracks:', data.tracks ? data.tracks.length : 0);
    console.log('[AudioTranscriber.processSeparatedTracks] BPM:', bpm, 'Max Bars:', maxBars);
    
    const beatsPerBar = 4;
    const secondsPerBeat = 60 / bpm;
    const secondsPerBar = secondsPerBeat * beatsPerBar;
    const maxBeats = maxBars * beatsPerBar;

    const processedTracks = [];
    let maxTime = 0;

    // Process each separated track
    data.tracks.forEach((track, trackIndex) => {
      console.log(`[AudioTranscriber.processSeparatedTracks] Track ${trackIndex}:`, {
        stem: track.stem,
        instrument: track.instrument,
        note_count: track.note_count,
        notes_array_length: track.notes ? track.notes.length : 0
      });
      
      const formattedNotes = [];
      
      if (track.notes && track.notes.length > 0) {
        console.log(`[AudioTranscriber.processSeparatedTracks] Track ${trackIndex} has ${track.notes.length} notes to process`);
        track.notes.forEach((note, noteIndex) => {
          // Convert time from seconds to beats
          const startInBeats = note.start / secondsPerBeat;
          const durationInBeats = note.duration / secondsPerBeat;

          // Filter out notes beyond maxBars
          if (startInBeats < maxBeats) {
            formattedNotes.push({
              id: `note_${trackIndex}_${noteIndex}_${Date.now()}`,
              note: note.pitch,
              start: startInBeats,
              duration: Math.min(durationInBeats, maxBeats - startInBeats)
            });

            const endTime = note.start + note.duration;
            if (endTime > maxTime) {
              maxTime = endTime;
            }
          }
        });
        console.log(`[AudioTranscriber.processSeparatedTracks] Track ${trackIndex} formatted ${formattedNotes.length} notes`);
      } else {
        console.log(`[AudioTranscriber.processSeparatedTracks] Track ${trackIndex} has no notes to process`);
      }

      const processedTrack = {
        stem: track.stem,
        instrument: track.instrument || track.stem,
        notes: formattedNotes,
        note_count: formattedNotes.length,
        midi_path: track.midi_path,
        audio_path: track.audio_path
      };
      
      processedTracks.push(processedTrack);
      console.log(`[AudioTranscriber.processSeparatedTracks] Added processed track ${trackIndex}:`, processedTrack.stem, 'with', processedTrack.note_count, 'notes');
    });

    // Calculate total length in bars
    let audioLengthBars = Math.ceil(maxTime / secondsPerBar);
    audioLengthBars = Math.min(Math.max(audioLengthBars, 1), maxBars);

    console.log('[AudioTranscriber.processSeparatedTracks] Final processed tracks:', processedTracks.length);
    console.log('[AudioTranscriber.processSeparatedTracks] Audio length bars:', audioLengthBars);

    const result = {
      tracks: processedTracks,
      audioLengthBars,
      originalFileName,
      requestId: data.requestId,
      success: true
    };
    
    console.log('[AudioTranscriber.processSeparatedTracks] Returning result with', result.tracks.length, 'tracks');
    return result;
  }

  /**
   * Download the generated MIDI file
   * @param {string} filename - The MIDI filename returned from transcription
   * @param {string} [requestId] - Optional request ID for separated tracks
   * @returns {Promise<Blob>}
   */
  async downloadMidi(filename, requestId = null) {
    const url = requestId 
      ? `${this.baseUrl}/midi/${requestId}/${filename}`
      : `${this.baseUrl}/midi/${filename}`;
    
    const response = await fetch(url);
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
