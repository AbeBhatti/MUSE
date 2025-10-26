#!/usr/bin/env python3
"""
Basic Pitch Audio Transcription Script

Usage:
    python transcribe_audio.py <input_audio_file> [options]

Examples:
    # Basic usage
    python transcribe_audio.py song.mp3

    # Adjust onset threshold (lower = more notes detected, default=0.5)
    python transcribe_audio.py song.mp3 --onset-threshold 0.3

    # Adjust frame threshold (lower = more sensitive, default=0.3)
    python transcribe_audio.py song.mp3 --frame-threshold 0.2

    # Set frequency range (for specific instruments)
    python transcribe_audio.py bass.mp3 --min-freq 40 --max-freq 400

    # Adjust minimum note length (in seconds, default=0.127)
    python transcribe_audio.py song.mp3 --min-note-len 0.05

    # Combine multiple settings
    python transcribe_audio.py song.mp3 --onset-threshold 0.4 --frame-threshold 0.25 -o output/
"""

import sys
import os
from pathlib import Path
import argparse
from basic_pitch.inference import predict_and_save
from basic_pitch import ICASSP_2022_MODEL_PATH

def transcribe_audio(
    input_audio_path,
    output_dir="output",
    onset_threshold=0.5,
    frame_threshold=0.3,
    min_note_len=0.127,
    min_freq=None,
    max_freq=None,
    melodia_trick=True,
    allow_overwrite=False
):
    """
    Transcribe audio file to MIDI using Basic Pitch

    Args:
        input_audio_path: Path to input audio file (.mp3, .wav, .flac, .ogg, .m4a)
        output_dir: Directory where output files will be saved
        onset_threshold: Threshold for note onset detection (0.0-1.0, lower=more notes)
        frame_threshold: Threshold for note frame detection (0.0-1.0, lower=more sensitive)
        min_note_len: Minimum note length in seconds
        min_freq: Minimum frequency in Hz (None = no limit)
        max_freq: Maximum frequency in Hz (None = no limit)
        melodia_trick: Use melodia trick for better monophonic transcription
        allow_overwrite: Allow overwriting existing output files
    """
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Delete existing files if overwrite is allowed
    if allow_overwrite:
        input_path = Path(input_audio_path)
        output_path = Path(output_dir)
        patterns = [
            f"{input_path.stem}_basic_pitch.mid",
            f"{input_path.stem}_basic_pitch_sonify.wav",
            f"{input_path.stem}_basic_pitch.npz",
            f"{input_path.stem}_basic_pitch.csv"
        ]
        for pattern in patterns:
            file_to_remove = output_path / pattern
            if file_to_remove.exists():
                file_to_remove.unlink()
                print(f"🗑️  Removed existing file: {file_to_remove.name}")

    # Convert to Path objects
    input_path = Path(input_audio_path)

    if not input_path.exists():
        print(f"Error: Input file '{input_audio_path}' not found!")
        return

    print(f"Transcribing: {input_path.name}")
    print(f"Output directory: {output_dir}")
    print(f"Settings:")
    print(f"  - Onset threshold: {onset_threshold}")
    print(f"  - Frame threshold: {frame_threshold}")
    print(f"  - Min note length: {min_note_len}s")
    if min_freq:
        print(f"  - Min frequency: {min_freq} Hz")
    if max_freq:
        print(f"  - Max frequency: {max_freq} Hz")
    print(f"  - Melodia trick: {melodia_trick}")
    print("-" * 50)

    # Run prediction and save outputs with custom parameters
    predict_and_save(
        audio_path_list=[str(input_path)],
        output_directory=output_dir,
        save_midi=True,           # Save MIDI file
        sonify_midi=True,         # Save audio rendering of MIDI
        save_model_outputs=True,  # Save raw model outputs (NPZ)
        save_notes=True,          # Save note events (CSV)
        model_or_model_path=ICASSP_2022_MODEL_PATH,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_len,
        minimum_frequency=min_freq,
        maximum_frequency=max_freq,
        melodia_trick=melodia_trick
    )

    print("-" * 50)
    print("✓ Transcription complete!")
    print(f"\nOutput files in '{output_dir}':")
    print(f"  - {input_path.stem}_basic_pitch.mid (MIDI file)")
    print(f"  - {input_path.stem}_basic_pitch_sonify.wav (Audio preview)")
    print(f"  - {input_path.stem}_basic_pitch_model_output.npz (Raw model data)")
    print(f"  - {input_path.stem}_basic_pitch_notes.csv (Note events)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Transcribe audio to MIDI using Basic Pitch',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument('input_file', help='Input audio file path')
    parser.add_argument('-o', '--output-dir', default='output',
                        help='Output directory (default: output/)')

    # Threshold parameters
    parser.add_argument('--onset-threshold', type=float, default=0.5,
                        help='Note onset threshold (0.0-1.0, lower=more notes, default=0.5)')
    parser.add_argument('--frame-threshold', type=float, default=0.3,
                        help='Frame threshold (0.0-1.0, lower=more sensitive, default=0.3)')

    # Note parameters
    parser.add_argument('--min-note-len', type=float, default=0.127,
                        help='Minimum note length in seconds (default=0.127)')

    # Frequency parameters
    parser.add_argument('--min-freq', type=float, default=None,
                        help='Minimum frequency in Hz (default: no limit)')
    parser.add_argument('--max-freq', type=float, default=None,
                        help='Maximum frequency in Hz (default: no limit)')

    # Additional options
    parser.add_argument('--no-melodia-trick', action='store_true',
                        help='Disable melodia trick (useful for polyphonic music)')
    parser.add_argument('--overwrite', action='store_true',
                        help='Overwrite existing output files')

    args = parser.parse_args()

    transcribe_audio(
        args.input_file,
        output_dir=args.output_dir,
        onset_threshold=args.onset_threshold,
        frame_threshold=args.frame_threshold,
        min_note_len=args.min_note_len,
        min_freq=args.min_freq,
        max_freq=args.max_freq,
        melodia_trick=not args.no_melodia_trick,
        allow_overwrite=args.overwrite
    )
