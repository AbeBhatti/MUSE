// backend/services/transcribe.js
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/**
 * Spawns Python to run Basic Pitch via node_transcribe.py.
 * @param {string} inputPath - path to uploaded audio file
 * @param {string} outputDir - output directory for MIDI
 * @param {object} params - thresholds and options
 * @returns {Promise<object>} - parsed JSON result from Python
 */
function transcribeAudio(inputPath, outputDir, params = {}) {
  const AUDIO_MIDI_ROOT = path.join(__dirname, '..', '..', 'audio-midi');
  const pyPath = path.join(AUDIO_MIDI_ROOT, 'node_transcribe.py');

  const {
    onset_threshold = '0.5',
    frame_threshold = '0.3',
    min_note_len = '0.127',
    min_freq = '',
    max_freq = '',
    melodia_trick = 'true',
  } = params;

  const args = [
    pyPath,
    '--input', inputPath,
    '--output_dir', outputDir,
    '--onset_threshold', String(onset_threshold),
    '--frame_threshold', String(frame_threshold),
    '--min_note_len', String(min_note_len),
    '--melodia_trick', String(melodia_trick),
  ];
  if (min_freq) args.push('--min_freq', String(min_freq));
  if (max_freq) args.push('--max_freq', String(max_freq));

  return new Promise((resolve, reject) => {
    const pythonCmd = process.env.PYTHON_CMD || 'python3';
    const py = spawn(pythonCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => (out += d.toString()));
    py.stderr.on('data', (d) => (err += d.toString()));
    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(err || out || 'Transcription failed'));
      }
      try {
        const payload = JSON.parse(out.trim().split('\n').pop());
        resolve(payload);
      } catch (e) {
        reject(new Error('Invalid transcription output'));
      }
    });
  });
}

module.exports = { transcribeAudio };
