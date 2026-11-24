/**
 * On-device pipeline: caption track -> Gemini -> validated notes.
 *
 * The same grounding rule as the server applies: every note, moment and takeaway
 * must quote the transcript near the segment it claims, or it is dropped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Moment, Reader, Segment, Takeaway, Video } from './api';
import { GEMINI_MODEL, GeminiError, geminiGenerate, parseJsonObject } from './gemini';
import { fetchTranscript, parseYouTubeId, type RawSegment } from './youtube';

const VIDEOS = 'vishal.device.videos.v1';

export const CATEGORIES = [
  'education',
  'self-improvement',
  'sports',
  'entertainment',
  'technology',
  'health',
  'finance',
  'news',
  'business',
  'science',
  'other',
];

const SYSTEM = `You turn a video transcript into a faithful study outline.

Hard rules:
- Use only what the speaker says. Never add outside facts, numbers, names or opinions.
- Never speculate about intent, quality or what the speaker "probably" means.
- Every item must carry the segment number it came from and a verbatim quote from that segment.
- Quotes are copied exactly from the transcript line, 6 to 32 words. Never paraphrase a quote.
- If the transcript does not support an item, omit it. Empty lists are valid answers.
- Reply with one JSON object. No prose, no markdown fences, no commentary.`;

// ---------------------------------------------------------------- storage

async function readAll(): Promise<Video[]> {
  const raw = await AsyncStorage.getItem(VIDEOS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Video[];
  } catch {
    return [];
  }
}

async function writeAll(videos: Video[]): Promise<void> {
  await AsyncStorage.setItem(VIDEOS, JSON.stringify(videos));
}

export async function deviceVideos(): Promise<Video[]> {
  return readAll();
}

export async function deviceVideo(id: string): Promise<Video | null> {
  const all = await readAll();
  return all.find((video) => video.id === id) ?? null;
}

export async function deviceReader(id: string): Promise<Reader | null> {
  const raw = await AsyncStorage.getItem(`vishal.reader.${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Reader;
  } catch {
    return null;
  }
}

async function upsert(video: Video): Promise<void> {
  const all = await readAll();
  const index = all.findIndex((row) => row.id === video.id);
  const next = { ...video, updated_at: new Date().toISOString() };
  if (index >= 0) all[index] = next;
  else all.unshift(next);
  await writeAll(all);
}

export async function deviceRemove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((video) => video.id !== id));
  await AsyncStorage.removeItem(`vishal.reader.${id}`);
}

export async function setDeviceCategory(id: string, category: string): Promise<void> {
  const video = await deviceVideo(id);
  if (!video) return;
  await upsert({ ...video, category, category_confidence: 1 });
}

// ---------------------------------------------------------------- grounding

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoteSupported(quote: string, segments: Segment[], idx: number): boolean {
  const clean = normalise(quote);
  if (clean.split(' ').length < 4) return false;
  const near = segments.filter((segment) => Math.abs(segment.idx - idx) <= 3);
  if (!near.length) return false;
  const hay = normalise(near.map((segment) => segment.text).join(' '));
  if (hay.includes(clean)) return true;
  const words = clean.split(' ');
  const half = words.slice(0, Math.max(5, Math.floor(words.length / 2))).join(' ');
  return hay.includes(half);
}

// ---------------------------------------------------------------- prompting

function stamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function lines(segments: Segment[]): string {
  return segments.map((segment) => `[${segment.idx}] ${stamp(segment.start_ms)} ${segment.text}`).join('\n');
}

function chunk(segments: Segment[], target = 11_000): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const segment of segments) {
    if (current.length && size + segment.text.length > target) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += segment.text.length + 12;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

type Candidate = { segment_idx: number; quote: string; start_ms: number };

async function analyseChunk(
  key: string,
  segments: Segment[],
  language: string,
  part: number,
  total: number,
) {
  const user = `Video language: ${language || 'unknown'}.
This is part ${part} of ${total}. Lines are numbered [segment] mm:ss text.

${lines(segments)}

Return JSON:
{"notes":[{"segment_idx":int,"quote":str,"note":str}],
 "moments":[{"segment_idx":int,"quote":str,"title":str}],
 "takeaways":[{"segment_idx":int,"quote":str,"kind":"claim"|"definition"|"number"|"formula","text":str,"latex":str|null}]}

Guidance:
- notes: 2 to 4 things the speaker actually asserts or explains here.
- moments: 1 to 3 places where the argument turns, a claim lands, or a concrete example starts.
- takeaways: only durable content: definitions, numbers, formulas, or a rule worth keeping.
- For a formula put LaTeX in "latex" without dollar signs, and keep "text" as a plain reading.
- Coordinates, prices and statistics go in kind "number".`;

  const raw = await geminiGenerate(key, { system: SYSTEM, user, json: true, maxTokens: 3000 });
  const parsed = parseJsonObject(raw);
  const byIdx = new Map(segments.map((segment) => [segment.idx, segment]));

  const clean = (items: unknown, fields: string[]): Candidate[] => {
    if (!Array.isArray(items)) return [];
    const out: Candidate[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const idx = row.segment_idx;
      const quote = typeof row.quote === 'string' ? row.quote.trim() : '';
      if (typeof idx !== 'number' || !byIdx.has(idx) || !quote) continue;
      if (!quoteSupported(quote, segments, idx)) continue;
      out.push({ segment_idx: idx, quote, start_ms: byIdx.get(idx)!.start_ms, ...Object.fromEntries(fields.map((field) => [field, row[field]])) } as Candidate & Record<string, unknown>);
    }
    return out;
  };

  return {
    notes: clean(parsed.notes, ['note']).filter((row) => (row as Record<string, unknown>).note),
    moments: clean(parsed.moments, ['title']).filter((row) => (row as Record<string, unknown>).title),
    takeaways: clean(parsed.takeaways, ['kind', 'text', 'latex']).filter(
      (row) => (row as Record<string, unknown>).text,
    ),
  };
}

// ---------------------------------------------------------------- job

export type DeviceJob = {
  video: Video;
  url: string;
};

export async function startDeviceJob(youtubeId: string, url: string, key: string): Promise<Video> {
  const id = `dev_${youtubeId}`;
  const existing = await deviceVideo(id);
  if (existing && existing.status === 'ready') return existing;

  const base: Video = {
    id,
    youtube_id: youtubeId,
    url,
    title: null,
    channel: null,
    duration_s: null,
    language: null,
    category: null,
    category_confidence: 0,
    fetch_tier: 'captions',
    status: 'processing',
    stage: 'fetching',
    progress: 0.08,
    error: null,
    gist: null,
    summary: null,
    summary_lang: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  await upsert(base);
  void run(id, youtubeId, key);
  return base;
}

async function patch(id: string, fields: Partial<Video>): Promise<void> {
  const video = await deviceVideo(id);
  if (!video) return;
  await upsert({ ...video, ...fields });
}

async function run(id: string, youtubeId: string, key: string): Promise<void> {
  try {
    const transcript = await fetchTranscript(youtubeId);
    await patch(id, {
      title: transcript.title,
      channel: transcript.channel,
      duration_s: transcript.duration_s,
      language: transcript.language,
      stage: 'summarising',
      progress: 0.45,
    });

    const segments: Segment[] = transcript.segments.map((segment: RawSegment) => ({
      idx: segment.idx,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
    }));

    const chunks = chunk(segments);
    const notes: Array<Record<string, unknown>> = [];
    const moments: Array<Candidate & Record<string, unknown>> = [];
    const takeaways: Array<Candidate & Record<string, unknown>> = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const part = await analyseChunk(key, chunks[i], transcript.language, i + 1, chunks.length);
      notes.push(...part.notes);
      moments.push(...(part.moments as Array<Candidate & Record<string, unknown>>));
      takeaways.push(...(part.takeaways as Array<Candidate & Record<string, unknown>>));
      await patch(id, { progress: 0.45 + (0.4 * (i + 1)) / chunks.length });
    }

    if (!notes.length) throw new Error('Nothing in this transcript could be traced to a quote.');

    const describe = (rows: Array<Record<string, unknown>>, cap: number) =>
      rows
        .slice(0, cap)
        .map((row, index) => `${index + 1}. [${stamp(row.start_ms as number)}] ${row.title ?? row.text} — "${String(row.quote).slice(0, 110)}"`)
        .join('\n');

    const user = `Video: ${transcript.title} — ${transcript.channel}
Language: ${transcript.language}

Notes gathered from the transcript:
${notes.slice(0, 60).map((note) => `- ${note.note} (from [${note.segment_idx}])`).join('\n')}

Candidate moments:
${describe(moments as Array<Record<string, unknown>>, 40)}

Candidate takeaways:
${describe(takeaways as Array<Record<string, unknown>>, 30)}

Categories: ${CATEGORIES.join(', ')}

Return JSON:
{"gist":str,"summary":str,"category":str,"category_confidence":number,
 "keep_moments":[int],"keep_takeaways":[int]}

Rules:
- gist: one sentence under 18 words, what the viewer actually gets.
- summary: 140 to 220 words in the transcript's language. Only claims present in the notes. No advice, no outside context. Start with the substance.
- category: one from the list.
- keep_moments: 1-based indexes of at most 12, in playback order.
- keep_takeaways: 1-based indexes of at most 8, in playback order.
- Prefer precision. Drop anything you cannot trace to a note.`;

    const raw = await geminiGenerate(key, { system: SYSTEM, user, json: true, maxTokens: 2200 });
    const parsed = parseJsonObject(raw);

    const pick = <T extends { start_ms: number }>(rows: T[], keep: unknown, cap: number): T[] => {
      const indexes = Array.isArray(keep) ? keep.filter((value): value is number => typeof value === 'number') : [];
      const chosen = indexes.map((index) => rows[index - 1]).filter(Boolean);
      const kept = chosen.length ? chosen : rows.slice(0, cap);
      return kept.sort((a, b) => a.start_ms - b.start_ms).slice(0, cap);
    };

    const category = CATEGORIES.includes(String(parsed.category))
      ? String(parsed.category)
      : 'other';

    const keptMoments: Moment[] = pick(moments, parsed.keep_moments, 12).map((row, index) => ({
      idx: index,
      start_ms: row.start_ms,
      title: String(row.title ?? 'Key moment'),
      quote: String(row.quote),
      note: (row.note as string) ?? null,
      segment_idx: row.segment_idx,
    }));

    const keptTakeaways: Takeaway[] = pick(takeaways, parsed.keep_takeaways, 8).map((row, index) => ({
      idx: index,
      kind: (row.kind as Takeaway['kind']) ?? 'claim',
      text: String(row.text),
      latex: (row.latex as string) ?? null,
      start_ms: row.start_ms,
      segment_idx: row.segment_idx,
      quote: String(row.quote),
    }));

    const reader: Reader = {
      video: {
        ...(await deviceVideo(id))!,
        status: 'ready',
        stage: 'done',
        progress: 1,
        gist: String(parsed.gist ?? ''),
        summary: String(parsed.summary ?? ''),
        summary_lang: transcript.language,
        category,
        category_confidence: Number(parsed.category_confidence ?? 0.6),
      },
      segments,
      moments: keptMoments,
      takeaways: keptTakeaways,
    };

    await AsyncStorage.setItem(`vishal.reader.${id}`, JSON.stringify(reader));
    await patch(id, {
      status: 'ready',
      stage: 'done',
      progress: 1,
      gist: reader.video.gist,
      summary: reader.video.summary,
      category,
      category_confidence: reader.video.category_confidence,
      summary_lang: transcript.language,
    });
  } catch (error) {
    const message =
      error instanceof GeminiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Something went wrong on the phone.';
    await patch(id, { status: 'failed', stage: 'failed', error: message });
  }
}

export { GEMINI_MODEL, parseYouTubeId };
