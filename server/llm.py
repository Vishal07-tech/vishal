"""Groq-hosted open weights: Whisper large-v3-turbo for speech, Qwen3-32B for structure.

Every model answer is forced back through a validator that checks the quote really
exists in the transcript at the claimed position. Unsupported claims are dropped,
never softened.
"""
import difflib
import json
import os
import re

from groq import Groq

ASR_MODEL = os.environ.get("ASR_MODEL", "whisper-large-v3-turbo")
SUMMARY_MODEL = os.environ.get("SUMMARY_MODEL", "qwen/qwen3-32b")

PROVIDER = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
if not PROVIDER:
    PROVIDER = "gemini" if os.environ.get("GEMINI_API_KEY") else "groq"
if PROVIDER == "gemini":
    SUMMARY_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
    ASR_MODEL = SUMMARY_MODEL  # the same model reads the audio and writes the notes

CATEGORIES = [
    "education", "self-improvement", "sports", "entertainment", "technology",
    "health", "finance", "news", "business", "science", "other",
]

_client: Groq | None = None


def client() -> Groq:
    global _client
    if _client is None:
        key = os.environ.get("GROQ_API_KEY")
        if not key:
            raise RuntimeError("GROQ_API_KEY is not set")
        _client = Groq(api_key=key)
    return _client


# ---------------------------------------------------------------- transcription

def transcribe(path: str, language: str | None = None) -> dict:
    if PROVIDER == "gemini":
        import gemini
        return gemini.transcribe(path, language)
    with open(path, "rb") as fh:
        resp = client().audio.transcriptions.create(
            file=(os.path.basename(path), fh.read()),
            model=ASR_MODEL,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
            temperature=0,
            language=language or None,
        )
    data = resp if isinstance(resp, dict) else json.loads(resp.model_dump_json())
    segs = data.get("segments") or []
    out = []
    for s in segs:
        text = (s.get("text") or "").strip()
        if text:
            out.append({
                "start_ms": int(float(s.get("start", 0)) * 1000),
                "end_ms": int(float(s.get("end", 0)) * 1000),
                "text": text,
            })
    return {"language": data.get("language"), "segments": out}


# ---------------------------------------------------------------- prompting

SYSTEM = """You turn a video transcript into a faithful study outline.

Hard rules:
- Use only what the speaker says. Never add outside facts, numbers, names or opinions.
- Never speculate about intent, quality or what the speaker "probably" means.
- Every item must carry the segment number it came from and a verbatim quote from that segment.
- Quotes are copied exactly from the transcript line, 6 to 32 words. Never paraphrase a quote.
- If the transcript does not support an item, omit it. Empty lists are valid answers.
- Reply with one JSON object. No prose, no markdown fences, no commentary."""

CHUNK_SCHEMA = """{
  "notes":     [{"segment_idx": int, "quote": str, "note": str}],
  "moments":   [{"segment_idx": int, "quote": str, "title": str}],
  "takeaways": [{"segment_idx": int, "quote": str, "kind": "claim"|"definition"|"number"|"formula",
                 "text": str, "latex": str|null}]
}"""

FINAL_SCHEMA = """{
  "gist": str,
  "summary": str,
  "category": str,
  "category_confidence": number,
  "keep_moments": [int],
  "keep_takeaways": [int]
}"""


def _call(system: str, user: str, max_tokens: int = 4000) -> dict:
    if PROVIDER == "gemini":
        import gemini
        return gemini.json_call(system, user, max_tokens)
    resp = client().chat.completions.create(
        model=SUMMARY_MODEL,
        temperature=0.2,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    raw = resp.choices[0].message.content or "{}"
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"model returned no JSON: {raw[:200]}")
    return json.loads(raw[start:end + 1])


def _stamp(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}" if s >= 60 else f"00:{s:02d}"


def _lines(segments: list[dict]) -> str:
    return "\n".join(f"[{s['idx']}] {_stamp(s['start_ms'])} {s['text']}" for s in segments)


def chunk_segments(segments: list[dict], target_chars: int = 14000) -> list[list[dict]]:
    chunks, current, size = [], [], 0
    for seg in segments:
        if current and size + len(seg["text"]) > target_chars:
            chunks.append(current)
            current, size = [], 0
        current.append(seg)
        size += len(seg["text"]) + 12
    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------- validation

