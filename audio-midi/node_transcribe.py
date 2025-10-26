#!/usr/bin/env python3
"""
Node bridge: Transcribe audio to MIDI using Basic Pitch and return JSON.

Writes MIDI to the specified output directory with suffix `_transcribed.mid`.
Prints a single JSON line on stdout with: {"success": true, "filename": str, "note_count": int, "duration": float}
"""

import argparse
import json
from pathlib import Path
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to uploaded audio file')
    parser.add_argument('--output_dir', required=True, help='Directory to write MIDI file')
    parser.add_argument('--onset_threshold', type=float, default=0.5)
    parser.add_argument('--frame_threshold', type=float, default=0.3)
    parser.add_argument('--min_note_len', type=float, default=0.127)
    parser.add_argument('--min_freq', type=float, default=None)
    parser.add_argument('--max_freq', type=float, default=None)
    parser.add_argument('--melodia_trick', type=str, default='true')
    args = parser.parse_args()

    inp = Path(args.input)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    melodia = (str(args.melodia_trick).lower() == 'true')

    model_output, midi_data, note_events = predict(
        str(inp),
        onset_threshold=args.onset_threshold,
        frame_threshold=args.frame_threshold,
        minimum_note_length=args.min_note_len,
        minimum_frequency=args.min_freq,
        maximum_frequency=args.max_freq,
        melodia_trick=melodia
    )

    output_filename = inp.stem + '_transcribed.mid'
    output_path = out_dir / output_filename
    midi_data.write(str(output_path))

    # Convert note_events to JSON-serializable format
    # note_events is a numpy array with columns: start_time_s, end_time_s, pitch, amplitude, bend
    notes = []
    for note_event in note_events:
        start_time = float(note_event[0])  # start_time_s
        end_time = float(note_event[1])    # end_time_s
        pitch = int(note_event[2])          # pitch
        duration = end_time - start_time

        notes.append({
            'pitch': pitch,
            'start': start_time,
            'duration': duration
        })

    result = {
        'success': True,
        'midi_filename': output_filename,
        'filename': output_filename,  # Keep for backward compatibility
        'note_count': int(len(note_events)),
        'duration': float(midi_data.get_end_time()),
        'notes': notes  # Include notes array for frontend
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
