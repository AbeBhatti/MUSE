/**
 * Simple Audio Transcriber
 * A non-React implementation that avoids React hydration errors
 * by handling all state and UI updates manually
 */

class SimpleTranscriber {
  constructor() {
    this.container = null;
    this.isLoading = false;
    this.error = null;
    this.file = null;
    this.onSaveCallback = null;
    this.onExitCallback = null;
    this.options = {
      confidenceThreshold: 0.5,
      minNoteDuration: 0.127,
      bpm: 120,
      useSeparation: true,
      maxBars: 8
    };
  }

  /**
   * Initialize the transcriber UI
   * @param {HTMLElement} container - The container to render the UI into
   * @param {Function} onSave - Callback when a pattern is saved
   * @param {Function} onExit - Callback when the modal is closed
   */
  init(container, onSave, onExit) {
    this.container = container;
    this.onSaveCallback = onSave;
    this.onExitCallback = onExit;
    
    console.log('[SimpleTranscriber] Initialized');
    console.log('[SimpleTranscriber] Container:', this.container);
    console.log('[SimpleTranscriber] Callbacks:', {
      hasOnSave: !!this.onSaveCallback,
      hasOnExit: !!this.onExitCallback
    });
    
    // Check for dependencies
    console.log('[SimpleTranscriber] window.AudioTranscriber available:', !!window.AudioTranscriber);
    
    // Render the initial UI
    this.render();
  }

  /**
   * Update the UI based on current state
   */
  render() {
    if (!this.container) return;
    
    // Clear container
    this.container.innerHTML = '';
    
    // Create UI elements
    const wrapper = document.createElement('div');
    wrapper.className = 'p-6 bg-zinc-800 rounded-xl shadow-2xl w-full max-w-lg text-white';
    
    // Header
    const header = document.createElement('h2');
    header.className = 'text-2xl font-bold mb-4 text-lime-400';
    header.textContent = 'Audio Transcription';
    wrapper.appendChild(header);
    
    // Description
    const description = document.createElement('p');
    description.className = 'mb-4 text-sm opacity-70';
    description.textContent = 'Upload an audio file (MP3, WAV, etc.) to convert its main melody into a non-editable timeline clip.';
    wrapper.appendChild(description);
    
    // File input wrapper
    const fileInputWrapper = document.createElement('div');
    fileInputWrapper.className = 'mb-4';
    
    // File input label
    const fileLabel = document.createElement('label');
    fileLabel.htmlFor = 'audio-file-simple';
    fileLabel.className = 'block text-sm font-medium mb-2';
    fileLabel.textContent = 'Select Audio File:';
    fileInputWrapper.appendChild(fileLabel);
    
    // File input
    const fileInput = document.createElement('input');
    fileInput.id = 'audio-file-simple';
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.className = 'w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-700 file:text-lime-300 hover:file:bg-zinc-600';
    fileInput.addEventListener('change', this.handleFileChange.bind(this));
    fileInputWrapper.appendChild(fileInput);
    
    // Show selected file if any
    if (this.file) {
      const selectedFile = document.createElement('p');
      selectedFile.className = 'mt-2 text-lime-500 text-sm';
      selectedFile.textContent = `Selected: ${this.file.name} (Ready to transcribe)`;
      fileInputWrapper.appendChild(selectedFile);
    }
    
    wrapper.appendChild(fileInputWrapper);
    
    // Error message if any
    if (this.error) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'bg-red-900/50 border border-red-500 p-2 rounded text-sm mb-4';
      errorDiv.textContent = this.error;
      wrapper.appendChild(errorDiv);
    }
    
    // Buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'flex justify-end gap-3';
    
    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.className = 'px-4 py-2 bg-zinc-600 rounded-lg hover:bg-zinc-700 transition';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = this.isLoading;
    cancelButton.addEventListener('click', this.handleExit.bind(this));
    buttonsDiv.appendChild(cancelButton);
    
    // Submit button
    const submitButton = document.createElement('button');
    submitButton.className = 'px-4 py-2 bg-lime-500 text-black font-semibold rounded-lg hover:bg-lime-400 transition disabled:opacity-50';
    submitButton.disabled = !this.file || this.isLoading;
    
    if (this.isLoading) {
      // Loading spinner and text
      const spinnerSpan = document.createElement('span');
      spinnerSpan.className = 'flex items-center';
      
      const spinner = document.createElement('svg');
      spinner.className = 'animate-spin -ml-1 mr-3 h-5 w-5 text-black';
      spinner.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      spinner.setAttribute('fill', 'none');
      spinner.setAttribute('viewBox', '0 0 24 24');
      spinner.innerHTML = '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>';
      
      spinnerSpan.appendChild(spinner);
      spinnerSpan.appendChild(document.createTextNode('Transcribing...'));
      submitButton.appendChild(spinnerSpan);
    } else {
      submitButton.textContent = 'Transcribe & Add';
    }
    
