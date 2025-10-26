#!/usr/bin/env python3
"""
Audio Processor for VYBE
Converts MP3/WAV to separated MIDI tracks using Demucs and basic-pitch
"""

import os
import sys
import json
from pathlib import Path
import numpy as np
import librosa
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH

# Try importing demucs
try:
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from demucs.audio import save_audio
    DEMUCS_AVAILABLE = True
except ImportError:
    DEMUCS_AVAILABLE = False
    print("Warning: Demucs not available. Install with: pip install demucs torch", file=sys.stderr)


def classify_instrument(audio_path, sr=22050):
    """Classify instrument type from audio using spectral features"""
    try:
        y, _ = librosa.load(audio_path, sr=sr, duration=3.0)
        
        spectral_centroid = np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))
        spectral_rolloff = np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))
        zero_crossing_rate = np.mean(librosa.feature.zero_crossing_rate(y))
        
        if spectral_centroid > 3000 and zero_crossing_rate < 0.1:
            return "brass" if spectral_rolloff > 5000 else "strings"
        elif zero_crossing_rate > 0.15:
            return "guitar"
        elif 1000 < spectral_centroid < 2500:
            return "piano"
        else:
            return "synth"
    except Exception as e:
        print(f"Instrument classification error: {e}", file=sys.stderr)
        return "other"


def audio_to_midi(audio_path, output_path, instrument_name="unknown", max_duration=300):
    """Convert audio to MIDI using basic-pitch"""
    print(f"[audio_to_midi] Converting {instrument_name}: {audio_path}", file=sys.stderr)
    print(f"[audio_to_midi] Output path: {output_path}", file=sys.stderr)
    
    try:
        # Load audio with max duration limit for processing
        print(f"[audio_to_midi] Loading audio (max {max_duration}s)...", file=sys.stderr)
        y, sr = librosa.load(audio_path, sr=22050, duration=max_duration)
        print(f"[audio_to_midi] Audio loaded. Duration: {len(y)/sr:.2f}s, Sample rate: {sr}", file=sys.stderr)
        
        # Use basic-pitch to convert to MIDI
        print(f"[audio_to_midi] Running Basic Pitch prediction...", file=sys.stderr)
        model_output, midi_data, note_events = predict(audio_path)
        print(f"[audio_to_midi] Prediction complete", file=sys.stderr)
        
        print(f"[audio_to_midi] Writing MIDI file...", file=sys.stderr)
        with open(output_path, 'wb') as f:
            midi_data.write(f)
        print(f"[audio_to_midi] MIDI file written", file=sys.stderr)
        
        notes = []
        instrument_count = len(midi_data.instruments) if midi_data.instruments else 0
        print(f"[audio_to_midi] MIDI has {instrument_count} instruments", file=sys.stderr)
        
        for note in midi_data.instruments[0].notes if midi_data.instruments else []:
            notes.append({
                "pitch": int(note.pitch),  # Convert to Python int for JSON serialization
                "start": float(note.start),
                "duration": float(note.end - note.start),
                "velocity": float(note.velocity)
            })
        
        print(f"[audio_to_midi] ✓ Extracted {len(notes)} notes for {instrument_name}", file=sys.stderr)
        
        return {
            "success": True,
            "midi_path": output_path,
            "notes": notes,
            "note_count": len(notes),
            "instrument": instrument_name
        }
    except Exception as e:
        print(f"[audio_to_midi] ✗ ERROR for {instrument_name}: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {
            "success": False,
            "error": str(e),
            "instrument": instrument_name
        }


