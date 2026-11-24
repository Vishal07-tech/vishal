"""SQLite storage. One file, WAL, opened per call so threads never share a handle."""
import os
import sqlite3
import time
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "data", "app.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,
  youtube_id    TEXT UNIQUE NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT,
  channel       TEXT,
  duration_s    INTEGER,
  language      TEXT,
  category      TEXT,
  category_confidence REAL DEFAULT 0,
  category_locked INTEGER DEFAULT 0,
  fetch_tier    TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  stage         TEXT,
  progress      REAL DEFAULT 0,
  error         TEXT,
  gist          TEXT,
  summary       TEXT,
  summary_lang  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  video_id TEXT NOT NULL,
  idx      INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms   INTEGER NOT NULL,
  text     TEXT NOT NULL,
  PRIMARY KEY (video_id, idx)
);
CREATE INDEX IF NOT EXISTS segments_video ON segments(video_id, start_ms);

CREATE TABLE IF NOT EXISTS moments (
  video_id    TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  start_ms    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  quote       TEXT NOT NULL,
  note        TEXT,
  segment_idx INTEGER NOT NULL,
  PRIMARY KEY (video_id, idx)
);

CREATE TABLE IF NOT EXISTS takeaways (
  video_id    TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  latex       TEXT,
  start_ms    INTEGER NOT NULL,
  segment_idx INTEGER NOT NULL,
  quote       TEXT,
  PRIMARY KEY (video_id, idx)
);
"""


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


@contextmanager
def db():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init() -> None:
    with db() as con:
        con.executescript(SCHEMA)


def get_video(video_id: str) -> dict | None:
    with db() as con:
        row = con.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
        return dict(row) if row else None


def list_videos(query: str | None = None, category: str | None = None) -> list[dict]:
    sql = "SELECT * FROM videos WHERE status = 'ready'"
    args: list = []
    if category:
        sql += " AND category = ?"
        args.append(category)
    if query:
        sql += """ AND (
            lower(coalesce(title,'')) LIKE ? OR lower(coalesce(channel,'')) LIKE ?
            OR lower(coalesce(summary,'')) LIKE ?
            OR id IN (SELECT video_id FROM segments WHERE lower(text) LIKE ?)
        )"""
        like = f"%{query.lower()}%"
        args.extend([like, like, like, like])
    sql += " ORDER BY created_at DESC"
    with db() as con:
        return [dict(r) for r in con.execute(sql, args).fetchall()]


def segments(video_id: str) -> list[dict]:
    with db() as con:
        return [dict(r) for r in con.execute(
            "SELECT idx, start_ms, end_ms, text FROM segments WHERE video_id = ? ORDER BY idx",
            (video_id,)).fetchall()]


def moments(video_id: str) -> list[dict]:
    with db() as con:
        return [dict(r) for r in con.execute(
            "SELECT idx, start_ms, title, quote, note, segment_idx FROM moments WHERE video_id = ? ORDER BY start_ms",
            (video_id,)).fetchall()]


def takeaways(video_id: str) -> list[dict]:
    with db() as con:
        return [dict(r) for r in con.execute(
            "SELECT idx, kind, text, latex, start_ms, segment_idx, quote FROM takeaways WHERE video_id = ? ORDER BY start_ms",
            (video_id,)).fetchall()]


def set_status(video_id: str, status: str, stage: str | None = None,
               progress: float | None = None, error: str | None = None) -> None:
    with db() as con:
        con.execute(
            """UPDATE videos SET status = ?, stage = ?, progress = coalesce(?, progress),
               error = ?, updated_at = ? WHERE id = ?""",
            (status, stage, progress, error, now(), video_id))


def save_meta(video_id: str, **fields) -> None:
    allowed = {"title", "channel", "duration_s", "language", "fetch_tier", "category",
               "category_confidence", "category_locked", "gist", "summary", "summary_lang"}
    sets = {k: v for k, v in fields.items() if k in allowed}
    if not sets:
        return
    cols = ", ".join(f"{k} = ?" for k in sets)
    with db() as con:
        con.execute(f"UPDATE videos SET {cols}, updated_at = ? WHERE id = ?",
                    (*sets.values(), now(), video_id))


def replace_segments(video_id: str, rows: list[dict]) -> None:
    with db() as con:
        con.execute("DELETE FROM segments WHERE video_id = ?", (video_id,))
        con.executemany(
            "INSERT INTO segments (video_id, idx, start_ms, end_ms, text) VALUES (?,?,?,?,?)",
            [(video_id, r["idx"], r["start_ms"], r["end_ms"], r["text"]) for r in rows])


def replace_moments(video_id: str, rows: list[dict]) -> None:
    with db() as con:
        con.execute("DELETE FROM moments WHERE video_id = ?", (video_id,))
        con.executemany(
            "INSERT INTO moments (video_id, idx, start_ms, title, quote, note, segment_idx) VALUES (?,?,?,?,?,?,?)",
            [(video_id, i, r["start_ms"], r["title"], r["quote"], r.get("note"), r["segment_idx"])
             for i, r in enumerate(rows)])


def replace_takeaways(video_id: str, rows: list[dict]) -> None:
    with db() as con:
        con.execute("DELETE FROM takeaways WHERE video_id = ?", (video_id,))
        con.executemany(
            """INSERT INTO takeaways (video_id, idx, kind, text, latex, start_ms, segment_idx, quote)
               VALUES (?,?,?,?,?,?,?,?)""",
            [(video_id, i, r["kind"], r["text"], r.get("latex"), r["start_ms"], r["segment_idx"],
              r.get("quote")) for i, r in enumerate(rows)])


def claim_video(youtube_id: str, url: str) -> tuple[dict | None, bool]:
    """Return (row, created). `created` tells the caller to hand the job to the worker."""
    with db() as con:
        existing = con.execute("SELECT * FROM videos WHERE youtube_id = ?", (youtube_id,)).fetchone()
        if existing:
            return dict(existing), False
        vid = os.urandom(8).hex()
        ts = now()
        con.execute(
            """INSERT INTO videos (id, youtube_id, url, status, stage, created_at, updated_at)
               VALUES (?,?,?,'queued','queued',?,?)""",
            (vid, youtube_id, url, ts, ts))
    # read it back after the transaction commits, otherwise a second connection sees nothing
    return get_video(vid), True
