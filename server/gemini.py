"""Gemini provider: transcription from audio plus structured JSON, same prompts as Groq."""
import base64
import json
import os
import re
import time

import requests

BASE = "https://generativelanguage.googleapis.com/v1beta/models"
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
RETRY_STATUS = {429, 500, 502, 503, 504}

MIME = {
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
}


def _key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return key


def generate(parts: list[dict], system: str | None = None, json_mode: bool = True,
             max_tokens: int = 3500, temperature: float = 0.2, timeout: int = 600) -> str:
    body: dict = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    response = None
    for attempt in range(6):
        try:
            response = requests.post(
                f"{BASE}/{MODEL}:generateContent",
                headers={"x-goog-api-key": _key(), "Content-Type": "application/json"},
                json=body,
                timeout=timeout,
            )
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt == 5:
                raise RuntimeError(f"Gemini did not answer: {exc}") from exc
            time.sleep(min(2 ** attempt + 1, 30))
            continue
        if response.status_code not in RETRY_STATUS:
            break
        # capacity spikes are routine; wait them out instead of failing the video
        if attempt == 5:
            break
        time.sleep(min(2 ** attempt + 1, 30))

    if response.status_code >= 400:
        detail = response.text[:300]
        try:
            detail = response.json()["error"]["message"]
        except Exception:
            pass
        raise RuntimeError(f"Gemini {response.status_code}: {detail}")

    data = response.json()
    candidates = data.get("candidates") or []
    if not candidates:
        reason = data.get("promptFeedback", {}).get("blockReason", "no candidates")
        raise RuntimeError(f"Gemini returned nothing ({reason})")
    parts_out = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts_out).strip()
    if not text:
        raise RuntimeError("Gemini returned an empty answer")
    return text


def json_call(system: str, user: str, max_tokens: int = 3000) -> dict:
    raw = generate([{"text": user}], system=system, json_mode=True,
                   max_tokens=max_tokens, temperature=0.2)
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"Gemini returned no JSON: {raw[:200]}")
    return json.loads(raw[start:end + 1])


TRANSCRIBE_RULES = """Transcribe this audio exactly, word for word, and return JSON:
{"language": "<ISO 639-1 code>",
 "segments": [{"start": <seconds from the start of this audio, float>, "end": <float>, "text": "..."}]}

Rules:
- One segment per spoken sentence or short clause, 3 to 25 words.
- Times must increase and must fall inside the audio. Use decimals, e.g. 12.4.
- Keep filler words. Do not clean up, summarise, translate or add anything.
- If the audio is music or silence, return {"language": "en", "segments": []}.
- Output JSON only."""


def transcribe(path: str, language: str | None = None) -> dict:
    ext = os.path.splitext(path)[1].lower()
    mime = MIME.get(ext, "audio/mp4")
    with open(path, "rb") as handle:
        encoded = base64.b64encode(handle.read()).decode("ascii")

    prompt = TRANSCRIBE_RULES
    if language:
        prompt += f"\nThe expected language is {language}."

    raw = generate(
        [{"text": prompt}, {"inline_data": {"mime_type": mime, "data": encoded}}],
        json_mode=True,
        max_tokens=8192,
        temperature=0.0,
        timeout=900,
    )
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip()
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start:end + 1]) if start != -1 else {}

    rows = []
    for item in data.get("segments") or []:
        text = (item.get("text") or "").strip()
        if not text:
            continue
        start_s = float(item.get("start") or 0)
        end_s = float(item.get("end") or (start_s + 2))
        rows.append({
            "start_ms": int(max(start_s, 0) * 1000),
            "end_ms": int(max(end_s, start_s + 0.5) * 1000),
            "text": text,
        })
    rows.sort(key=lambda row: row["start_ms"])
    return {"language": data.get("language") or language, "segments": rows}
