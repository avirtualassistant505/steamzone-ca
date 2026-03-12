#!/usr/bin/env python3
"""Build a timed WAV for Chromium fake-audio voice regressions.

Example:
  python3 scripts/voice_build_fake_sequence.py \
    --timeline-json tmp/example.json \
    --duration-ms 90000 \
    --output tmp/example.wav
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path


def run(cmd):
    subprocess.run(cmd, check=True)


def synthesize(text: str, out_wav: Path) -> None:
    aiff = out_wav.with_suffix(".aiff")
    run(["say", "-v", "Samantha", "-r", "165", "-o", str(aiff), text])
    run(["ffmpeg", "-y", "-i", str(aiff), "-ac", "1", "-ar", "48000", str(out_wav)])
    aiff.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a timed fake-call WAV from offset/text clips.")
    parser.add_argument("--timeline-json", required=True, help="JSON file containing [{offsetMs, text}]")
    parser.add_argument("--duration-ms", type=int, required=True, help="Total output duration")
    parser.add_argument("--output", required=True, help="Output WAV path")
    args = parser.parse_args()

    timeline = json.loads(Path(args.timeline_json).read_text())
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="voice-fake-") as td:
        tmpdir = Path(td)
        inputs = []
        filters = []
        mix_inputs = ["[0:a]"]

        for idx, item in enumerate(timeline):
            clip = tmpdir / f"clip_{idx}.wav"
            synthesize(item["text"], clip)
            inputs.extend(["-i", str(clip)])
            delay = max(0, int(item["offsetMs"]))
            filters.append(f"[{idx + 1}:a]adelay={delay}|{delay},volume=2.2[a{idx}]")
            mix_inputs.append(f"[a{idx}]")

        filters.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:normalize=0,volume=1.4[out]")

        run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"anullsrc=r=48000:cl=mono:d={args.duration_ms / 1000}",
                *inputs,
                "-filter_complex",
                ";".join(filters),
                "-map",
                "[out]",
                "-ac",
                "1",
                "-ar",
                "48000",
                str(output),
            ]
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
