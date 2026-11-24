/**
 * Reads a video's own caption track on the phone. No server, no audio download.
 *
 * YouTube embeds the player response in the watch page. That response carries the
 * caption track URLs, which we can fetch directly as JSON. When a video has no
 * captions there is nothing to read here, and the app says so instead of guessing.
 */

export type RawSegment = { idx: number; start_ms: number; end_ms: number; text: string };

export type Transcript = {
  title: string;
  channel: string;
  duration_s: number;
  language: string;
  segments: RawSegment[];
};

export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  const match = value.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  return null;
}

/** Pull the object that starts at `marker` out of the page, matching braces safely. */
function embeddedJson(html: string, marker: string): unknown | null {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type Track = { baseUrl: string; languageCode?: string; kind?: string; name?: { simpleText?: string } };

export async function fetchTranscript(youtubeId: string): Promise<Transcript> {
  let html = '';
  try {
    const response = await fetch(
      `https://www.youtube.com/watch?v=${youtubeId}&hl=en&has_verified=1&bpctr=9999999999`,
      {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
        },
      },
    );
    html = await response.text();
  } catch {
    throw new Error(
      'The phone could not reach YouTube. This usually means the browser blocked the request.',
    );
  }

  const player = embeddedJson(html, 'ytInitialPlayerResponse') as
    | {
        videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
        playabilityStatus?: { status?: string; reason?: string };
        captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
      }
    | null;

  if (!player) {
    throw new Error('YouTube did not return a readable page. Try the link again, or use a server.');
  }
  if (player.playabilityStatus?.status && player.playabilityStatus.status !== 'OK') {
    throw new Error(
      player.playabilityStatus.reason ?? 'YouTube will not play this video without signing in.',
    );
  }

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    throw new Error(
      'This video has no captions, so the phone has nothing to read. Add a server and it can transcribe the audio instead.',
    );
  }

  const english = tracks.filter((track) => (track.languageCode ?? '').startsWith('en'));
  const manual = english.find((track) => !track.kind);
  const chosen = manual ?? english[0] ?? tracks[0];

  const captionUrl = `${chosen.baseUrl.replace(/&fmt=[^&]*/g, '')}&fmt=json3`;
  let events: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> = [];
  try {
    const captionResponse = await fetch(captionUrl, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const body = await captionResponse.json();
    events = body?.events ?? [];
  } catch {
    throw new Error('The caption track was there but could not be downloaded.');
  }

  const segments: RawSegment[] = [];
  let last = '';
  for (const event of events) {
    const text = (event.segs ?? [])
      .map((part) => part.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === last) continue;
    last = text;
    const start = event.tStartMs ?? 0;
    segments.push({
      idx: segments.length,
      start_ms: start,
      end_ms: start + Math.max(event.dDurationMs ?? 0, 900),
      text,
    });
  }

  if (segments.length < 8) {
    throw new Error('The caption track came back almost empty, so there is nothing to summarise.');
  }

  return {
    title: player.videoDetails?.title ?? 'Untitled video',
    channel: player.videoDetails?.author ?? 'Unknown channel',
    duration_s: Number(player.videoDetails?.lengthSeconds ?? 0) || 0,
    language: chosen.languageCode ?? 'en',
    segments: mergeCues(segments),
  };
}

/** Cues are two or three words; glue them into readable ~15 second lines. */
function mergeCues(rows: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const row of rows) {
    const previous = out[out.length - 1];
    if (previous && row.start_ms - previous.start_ms < 15_000 && previous.text.length < 220) {
      previous.text = `${previous.text} ${row.text}`.trim();
      previous.end_ms = row.end_ms;
    } else {
      out.push({ ...row, idx: out.length });
    }
  }
  return out;
}
