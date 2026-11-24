"""Getting audio and captions out of a YouTube link, in fallback tiers.

Tier 1: yt-dlp audio download, transcribed by Whisper. Best quality.
Tier 2: YouTube's own captions. Works from datacentre IPs where downloads are blocked;
        the text is punctuated later by the summariser pass, without adding words.
"""
import glob
import json
import os
import re
import subprocess
import sys

import yt_dlp

YOUTUBE_ID = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def parse_youtube_id(url: str) -> str | None:
    m = YOUTUBE_ID.search(url.strip())
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url.strip()):
        return url.strip()
    return None


def ffmpeg_path() -> str:
    env = os.environ.get("FFMPEG_PATH")
    if env and os.path.exists(env):
        return env
    for pattern in (r"D:\vishal\tools\ffmpeg\**\bin\ffmpeg.exe", "ffmpeg", "/usr/bin/ffmpeg"):
        hits = glob.glob(pattern, recursive=True) if "*" in pattern else []
        if hits:
            return hits[0]
    return "ffmpeg"


def _base_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "no_playlist": True,
        "noprogress": True,
        "retries": 3,
        "socket_timeout": 30,
    }
    cookiefile = os.environ.get("YT_COOKIES_FILE")
    if cookiefile and os.path.exists(cookiefile):
        opts["cookiefile"] = cookiefile
    return opts


def metadata(youtube_id: str) -> dict:
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    with yt_dlp.YoutubeDL(_base_opts()) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "duration_s": int(info.get("duration") or 0),
        "language": info.get("language"),
    }


def download_audio(youtube_id: str, workdir: str) -> str:
    os.makedirs(workdir, exist_ok=True)
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    opts = _base_opts()
    opts.update({
        "format": "bestaudio/best",
        "outtmpl": os.path.join(workdir, "audio.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a",
                            "preferredquality": "64"}],
        "ffmpeg_location": os.path.dirname(ffmpeg_path()),
    })
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    for ext in ("m4a", "webm", "opus", "mp3", "wav"):
        p = os.path.join(workdir, f"audio.{ext}")
        if os.path.exists(p):
            return p
    raise RuntimeError("audio download produced no file")


def download_captions(youtube_id: str, workdir: str) -> list[dict]:
    """Return [{idx,start_ms,end_ms,text}] from YouTube captions, or [] when unavailable."""
    os.makedirs(workdir, exist_ok=True)
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    opts = _base_opts()
    opts.update({
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-orig", "en-US", "hi", "en-GB"],
        "subtitlesformat": "json3/vtt/best",
        "outtmpl": os.path.join(workdir, "cap.%(ext)s"),
    })
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception:
        pass
    files = sorted(glob.glob(os.path.join(workdir, "cap*.*")))
    for path in files:
        if path.endswith(".json3"):
            rows = _parse_json3(path)
        elif path.endswith(".vtt"):
            rows = _parse_vtt(path)
        else:
            continue
        if rows:
            return rows
    return []


def _txt(segs) -> str:
    return "".join(s.get("utf8", "") for s in segs or []).replace("\n", " ").strip()


def _parse_json3(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    rows, last = [], ""
    for ev in data.get("events", []):
        if "segs" not in ev:
            continue
        text = _txt(ev["segs"])
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text == last:
            continue
        last = text
        start = int(ev.get("tStartMs", 0))
        dur = int(ev.get("dDurationMs", 0))
        rows.append({"idx": len(rows), "start_ms": start, "end_ms": start + max(dur, 800), "text": text})
    return _merge(rows)


def _ts(value: str) -> int:
    h, m, rest = value.split(":")
    s, ms = (rest.split(".") + ["0"])[:2]
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(ms.ljust(3, "0")[:3])


def _parse_vtt(path: str) -> list[dict]:
    rows, last = [], ""
    with open(path, encoding="utf-8", errors="ignore") as fh:
        lines = [ln.rstrip("\ufeff\n") for ln in fh]
    i = 0
    while i < len(lines):
        line = lines[i]
        if "-->" in line:
            times = line.split("-->")
            try:
                start, end = _ts(times[0].strip()), _ts(times[1].strip().split(" ")[0])
            except ValueError:
                i += 1
                continue
            i += 1
            buf = []
            while i < len(lines) and lines[i].strip():
                buf.append(lines[i])
                i += 1
            text = re.sub(r"<[^>]+>", "", " ".join(buf))
            text = re.sub(r"\s+", " ", text).strip()
            if text and text != last:
                last = text
                rows.append({"idx": len(rows), "start_ms": start, "end_ms": max(end, start + 800), "text": text})
        i += 1
    return _merge(rows)


def _merge(rows: list[dict]) -> list[dict]:
    """Caption cues are short; glue neighbours into ~15s readable segments."""
    out: list[dict] = []
    for row in rows:
        if out and row["start_ms"] - out[-1]["start_ms"] < 15000 and len(out[-1]["text"]) < 220:
            out[-1]["text"] = (out[-1]["text"] + " " + row["text"]).strip()
            out[-1]["end_ms"] = row["end_ms"]
        else:
            out.append({**row, "idx": len(out)})
    return out


def split_audio(path: str, workdir: str, max_bytes: int = 22 * 1024 * 1024,
                force: bool = False, chunk_s: int = 600) -> list[str]:
    """Whisper uploads cap out around 25 MB; Gemini takes ten-minute pieces with offsets."""
    if not force and os.path.getsize(path) <= max_bytes:
        return [path]
    pattern = os.path.join(workdir, "part-%03d.m4a")
    subprocess.run(
        [ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-i", path,
         "-f", "segment", "-segment_time", str(chunk_s), "-c", "copy", pattern],
        check=True, timeout=1800)
    parts = sorted(glob.glob(os.path.join(workdir, "part-*.m4a")))
    if not parts:
        raise RuntimeError("ffmpeg produced no audio segments")
    return parts
