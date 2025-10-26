#!/usr/bin/env python3
"""
Flask server for MIDI Editor - handles MP3 to MIDI conversion
"""

from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import os
from pathlib import Path
import tempfile
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH
import pretty_midi

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = Path('temp_uploads')
OUTPUT_FOLDER = Path('temp_output')
UPLOAD_FOLDER.mkdir(exist_ok=True)
OUTPUT_FOLDER.mkdir(exist_ok=True)

@app.route('/')
def index():
    html_path = os.path.abspath('midi-editor.html')
    print(f"Serving HTML from: {html_path}")
    if not os.path.exists(html_path):
        return f"HTML file not found at: {html_path}", 404
    return send_file(html_path)

@app.route('/midi-editor.js')
def js():
    js_path = os.path.abspath('midi-editor.js')
    print(f"Serving JS from: {js_path}")
    if not os.path.exists(js_path):
        return f"JS file not found at: {js_path}", 404
    return send_file(js_path)

@app.route('/upload', methods=['POST'])
def upload_audio():
    """Handle audio file upload and convert to MIDI"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Get parameters
        onset_threshold = float(request.form.get('onset_threshold', 0.5))
        frame_threshold = float(request.form.get('frame_threshold', 0.3))
        min_note_len = float(request.form.get('min_note_len', 0.127))
        min_freq = request.form.get('min_freq')
        max_freq = request.form.get('max_freq')
        melodia_trick = request.form.get('melodia_trick', 'true').lower() == 'true'

        min_freq = float(min_freq) if min_freq else None
        max_freq = float(max_freq) if max_freq else None

        # Save uploaded file
        filename = file.filename
        filepath = UPLOAD_FOLDER / filename
        file.save(str(filepath))

        # Run Basic Pitch transcription
        print(f"Transcribing {filename}...")
        model_output, midi_data, note_events = predict(
            str(filepath),
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=min_note_len,
            minimum_frequency=min_freq,
            maximum_frequency=max_freq,
            melodia_trick=melodia_trick
        )

        # Save MIDI file
        output_filename = Path(filename).stem + '_transcribed.mid'
        output_path = OUTPUT_FOLDER / output_filename
        midi_data.write(str(output_path))

        print(f"✓ Transcription complete: {len(note_events)} notes")

        # Clean up uploaded audio file
        filepath.unlink()

        return jsonify({
            'success': True,
            'filename': output_filename,
            'note_count': len(note_events),
            'duration': float(midi_data.get_end_time())
        })

    except Exception as e:
        print(f"Error during transcription: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/midi/<filename>')
def get_midi(filename):
    """Serve MIDI file"""
    try:
        return send_from_directory(OUTPUT_FOLDER, filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/save', methods=['POST'])
def save_midi():
    """Save edited MIDI file"""
    try:
        data = request.json
        midi_data = data.get('midi_data')
        filename = data.get('filename', 'edited.mid')

        # TODO: Implement MIDI saving from JSON data
        # For now, just return success
        return jsonify({'success': True, 'filename': filename})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("🎵 MIDI Editor Server Starting...")
    print("📂 Upload folder:", UPLOAD_FOLDER.absolute())
    print("📂 Output folder:", OUTPUT_FOLDER.absolute())
    print("\n🌐 Open http://localhost:8080 in your browser\n")
    app.run(debug=True, port=8080, host='0.0.0.0')
