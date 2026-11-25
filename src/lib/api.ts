import { getSettings, normaliseBaseUrl } from './settings';

export type VideoStatus = 'queued' | 'processing' | 'ready' | 'failed';

export type Video = {
  id: string;
  youtube_id: string;
  url: string;
  title: string | null;
  channel: string | null;
  duration_s: number | null;
  language: string | null;
  category: string | null;
  category_confidence: number;
  fetch_tier: string | null;
  status: VideoStatus;
  stage: string | null;
  progress: number;
  error: string | null;
  gist: string | null;
  summary: string | null;
  summary_lang: string | null;
  created_at: string;
};

export type Segment = { idx: number; start_ms: number; end_ms: number; text: string };
export type Moment = {
  idx: number;
  start_ms: number;
  title: string;
  quote: string;
  note: string | null;
  segment_idx: number;
};
export type Takeaway = {
  idx: number;
  kind: 'claim' | 'definition' | 'number' | 'formula';
  text: string;
  latex: string | null;
  start_ms: number;
  segment_idx: number;
  quote: string | null;
};
export type Reader = {
  video: Video;
  segments: Segment[];
  moments: Moment[];
  takeaways: Takeaway[];
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = await getSettings();
  const base = normaliseBaseUrl(baseUrl);
  if (!base) {
    throw new ApiError('No server set yet. Open Settings and paste your API address.', 0);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const detail =
        typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`;
      throw new ApiError(detail, response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new ApiError('The server took too long to answer. Is it awake?', 0);
    }
    throw new ApiError(
      'Cannot reach the server. Check the address in Settings and your connection.',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      model: string;
      asr: string;
      provider?: string;
      groq_key?: boolean;
      model_key?: boolean;
    }>('/health'),


  addVideo: (url: string) =>
    request<{ video: Video; reused: boolean }>('/videos', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  listVideos: (q?: string, category?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    const suffix = params.toString() ? `?${params}` : '';
    return request<{ videos: Video[] }>(`/videos${suffix}`);
  },

  video: (id: string) => request<{ video: Video }>(`/videos/${id}`),

  reader: (id: string) => request<Reader>(`/videos/${id}/reader`),

  retry: (id: string) =>
    request<{ video: Video }>(`/videos/${id}/retry`, { method: 'POST' }),

  setCategory: (id: string, category: string) =>
    request<{ video: Video }>(`/videos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category }),
    }),

  remove: (id: string) => request<{ deleted: string }>(`/videos/${id}`, { method: 'DELETE' }),
};
