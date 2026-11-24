"""Vishal API: one video in, a grounded reading surface out."""
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import db  # noqa: E402
import fetch  # noqa: E402
import llm  # noqa: E402
import pipeline  # noqa: E402

TOKEN = os.environ.get("API_TOKEN", "")
POOL = ThreadPoolExecutor(max_workers=1)

app = FastAPI(title="Vishal", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def auth(authorization: str | None = Header(default=None)) -> None:
    if not TOKEN:
        return
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Missing or wrong token")


@app.on_event("startup")
def startup() -> None:
    db.init()
    for row in db.list_videos():
        pass
    with db.db() as con:
        stuck = con.execute(
            "SELECT id FROM videos WHERE status IN ('queued','processing')").fetchall()
    for row in stuck:
        POOL.submit(pipeline.run, row["id"])


class AddVideo(BaseModel):
    url: str


class CategoryBody(BaseModel):
    category: str


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": llm.SUMMARY_MODEL, "asr": llm.ASR_MODEL,
            "provider": llm.PROVIDER,
            "groq_key": bool(os.environ.get("GROQ_API_KEY")),
            "model_key": bool(os.environ.get("GROQ_API_KEY") or os.environ.get("GEMINI_API_KEY"))}


@app.get("/categories")
def categories(_: None = Depends(auth)) -> dict:
    return {"categories": llm.CATEGORIES}


@app.post("/videos")
def add_video(body: AddVideo, _: None = Depends(auth)) -> dict:
    youtube_id = fetch.parse_youtube_id(body.url)
    if not youtube_id:
        raise HTTPException(status_code=422, detail="That is not a YouTube link I can read.")
    row, created = db.claim_video(youtube_id, body.url)
    if row is None:
        raise HTTPException(status_code=500, detail="Could not create the video record")
    if created:
        POOL.submit(pipeline.run, row["id"])
        return {"video": row, "reused": False}
    if row["status"] in ("queued", "processing"):
        return {"video": row, "reused": True}
    if row["status"] == "ready":
        return {"video": row, "reused": True}
    # a previous attempt failed: queue it again
    db.set_status(row["id"], "queued", "queued", 0.0, None)
    POOL.submit(pipeline.run, row["id"])
    return {"video": db.get_video(row["id"]), "reused": True}


@app.get("/videos")
def videos(q: str | None = None, category: str | None = None,
           _: None = Depends(auth)) -> dict:
    return {"videos": db.list_videos(q, category)}


@app.get("/videos/{video_id}")
def video(video_id: str, _: None = Depends(auth)) -> dict:
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(status_code=404, detail="No such video")
    return {"video": row}


@app.get("/videos/{video_id}/reader")
def reader(video_id: str, _: None = Depends(auth)) -> dict:
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(status_code=404, detail="No such video")
    if row["status"] != "ready":
        return {"video": row, "segments": [], "moments": [], "takeaways": []}
    return {
        "video": row,
        "segments": db.segments(video_id),
        "moments": db.moments(video_id),
        "takeaways": db.takeaways(video_id),
    }


@app.post("/videos/{video_id}/retry")
def retry(video_id: str, _: None = Depends(auth)) -> dict:
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(status_code=404, detail="No such video")
    db.set_status(video_id, "queued", "queued", 0.0, None)
    POOL.submit(pipeline.run, video_id)
    return {"video": db.get_video(video_id)}


@app.patch("/videos/{video_id}")
def set_category(video_id: str, body: CategoryBody, _: None = Depends(auth)) -> dict:
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(status_code=404, detail="No such video")
    if body.category not in llm.CATEGORIES:
        raise HTTPException(status_code=422, detail="Unknown category")
    db.save_meta(video_id, category=body.category, category_confidence=1.0, category_locked=1)
    return {"video": db.get_video(video_id)}


@app.delete("/videos/{video_id}")
def delete_video(video_id: str, _: None = Depends(auth)) -> dict:
    with db.db() as con:
        for table in ("segments", "moments", "takeaways", "videos"):
            con.execute(f"DELETE FROM {table} WHERE {'id' if table == 'videos' else 'video_id'} = ?",
                        (video_id,))
    return {"deleted": video_id}