    submitButton.addEventListener('click', this.handleSubmit.bind(this));
    buttonsDiv.appendChild(submitButton);
    
    wrapper.appendChild(buttonsDiv);
    this.container.appendChild(wrapper);
  }

  /**
   * Handle file selection change
   * @param {Event} e - Change event
   */
  handleFileChange(e) {
    const uploadedFile = e.target.files?.[0];
    
    if (uploadedFile) {
      if (!uploadedFile.type.startsWith('audio/')) {
        this.error = "Please upload an audio file (e.g., MP3, WAV).";
        this.file = null;
      } else {
        this.error = null;
        this.file = uploadedFile;
      }
      this.render();
    }
  }

  /**
   * Handle exit/cancel button click
   */
  handleExit() {
    if (typeof this.onExitCallback === 'function') {
      this.onExitCallback();
    }
  }

  /**
   * Handle transcribe button click
   */
  async handleSubmit() {
    console.log('[SimpleTranscriber] handleSubmit called');
    
    if (!this.file) {
      this.error = "Please select an audio file first.";
      this.render();
      return;
    }

    console.log('[SimpleTranscriber] Starting transcription for:', this.file.name);
    
    this.error = null;
    this.isLoading = true;
    this.render();

    try {
      if (typeof this.onSaveCallback !== 'function') {
        throw new Error('onSave handler is missing');
      }
      
      console.log('[SimpleTranscriber] Options:', {
        useSeparation: this.options.useSeparation,
        confidenceThreshold: this.options.confidenceThreshold,
        minNoteDuration: this.options.minNoteDuration,
        bpm: this.options.bpm,
        maxBars: this.options.maxBars
      });
      
      // Call the backend API directly instead of using AudioTranscriber
      const formData = new FormData();
      formData.append('file', this.file);
      
      // Choose endpoint based on separation option
      const endpoint = this.options.useSeparation ? '/separate' : '/upload';
      console.log('[SimpleTranscriber] Using endpoint:', endpoint);
      
      if (this.options.useSeparation) {
        formData.append('use_demucs', 'true');
      } else {
        formData.append('onset_threshold', this.options.confidenceThreshold.toString());
        formData.append('frame_threshold', '0.3');
        formData.append('min_note_len', this.options.minNoteDuration.toString());
        formData.append('melodia_trick', 'true');
      }
      
      // Make direct API call to backend
      console.log('[SimpleTranscriber] Sending request to:', window.location.origin + endpoint);
      const response = await fetch(window.location.origin + endpoint, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Transcription API error (${response.status}): ${errorText}`);
      }
      
      const data = await response.json();
      console.log('[SimpleTranscriber] Received API response:', data);
      
      // Transform the backend response to match expected format
      let transcriptionData = data;
      
      // Format data appropriately based on endpoint
      if (endpoint === '/upload' && !transcriptionData.tracks) {
        transcriptionData = {
          notes: data.notes || [],
          audioLengthBars: Math.min(
            Math.max(1, Math.ceil((data.duration || 0) / (60 / this.options.bpm * 4))),
            this.options.maxBars
          ),
          originalFileName: this.file.name
        };
      }

      console.log('[SimpleTranscriber] Received transcription data:', {
        hasTracks: !!transcriptionData.tracks,
        trackCount: transcriptionData.tracks?.length || 0,
        hasNotes: !!transcriptionData.notes
      });

      // Process patterns and save them
      this.processAndSavePatterns(transcriptionData);
      
    } catch (e) {
      console.error('[SimpleTranscriber] Transcription failed:', e);
      console.error('[SimpleTranscriber] Error type:', typeof e);
      console.error('[SimpleTranscriber] Error constructor:', e?.constructor?.name);
      console.error('[SimpleTranscriber] Error message:', e?.message);
      console.error('[SimpleTranscriber] Error stack:', e?.stack);
      console.error('[SimpleTranscriber] Error toString:', String(e));
      
      // Extract error message
      let errorMessage = "An error occurred during transcription.";
      if (e && e.message) {
        errorMessage = e.message;
      } else if (typeof e === 'string') {
        errorMessage = e;
      } else if (e) {
        errorMessage = String(e);
      }
      
      this.error = errorMessage;
      this.isLoading = false;
      this.render();
    }
  }

  /**
   * Process transcription data and save patterns
   * @param {Object} transcriptionData - The transcription data
   */
  processAndSavePatterns(transcriptionData) {
    console.log('[SimpleTranscriber] Processing transcription data');
    
    const uid = () => Math.random().toString(36).slice(2, 9);
    const patternsToSave = [];
    
    if (transcriptionData.tracks && transcriptionData.tracks.length > 0) {
      console.log('[SimpleTranscriber] Processing', transcriptionData.tracks.length, 'tracks');
      
      // Process multiple tracks (stems)
      transcriptionData.tracks.forEach((track, trackIdx) => {
        console.log(`[SimpleTranscriber] Track ${trackIdx}:`, track.stem, 'notes:', track.notes?.length || 0);
        
        if (track.notes && track.notes.length > 0) {
          let displayName = track.stem ? (track.stem.charAt(0).toUpperCase() + track.stem.slice(1)) : 'Track';
          if (track.stem === 'original') displayName = 'Full Mix';
          if (track.stem === 'other') displayName = 'Other/Synth';

          const uniqueId = uid();
          
          const pattern = {
            id: uniqueId,
            name: `${displayName}: ${this.file.name.substring(0, 15)}...`,
            instrument: 'transcribed',
            data: {
              type: 'transcribed',
              notes: track.notes.map((n, i) => ({ 
                id: `t_${uniqueId}_${i}`, 
                note: n.note || n.pitch,  // Support both formats
                start: n.start,  // Already in beats from audio-transcriber.js
                duration: n.duration
              })),
              audioLengthBars: transcriptionData.audioLengthBars || this.options.maxBars,
              originalFileName: transcriptionData.originalFileName || this.file.name,
              stemType: track.stem,
              trackName: displayName,
            },
          };

          console.log(`[SimpleTranscriber] Created pattern for ${displayName}:`, pattern.data.notes.length, 'notes');
          patternsToSave.push(pattern);
        }
      });
      
    } else if (transcriptionData.notes) {
      // Single pattern (no separation)
      console.log('[SimpleTranscriber] Processing single pattern');
      const beatsPerBar = 4;
      const secondsPerBeat = 60 / this.options.bpm;

      const formattedNotes = (transcriptionData.notes || []).map((note, index) => ({
        id: `note_${index}_${Date.now()}`,
        note: note.pitch,
        start: (note.start / secondsPerBeat),
        duration: (note.duration / secondsPerBeat),
      }));

      let audioLengthBars = Math.max(1, Math.min(this.options.maxBars, 
        Math.ceil((formattedNotes.reduce((m, n) => Math.max(m, n.start * secondsPerBeat + n.duration * secondsPerBeat), 0)) 
        / (secondsPerBeat * beatsPerBar))));

      const newPattern = {
        id: uid(),
        name: `Transcribed: ${this.file.name.substring(0, 20)}...`,
        instrument: 'transcribed',
        data: {
          type: 'transcribed',
          notes: formattedNotes,
          audioLengthBars,
          originalFileName: this.file.name,
        },
      };
      
      patternsToSave.push(newPattern);
    }

    // Save patterns one by one
    console.log('[SimpleTranscriber] Saving', patternsToSave.length, 'patterns');
    this.isLoading = false;
    this.render();
    
    // Save patterns sequentially
    this.savePatterns(patternsToSave, 0);
  }
  
  /**
   * Save patterns sequentially
   * @param {Array} patterns - Array of patterns to save
   * @param {number} index - Current pattern index
   */
  savePatterns(patterns, index) {
    if (index >= patterns.length) {
      console.log('[SimpleTranscriber] All patterns saved, closing modal');
      setTimeout(() => {
        if (typeof this.onExitCallback === 'function') {
          this.onExitCallback();
        }
      }, 100);
      return;
    }
    
    const pattern = patterns[index];
    console.log(`[SimpleTranscriber] Saving pattern ${index + 1}/${patterns.length}:`, pattern.name);
    
    try {
      // Save current pattern
      if (typeof this.onSaveCallback === 'function') {
        this.onSaveCallback(pattern);
      }
      
      // Save next pattern after a delay
      setTimeout(() => {
        this.savePatterns(patterns, index + 1);
      }, 50);
    } catch (err) {
      console.error(`[SimpleTranscriber] Error saving pattern ${index + 1}:`, err);
      // Continue with next pattern despite error
      setTimeout(() => {
        this.savePatterns(patterns, index + 1);
      }, 50);
    }
  }
}

// Make available globally
window.SimpleTranscriber = SimpleTranscriber;