def _norm(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def quote_supported(quote: str, segments: list[dict], idx: int, window: int = 3) -> bool:
    """True when the quote appears in the transcript near where the model says it does."""
    q = _norm(quote)
    if len(q.split()) < 4:
        return False
    near = [s for s in segments if abs(s["idx"] - idx) <= window]
    if not near:
        return False
    hay = _norm(" ".join(s["text"] for s in near))
    if q in hay:
        return True
    # tolerate ASR punctuation drift and small elisions
    words = q.split()
    for n in range(len(words), max(4, len(words) // 2), -2):
        probe = " ".join(words[:n])
        if probe in hay:
            return True
    return difflib.SequenceMatcher(None, q, hay).ratio() >= 0.62 and len(q) < len(hay) + 40


def validate_chunk(result: dict, segments: list[dict]) -> dict:
    ids = {s["idx"] for s in segments}
    by_idx = {s["idx"]: s for s in segments}
    out = {"notes": [], "moments": [], "takeaways": []}

    def take(item, keys):
        idx = item.get("segment_idx")
        quote = (item.get("quote") or "").strip()
        if not isinstance(idx, int) or idx not in ids or not quote:
            return None
        if not quote_supported(quote, segments, idx):
            return None
        base = {"segment_idx": idx, "quote": quote, "start_ms": by_idx[idx]["start_ms"]}
        for k in keys:
            base[k] = item.get(k)
        return base

    for item in result.get("notes") or []:
        if isinstance(item, dict) and (row := take(item, ["note"])) and row.get("note"):
            out["notes"].append(row)

    for item in result.get("moments") or []:
        if isinstance(item, dict) and (row := take(item, ["title"])) and row.get("title"):
            out["moments"].append(row)

    for item in result.get("takeaways") or []:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind not in ("claim", "definition", "number", "formula"):
            continue
        row = take(item, ["kind", "text", "latex"])
        if not row or not row.get("text"):
            continue
        if kind == "formula" and not row.get("latex"):
            continue
        out["takeaways"].append(row)
    return out


# ---------------------------------------------------------------- passes

def analyse_chunk(segments: list[dict], language: str, part: int, total: int) -> dict:
    user = f"""Video language: {language or "unknown"}.
This is part {part} of {total} of the transcript. Lines are numbered [segment] mm:ss text.

{_lines(segments)}

Return JSON exactly in this shape:
{CHUNK_SCHEMA}

Guidance:
- notes: 2 to 4 things the speaker actually asserts or explains here.
- moments: 1 to 3 places where the argument turns, a claim lands, or a concrete example starts.
- takeaways: only durable, reusable content: definitions, numbers, formulas, or a rule the viewer should keep.
- If a formula is spoken or written out, put it in LaTeX in "latex" (no dollar signs) and keep "text" as a plain reading.
- Coordinates, prices and statistics go in kind "number"."""
    result = _call(SYSTEM, user, max_tokens=3500)
    return validate_chunk(result, segments)


def _describe(candidates: list[dict], limit: int) -> str:
    lines = []
    for i, row in enumerate(candidates[:limit], 1):
        label = row.get("title") or row.get("text")
        lines.append(f"{i}. [{_stamp(row['start_ms'])}] {label} — \"{row['quote'][:120]}\"")
    return "\n".join(lines)


def finish(video: dict, notes: list[dict], moments: list[dict], takeaways: list[dict],
           language: str) -> dict:
    cats = ", ".join(CATEGORIES)
    user = f"""Video: {video.get("title")} — {video.get("channel")}
Language of the transcript: {language or "unknown"}

Notes gathered from the transcript:
{chr(10).join(f"- {n['note']} (from [{n['segment_idx']}])" for n in notes[:60])}

Candidate moments:
{_describe(moments, 40)}

Candidate takeaways:
{_describe(takeaways, 30)}

Categories: {cats}

Return JSON exactly in this shape:
{FINAL_SCHEMA}

Rules:
- gist: one sentence under 18 words, what the viewer actually gets.
- summary: 140 to 220 words in the transcript's language. Only claims present in the notes. No advice, no outside context, no "this video explains". Start with the substance.
- category: one from the list.
- keep_moments: indexes (1-based) of at most 12 candidates worth marking, in playback order.
- keep_takeaways: indexes (1-based) of at most 8, in playback order.
- Prefer precision over coverage. Drop anything you cannot trace to a note."""
    result = _call(SYSTEM, user, max_tokens=2500)
    category = str(result.get("category") or "other").strip().lower()
    if category not in CATEGORIES:
        category = "other"
    return {
        "gist": (result.get("gist") or "").strip(),
        "summary": (result.get("summary") or "").strip(),
        "category": category,
        "category_confidence": float(result.get("category_confidence") or 0.0),
        "keep_moments": [i for i in result.get("keep_moments") or [] if isinstance(i, int)],
        "keep_takeaways": [i for i in result.get("keep_takeaways") or [] if isinstance(i, int)],
    }
