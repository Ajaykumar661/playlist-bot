/** 3725000 → "1:02:05", 185000 → "3:05" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** ▬▬▬▬🔘▬▬▬▬▬▬ style bar. */
export function progressBar(positionMs: number, durationMs: number, size = 18): string {
  if (durationMs <= 0) return "🔴 LIVE";
  const ratio = Math.min(Math.max(positionMs / durationMs, 0), 1);
  const knob = Math.min(Math.round(ratio * size), size - 1);
  return "▬".repeat(knob) + "🔘" + "▬".repeat(size - knob - 1);
}

/** Cut a string to Discord-friendly length. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Escape markdown characters in user/track-supplied text. */
export function escapeMd(text: string): string {
  return text.replace(/([\\*_`~|>[\]()])/g, "\\$1");
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
