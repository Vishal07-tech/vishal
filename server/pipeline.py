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
            parts = fetch.split_audio(audio, workdir, force=(llm.PROVIDER == "gemini"),
                                      chunk_s=600)
            offset_ms = 0
            collected: list[dict] = []
            for i, part in enumerate(parts):
                result = llm.transcribe(part, language=language)
                language = language or result.get("language")
                for seg in result["segments"]:
                    collected.append({
                        "start_ms": seg["start_ms"] + offset_ms,
                        "end_ms": seg["end_ms"] + offset_ms,
                        "text": seg["text"],
                    })
                offset_ms += 600_000 if len(parts) > 1 else 0
                db.set_status(video_id, "processing", "transcribing",
                              0.2 + 0.35 * (i + 1) / len(parts))
            segments = [{"idx": i, **row} for i, row in enumerate(_dedupe(collected))]

        if len(" ".join(s["text"] for s in segments)) < 400:
            raise RuntimeError("The transcript came back too short to summarise. Try another video.")

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
    except Exception as exc:  # surface the reason to the app instead of a bare 500
        db.set_status(video_id, "failed", stage, None, str(exc)[:400])
        print(f"[pipeline] {video_id} failed: {exc}\n{traceback.format_exc()}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


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
