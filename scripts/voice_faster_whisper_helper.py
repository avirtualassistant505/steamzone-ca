#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


MODEL_NAME = "tiny.en"


def main() -> int:
    model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
            audio_path = Path(payload["audio"])
            prompt = payload.get("initial_prompt")
            language = payload.get("language", "en")
            if not audio_path.exists():
                raise FileNotFoundError(str(audio_path))
            segments, info = model.transcribe(
                str(audio_path),
                language=language,
                vad_filter=True,
                initial_prompt=prompt,
            )
            items = []
            full_text = []
            for seg in segments:
                text = (seg.text or "").strip()
                if not text:
                    continue
                items.append(
                    {
                        "start": round(float(seg.start), 2),
                        "end": round(float(seg.end), 2),
                        "text": text,
                    }
                )
                full_text.append(text)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "audio": str(audio_path),
                        "segments": items,
                        "text": " ".join(full_text).strip(),
                    }
                ),
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
