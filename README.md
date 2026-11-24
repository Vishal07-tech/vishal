# YouTube Recall

Paste a YouTube link, get a reading page: a grounded summary, timestamped key moments that open the video at that second, and the formulas and numbers worth keeping.

Built with Expo (Android APK via EAS) and a small FastAPI backend.

## What it does

1. You paste a YouTube URL.
2. The server downloads the audio (`yt-dlp`), splits it into ten-minute pieces, and transcribes it.
3. Three passes turn the transcript into notes, key moments, and takeaways.
4. Every item must carry the segment it came from and a verbatim quote. A validator checks the quote against the transcript; anything unsupported is dropped, never reworded.
5. The app shows the summary, the moments (tap to open YouTube at that second), the takeaways with LaTeX formulas, and the full transcript.

Nothing is added that the speaker did not say.

## Models

The server tells you which models it uses at `GET /health`.

| Job | Default (Groq) | Alternative (Gemini) |
| --- | --- | --- |
| Speech to text with timestamps | `whisper-large-v3-turbo` | `gemini-flash-lite-latest` |
| Notes, moments, takeaways | `qwen/qwen3-32b` | `gemini-flash-lite-latest` |

Set `LLM_PROVIDER=groq` or `LLM_PROVIDER=gemini` in `server/.env`.

## Layout

```
src/                 Expo app (expo-router)
  app/(tabs)/        Library, Reader, Add, Settings
  app/video/[id]     The reading surface
  lib/               API client, theme, formatting, device cache
  components/        Timecode, moment row, formula, cards
server/              FastAPI backend
  pipeline.py        fetch -> transcribe -> structure -> validate -> store
  fetch.py           yt-dlp audio, captions, ffmpeg split
  llm.py             Groq calls, prompts, quote validation
  gemini.py          Gemini provider
  db.py              SQLite schema and helpers
```

## Run the backend

```bash
cd server
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
cp .env.example .env                            # then add a key
.venv/Scripts/python -m uvicorn app:app --port 8787
```

`ffmpeg` must be on `PATH`, or set `FFMPEG_PATH`.

## Run the app

```bash
npm install
npx expo start
```

In **Settings**, set the server address (e.g. `http://192.168.1.20:8787`) and the `API_TOKEN` from the server's `.env`. Press **Save and test server**.

## Deploy

`server/fly.toml` and `server/Dockerfile` are ready for Fly.io. A volume is needed for the SQLite file:

```bash
fly volumes create vishal_data --size 1
fly secrets set API_TOKEN=<long-random> GROQ_API_KEY=<key>
fly deploy
```

## Notes and limits

- YouTube serves caption tracks empty to unauthenticated clients, so the app always goes through the server for a link; the phone cannot download audio itself.
- Downloads can be blocked by YouTube depending on the host IP. Export `cookies.txt` and set `YT_COOKIES_FILE` if that happens.
- One worker processes one video at a time. Jobs survive a restart and are re-queued on startup.
