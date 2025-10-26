# Basic Pitch - Audio to MIDI Transcription

This directory contains tools for automatic music transcription using Spotify's Basic Pitch library.

## Quick Start

### Method 1: Command Line Tool

```bash
# Basic usage - creates MIDI file
basic-pitch output/ your_audio.mp3

# With all output options
basic-pitch output/ your_audio.mp3 --sonify-midi --save-model-outputs --save-note-events

# Process multiple files
basic-pitch output/ song1.mp3 song2.wav song3.flac
```

### Method 2: Python Script

```bash
# Using the provided script
python transcribe_audio.py your_audio.mp3

# Specify custom output directory
python transcribe_audio.py your_audio.mp3 my_output/
```

## Supported Audio Formats

- `.mp3` - MP3 audio
- `.wav` - WAV audio
- `.flac` - FLAC lossless audio
- `.ogg` - Ogg Vorbis
- `.m4a` - M4A/AAC audio

## Output Files

Basic Pitch generates several output files:

1. **`*_basic_pitch.mid`** - MIDI file with transcribed notes and pitch bends
2. **`*_basic_pitch_sonify.wav`** - Audio preview of the MIDI transcription
3. **`*_basic_pitch_notes.csv`** - Note events in CSV format (start time, duration, pitch, etc.)
4. **`*_basic_pitch_model_output.npz`** - Raw neural network outputs

## Command Line Options

```bash
basic-pitch --help
```

Common options:
- `--sonify-midi` - Generate audio preview of MIDI
- `--save-model-outputs` - Save raw model outputs
- `--save-note-events` - Save note events as CSV
- `--model-serialization` - Choose model type (tensorflow, coreml, tflite, onnx)
- `--minimum-frequency` - Set minimum note frequency in Hz
- `--maximum-frequency` - Set maximum note frequency in Hz

## Examples

### Transcribe a piano recording
```bash
basic-pitch output/ piano_recording.mp3 --sonify-midi
```

### Transcribe with frequency limits (for bass guitar)
```bash
basic-pitch output/ bass.wav --minimum-frequency 40 --maximum-frequency 400
```

### Process all audio files in a folder
```bash
basic-pitch output/ audio_files/*.mp3
```

## Python API Example

```python
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH

# Simple prediction
model_output, midi_data, note_events = predict('audio.mp3')

# Save MIDI file
from mido import MidiFile
midi_data.write('output.mid')
```

## Tips

- **Best results**: Use recordings with one instrument at a time
- **Works on**: Any instrument (piano, guitar, vocals, etc.)
- **Polyphonic**: Supports multiple simultaneous notes
- **Audio quality**: Higher quality input = better transcription
- **Processing time**: ~1-2 minutes per minute of audio (varies by hardware)

## Environment

- Python 3.10 required for M-series Macs
- Python 3.7-3.11 for other systems
- Uses CoreML on macOS by default for optimized performance

## Troubleshooting

If you encounter issues:
1. Ensure you're in the correct conda environment
2. Check that your audio file is readable
3. Try converting stereo to mono for better results
4. Reduce audio length for testing (first 30 seconds)
