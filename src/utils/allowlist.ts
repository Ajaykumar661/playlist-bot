/**
 * Channel allowlist (ALLOWED_CHANNEL_IDS): slash commands only work in these channels.
 * An empty list allows every channel.
 */

/** Parse "id1, id2,id3" into channel IDs. Throws on anything that isn't a Discord ID. */
export function parseChannelIds(raw: string | undefined, name = "ALLOWED_CHANNEL_IDS"): string[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = ids.filter((id) => !/^\d{17,20}$/.test(id));
  if (bad.length) {
    throw new Error(
      `${name} must be a comma-separated list of channel IDs (right-click a channel → Copy Channel ID). Not valid: ${bad.join(", ")}`,
    );
  }
  return [...new Set(ids)];
}

export const isChannelAllowed = (allowed: readonly string[], channelId: string | null): boolean =>
  allowed.length === 0 || (channelId !== null && allowed.includes(channelId));

/** "Use me in #channel 🎵", with the first allowed channel as a clickable mention. */
export const wrongChannelMessage = (allowed: readonly string[]) => `Use me in <#${allowed[0]}> 🎵`;
