#!/usr/bin/env python3
"""
Separate MP3 into instrument WAV stems using Demucs.

This script is invoked from the Node.js backend to split an audio file into
individual stems (drums, bass, vocals, etc.).  It mirrors the utility provided
in the project briefing and ensures the output directory is populated with
16-bit WAV files that the frontend can present as draggable stems.
"""

import json
import os
import sys
from pathlib import Path
import librosa
import numpy as np
import soundfile as sf

try:
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
except ImportError:
    print("Demucs not found. Install with: pip install demucs torch", file=sys.stderr)
    sys.exit(1)


def separate_audio_demucs(input_audio, output_dir, max_duration=300):
    print(f"[Demucs] Loading model 'htdemucs'...", file=sys.stderr)
    model = get_model('htdemucs')
    model.eval()

    wav, _ = librosa.load(input_audio, sr=model.samplerate, mono=False, duration=max_duration)
    if wav.ndim == 1:
        wav = np.stack([wav, wav])

    wav_tensor = torch.from_numpy(wav).float()
    if wav_tensor.dim() == 2:
        wav_tensor = wav_tensor.unsqueeze(0)

    print(f"[Demucs] Running separation (CPU/MPS) ... this may take a while ...", file=sys.stderr)
    with torch.no_grad():
        sources = apply_model(model, wav_tensor, device='cpu', split=True, overlap=0.25)

    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True, parents=True)
    stems = {}

    for i, stem_name in enumerate(model.sources):
        stem_path = output_path / f"{stem_name}.wav"
        sf.write(str(stem_path), sources[0, i].t().cpu().numpy(), model.samplerate)
        stems[stem_name] = str(stem_path)
        print(f"Saved {stem_name} → {stem_path}", file=sys.stderr)

    print(f"All stems saved in '{output_dir}'", file=sys.stderr)
    return stems


def main():
    if len(sys.argv) < 2:
        print("Usage: songSplitter.py <input_audio> [output_dir]", file=sys.stderr)
        sys.exit(1)

    input_audio = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "output"

    if not os.path.exists(input_audio):
        print(f"Error: file not found: {input_audio}", file=sys.stderr)
        sys.exit(1)

    stems = separate_audio_demucs(input_audio, output_dir)
    # Print the stem map as JSON so the Node caller can parse it.
    print(json.dumps(stems))


if __name__ == "__main__":
    main()
