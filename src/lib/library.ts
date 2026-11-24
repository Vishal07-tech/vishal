/**
 * One front door for the screens. Standalone mode (Gemini key on the device) is
 * preferred; a configured server is used when there is no key, or as the fallback
 * for videos with no captions.
 */
import { api, ApiError, type Reader, type Video } from './api';
import { cachedReader } from './cache';
import { deviceReader, deviceRemove, deviceVideo, deviceVideos, startDeviceJob } from './device';
import { getGeminiKey } from './keys';
import { getSettings, normaliseBaseUrl } from './settings';
import { parseYouTubeId } from './youtube';

async function hasKey(): Promise<boolean> {
  return !!(await getGeminiKey());
}

async function serverBase(): Promise<string> {
  const settings = await getSettings();
  return normaliseBaseUrl(settings.baseUrl);
}

export async function listVideos(query?: string): Promise<Video[]> {
  const [device, base] = await Promise.all([deviceVideos(), serverBase()]);
  let server: Video[] = [];
  if (base) {
    try {
      server = (await api.listVideos()).videos;
    } catch {
      server = [];
    }
  }
  const byYoutube = new Map<string, Video>();
  for (const video of [...server, ...device]) {
    byYoutube.set(video.youtube_id, video);
  }
  let merged = Array.from(byYoutube.values());
  if (query?.trim()) {
    const term = query.trim().toLowerCase();
    merged = merged.filter((video) =>
      [video.title, video.gist, video.summary, video.channel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }
  return merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getVideo(id: string): Promise<Video> {
  if (id.startsWith('dev_')) {
    const video = await deviceVideo(id);
    if (!video) throw new ApiError('That note is no longer on this phone.', 404);
    return video;
  }
  const { video } = await api.video(id);
  return video;
}

export async function getReader(id: string): Promise<Reader> {
  if (id.startsWith('dev_')) {
    const reader = await deviceReader(id);
    if (!reader) throw new ApiError('That note is still being written.', 404);
    return reader;
  }
  const fromServer = await api.reader(id);
  if (fromServer.video.status === 'ready') return fromServer;
  const cached = await cachedReader(id);
  return cached ?? fromServer;
}

export async function addVideo(url: string): Promise<{ video: Video; reused: boolean }> {
  const youtubeId = parseYouTubeId(url);
  if (!youtubeId) {
    throw new ApiError('That is not a YouTube link I can read.', 422);
  }

  // A server is the reliable path for a link: YouTube no longer serves caption
  // tracks (200 with an empty body) and the phone cannot download audio.
  if (await serverBase()) {
    return api.addVideo(url);
  }

  const key = await getGeminiKey();
  if (key) {
    const existing = await deviceVideo(`dev_${youtubeId}`);
    if (existing?.status === 'ready') return { video: existing, reused: true };
    const video = await startDeviceJob(youtubeId, url, key);
    return { video, reused: false };
  }

  throw new ApiError(
    'No server set yet. Open Settings and add the address of your server before adding a link.',
    0,
  );
}

export async function retryVideo(id: string): Promise<Video> {
  if (id.startsWith('dev_')) {
    const video = await deviceVideo(id);
    const key = await getGeminiKey();
    if (!video || !key) throw new ApiError('Cannot retry this one on the phone.', 0);
    return startDeviceJob(video.youtube_id, video.url, key);
  }
  const { video } = await api.retry(id);
  return video;
}

export async function removeVideo(id: string): Promise<void> {
  if (id.startsWith('dev_')) {
    await deviceRemove(id);
    return;
  }
  await api.remove(id);
}

export async function setCategory(id: string, category: string): Promise<void> {
  if (id.startsWith('dev_')) {
    const { setDeviceCategory } = await import('./device');
    await setDeviceCategory(id, category);
    return;
  }
  await api.setCategory(id, category);
}