def separate_audio_demucs(input_audio, output_dir, max_duration=300):
    """Separate audio into stems using Demucs"""
    print(f"[separate_audio_demucs] Called with input: {input_audio}", file=sys.stderr)
    print(f"[separate_audio_demucs] Output dir: {output_dir}", file=sys.stderr)
    print(f"[separate_audio_demucs] Demucs available: {DEMUCS_AVAILABLE}", file=sys.stderr)
    
    if not DEMUCS_AVAILABLE:
        print("[separate_audio_demucs] ERROR: Demucs is not installed!", file=sys.stderr)
        raise Exception("Demucs is not installed")
    
    try:
        print("[separate_audio_demucs] Loading Demucs model 'htdemucs'...", file=sys.stderr)
        model = get_model('htdemucs')
        model.eval()
        print(f"[separate_audio_demucs] Model loaded. Sample rate: {model.samplerate}", file=sys.stderr)
        print(f"[separate_audio_demucs] Model sources: {model.sources}", file=sys.stderr)
        
        # Load audio with max duration limit
        print(f"[separate_audio_demucs] Loading audio file...", file=sys.stderr)
        wav, sr = librosa.load(input_audio, sr=model.samplerate, mono=False, duration=max_duration)
        print(f"[separate_audio_demucs] Audio loaded. Shape: {wav.shape}, Sample rate: {sr}", file=sys.stderr)
        
        if wav.ndim == 1:
            print("[separate_audio_demucs] Converting mono to stereo...", file=sys.stderr)
            wav = np.stack([wav, wav])
            print(f"[separate_audio_demucs] New shape: {wav.shape}", file=sys.stderr)
        
        print("[separate_audio_demucs] Converting to tensor...", file=sys.stderr)
        wav_tensor = torch.from_numpy(wav).float()
        if wav_tensor.dim() == 2:
            wav_tensor = wav_tensor.unsqueeze(0)
        print(f"[separate_audio_demucs] Tensor shape: {wav_tensor.shape}", file=sys.stderr)
        
        print("[separate_audio_demucs] Applying Demucs model (this may take a while)...", file=sys.stderr)
        with torch.no_grad():
            sources = apply_model(model, wav_tensor, device='cpu', split=True, overlap=0.25)
        print(f"[separate_audio_demucs] Separation complete! Sources shape: {sources.shape}", file=sys.stderr)
        
        stems = {}
        stem_names = model.sources
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True, parents=True)
        print(f"[separate_audio_demucs] Saving {len(stem_names)} stems: {stem_names}", file=sys.stderr)
        
        for i, stem_name in enumerate(stem_names):
            stem_path = output_path / f"{stem_name}.wav"
            print(f"[separate_audio_demucs] Saving stem {i+1}/{len(stem_names)}: {stem_name} to {stem_path}", file=sys.stderr)
            # demucs.audio.save_audio expects samplerate as positional arg in many versions
            save_audio(sources[0, i], str(stem_path), model.samplerate)
            stems[stem_name] = str(stem_path)
            print(f"[separate_audio_demucs] ✓ Saved {stem_name}", file=sys.stderr)
        
        print(f"[separate_audio_demucs] All stems saved successfully! Total: {len(stems)}", file=sys.stderr)
        return stems
    except Exception as e:
        print(f"[separate_audio_demucs] ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        raise Exception(f"Demucs separation failed: {str(e)}")


def process_audio(input_file, output_dir, use_demucs=True, max_duration=300):
    """Main processing function"""
    print(f"\n=== AUDIO PROCESSOR STARTED ===", file=sys.stderr)
    print(f"Input file: {input_file}", file=sys.stderr)
    print(f"Output dir: {output_dir}", file=sys.stderr)
    print(f"Use Demucs: {use_demucs}", file=sys.stderr)
    print(f"Max duration: {max_duration} seconds", file=sys.stderr)
    
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True, parents=True)
    
    results = {"success": False, "tracks": [], "error": None}
    
    try:
        # First, transcribe the original audio
        print("\n[STEP 1] Transcribing original audio...", file=sys.stderr)
        original_midi_path = output_path / "original.mid"
        print(f"Original MIDI will be saved to: {original_midi_path}", file=sys.stderr)
        
        original_result = audio_to_midi(input_file, str(original_midi_path), "original", max_duration)
        print(f"Original transcription result: success={original_result['success']}", file=sys.stderr)
        
        if original_result["success"]:
            track_data = {
                "stem": "original",
                "audio_path": f"/audio/{os.path.basename(input_file)}",
                "midi_path": f"/midi/{os.path.basename(original_midi_path)}",
                "notes": original_result["notes"],
                "note_count": original_result["note_count"],
                "instrument": "transcribed"
            }
            results["tracks"].append(track_data)
            print(f"✓ Original audio transcribed: {original_result['note_count']} notes", file=sys.stderr)
        else:
            print(f"✗ Original transcription failed: {original_result.get('error', 'Unknown error')}", file=sys.stderr)
        
        if use_demucs and DEMUCS_AVAILABLE:
            print("\n[STEP 2] Starting Demucs separation...", file=sys.stderr)
            print(f"Demucs available: {DEMUCS_AVAILABLE}", file=sys.stderr)
            
            stems = separate_audio_demucs(input_file, output_dir, max_duration)
            print(f"✓ Separated into {len(stems)} stems: {list(stems.keys())}", file=sys.stderr)
            
            print("\n[STEP 3] Converting stems to MIDI...", file=sys.stderr)
            for i, (stem_name, stem_path) in enumerate(stems.items()):
                print(f"\nProcessing stem {i+1}/{len(stems)}: {stem_name}", file=sys.stderr)
                if not os.path.exists(stem_path):
                    print(f"  ✗ Stem file does not exist: {stem_path}", file=sys.stderr)
                    continue
                
                # Load just a small sample to check if stem is silent
                print(f"  Checking if stem is silent...", file=sys.stderr)
                y_sample, sr = librosa.load(stem_path, sr=22050, duration=5.0)
                max_amplitude = np.max(np.abs(y_sample))
                rms_amplitude = np.sqrt(np.mean(y_sample**2))
                print(f"  Max amplitude: {max_amplitude:.6f}, RMS: {rms_amplitude:.6f}", file=sys.stderr)
                
                # Lower threshold to 0.001 to avoid skipping quiet stems
                if max_amplitude < 0.001:
                    print(f"  ✗ Skipping silent stem: {stem_name} (max amp {max_amplitude:.6f} < 0.001)", file=sys.stderr)
                    continue
                else:
                    print(f"  ✓ Stem {stem_name} has sufficient audio (max amp {max_amplitude:.6f})", file=sys.stderr)
                
                # Map stem to instrument type
                instrument_type = stem_name
                if stem_name == "other":
                    instrument_type = "transcribed"  # Other stems go to transcribed category
                
                print(f"  Converting {stem_name} to MIDI...", file=sys.stderr)
                midi_path = output_path / f"{stem_name}.mid"
                print(f"  MIDI output path: {midi_path}", file=sys.stderr)
                
                midi_result = audio_to_midi(stem_path, str(midi_path), instrument_type, max_duration)
                print(f"  Conversion result: success={midi_result['success']}, notes={midi_result.get('note_count', 0)}", file=sys.stderr)
                
                if midi_result["success"]:
                    results["tracks"].append({
                        "stem": stem_name,
                        "instrument": instrument_type,
                        "midi_path": str(midi_path),
                        "audio_path": stem_path,
                        "notes": midi_result["notes"],
                        "note_count": midi_result["note_count"]
                    })
                    print(f"  ✓ Converted {stem_name}: {midi_result['note_count']} notes", file=sys.stderr)
                else:
                    print(f"  ✗ Failed to convert {stem_name}: {midi_result.get('error', 'Unknown')}", file=sys.stderr)
        else:
            print("Processing without separation...", file=sys.stderr)
            instrument_type = classify_instrument(input_file)
            midi_path = output_path / "full.mid"
            midi_result = audio_to_midi(input_file, str(midi_path), instrument_type)
            
            if midi_result["success"]:
                results["tracks"].append({
                    "stem": "full",
                    "instrument": instrument_type,
                    "midi_path": str(midi_path),
                    "audio_path": input_file,
                    "notes": midi_result["notes"],
                    "note_count": midi_result["note_count"]
                })
        
        print(f"\n[FINAL] Total tracks created: {len(results['tracks'])}", file=sys.stderr)
        for i, track in enumerate(results["tracks"]):
            print(f"  Track {i+1}: {track['stem']} - {track['note_count']} notes", file=sys.stderr)
        
        results["success"] = len(results["tracks"]) > 0
        print(f"Overall success: {results['success']}", file=sys.stderr)
    except Exception as e:
        results["error"] = str(e)
        print(f"Processing error: {e}", file=sys.stderr)
    
    return results


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python audio_processor.py <input_file> <output_dir> [use_demucs]", file=sys.stderr)
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    use_demucs = sys.argv[3].lower() == 'true' if len(sys.argv) > 3 else True
    
    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}", file=sys.stderr)
        sys.exit(1)
    
    results = process_audio(input_file, output_dir, use_demucs)
    print(json.dumps(results))
