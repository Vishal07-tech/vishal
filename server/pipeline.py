"""The job: fetch, transcribe, structure, validate, store."""
import os
import shutil
import traceback

import db
import fetch
import llm

WORKROOT = os.environ.get("WORK_ROOT", os.path.join(os.path.dirname(__file__), "data", "work"))


def run(video_id: str) -> None:
    video = db.get_video(video_id)
    if not video:
        return
    yid = video["youtube_id"]
    workdir = os.path.join(WORKROOT, video_id)
    os.makedirs(workdir, exist_ok=True)
    stage = "metadata"
    try:
        db.set_status(video_id, "processing", "metadata", 0.04)

        meta = fetch.metadata(yid)
        db.save_meta(video_id, title=meta["title"], channel=meta["channel"],
                     duration_s=meta["duration_s"])

        # ---- tier 1: audio download, tier 2: platform captions
        segments: list[dict] = []
        tier = None
        stage = "fetching"
        db.set_status(video_id, "processing", "fetching", 0.1)
        try:
            audio = fetch.download_audio(yid, workdir)
            tier = "audio"
        except Exception:
            audio = None
            segments = fetch.download_captions(yid, workdir)
            if segments:
                tier = "captions"
            else:
                raise RuntimeError(
                    "Could not fetch this video. YouTube refused the download and no captions were available.")

        db.save_meta(video_id, fetch_tier=tier)
        language = meta.get("language")

        if tier == "audio":
            stage = "transcribing"
            db.set_status(video_id, "processing", "transcribing", 0.2)
            # Gemini returns one JSON document per piece. Five-minute pieces keep
            # that document well under the model's output limit and give the Fly
            # machine smaller units of work to resume after a suspend.
            chunk_s = 300 if llm.PROVIDER == "gemini" else 600
            parts = fetch.split_audio(audio, workdir, force=(llm.PROVIDER == "gemini"),
                                      chunk_s=chunk_s)
            # A Fly machine can be suspended or stopped mid-job. Finished pieces
            # are kept in SQLite so the next run resumes instead of paying for
            # every transcription again.
            saved = db.transcript_parts(video_id, chunk_s)
            offset_ms = 0
            collected: list[dict] = []
            for i, part in enumerate(parts):
                cached = saved.get(i)
                if cached and isinstance(cached.get("payload"), dict):
                    result = cached["payload"]
                else:
                    result = llm.transcribe(part, language=language)
                    part_language = result.get("language") or language
                    db.save_transcript_part(video_id, i, chunk_s, part_language, result)
                    saved[i] = {"language": part_language, "payload": result}
                language = language or result.get("language") or (cached or {}).get("language")
                for seg in result.get("segments") or []:
                    collected.append({
                        "start_ms": seg["start_ms"] + offset_ms,
                        "end_ms": seg["end_ms"] + offset_ms,
                        "text": seg["text"],
                    })
                # Use the real chunk length: splitting at key frames is not always
                # exactly 600 seconds, and fixed offsets drift on long videos.
                offset_ms += int((fetch.media_duration(part) or 600) * 1000)
                db.set_status(video_id, "processing", "transcribing",
                              0.2 + 0.35 * (i + 1) / len(parts))
            segments = [{"idx": i, **row} for i, row in enumerate(_dedupe(collected))]
            segments = _clamp(segments, meta.get("duration_s") or 0)

        chars = len(" ".join(s["text"] for s in segments))
        if chars < 400:
            raise RuntimeError(
                f"The transcript came back too short ({chars} characters from {tier or 'captions'}). "
                "Try another video.")

        db.save_meta(video_id, language=language)
        db.replace_segments(video_id, segments)

        # ---- structure
        stage = "summarising"
        db.set_status(video_id, "processing", "summarising", 0.6)
        chunks = llm.chunk_segments(segments)
        notes: list[dict] = []
        moments: list[dict] = []
        takeaways: list[dict] = []
        for i, chunk in enumerate(chunks):
            part = llm.analyse_chunk(chunk, language or "unknown", i + 1, len(chunks))
            notes.extend(part["notes"])
            moments.extend(part["moments"])
            takeaways.extend(part["takeaways"])
            db.set_status(video_id, "processing", "summarising",
                          0.6 + 0.25 * (i + 1) / len(chunks))

        if not notes:
            raise RuntimeError("No grounded notes could be extracted from this transcript.")

        final = llm.finish({**video, "title": meta["title"], "channel": meta["channel"]},
                           notes, moments, takeaways, language or "english")

        def pick(candidates: list[dict], keep: list[int], cap: int) -> list[dict]:
            chosen = [candidates[i - 1] for i in keep if 0 < i <= len(candidates)]
            if not chosen:
                chosen = candidates[:cap]
            chosen.sort(key=lambda r: r["start_ms"])
            return chosen[:cap]

        kept_moments = pick(moments, final["keep_moments"], 12)
        kept_takeaways = pick(takeaways, final["keep_takeaways"], 8)

        db.replace_moments(video_id, kept_moments)
        db.replace_takeaways(video_id, kept_takeaways)
        db.save_meta(video_id, gist=final["gist"], summary=final["summary"],
                     summary_lang=language, category=final["category"],
                     category_confidence=final["category_confidence"])
        db.set_status(video_id, "ready", "done", 1.0)
        db.clear_transcript_parts(video_id)
    except Exception as exc:  # surface the reason to the app instead of a bare 500
        db.set_status(video_id, "failed", stage, None, str(exc)[:400])
        print(f"[pipeline] {video_id} failed: {exc}\n{traceback.format_exc()}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _clamp(rows: list[dict], duration_s: float) -> list[dict]:
    """Model-estimated times can overshoot the video; keep every marker inside it."""
    if not duration_s:
        return rows
    limit = int(duration_s * 1000)
    out = []
    for row in rows:
        start = min(int(row["start_ms"]), max(limit - 800, 0))
        end = min(max(int(row["end_ms"]), start + 500), limit)
        out.append({**row, "start_ms": start, "end_ms": end})
    return out


def _dedupe(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for row in rows:
        text = row["text"].strip()
        if not text:
            continue
        if out and (text == out[-1]["text"] or out[-1]["text"].endswith(text)):
            continue
        if out and row["start_ms"] <= out[-1]["start_ms"]:
            row["start_ms"] = out[-1]["end_ms"]
        out.append({**row, "text": text})
    return out
