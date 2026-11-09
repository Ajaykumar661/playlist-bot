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

/**
 * Song timing for the now-playing card. Instead of a progress bar (Discord can't animate messages,
 * so a bar only moves in jumps when the message is edited), it uses a Discord timestamp:
 * "<t:…:R>" shows "ends in 2 minutes" and every Discord client keeps it counting down by itself.
 */
export function timingLine(positionMs: number, durationMs: number, paused: boolean, isStream: boolean, nowMs = Date.now()): string {
  if (isStream || durationMs <= 0) return "🔴 **LIVE**";
  const position = Math.min(Math.max(positionMs, 0), durationMs);
  const code = (ms: number) => "`" + formatDuration(ms) + "`";
  if (paused) return `⏸ Paused at ${code(position)} of ${code(durationMs)}`;
  const endsAt = Math.round((nowMs + durationMs - position) / 1000);
  return `${code(durationMs)} · ends <t:${endsAt}:R>`;
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
