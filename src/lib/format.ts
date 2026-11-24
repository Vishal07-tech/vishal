export function timecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return timecode(seconds * 1000);
}

export function youtubeUrl(videoId: string, startMs: number): string {
  const seconds = Math.max(0, Math.floor(startMs / 1000));
  return `https://youtu.be/${videoId}?t=${seconds}`;
}

export function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function since(iso: string): string {
  const then = new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function stageLabel(stage: string | null): string {
  switch (stage) {
    case 'metadata':
      return 'Looking up the video';
    case 'fetching':
      return 'Fetching the audio';
    case 'transcribing':
      return 'Writing the transcript';
    case 'summarising':
      return 'Finding the argument';
    case 'done':
      return 'Ready';
    default:
      return 'Waiting in line';
  }
}
