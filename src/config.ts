import "dotenv/config";
import { parseChannelIds } from "./utils/allowlist.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = optional(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`Environment variable ${name} must be an integer between ${min} and ${max} (got "${raw}").`);
  }
  return parsed;
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("CLIENT_ID"),
    guildId: required("GUILD_ID"),
  },
  lavalink: {
    host: optional("LAVALINK_HOST", "localhost"),
    port: integer("LAVALINK_PORT", 2333, 1, 65535),
    password: required("LAVALINK_PASSWORD"),
  },
  /** Only used in messages; Lavalink reads the same variable itself. */
  appleMusicCountryCode: optional("APPLE_MUSIC_COUNTRY_CODE", "in"),
  /** Same variable Lavalink reads. When true the matcher tries Deezer ISRC (dzisrc) first. */
  deezerEnabled: optional("DEEZER_ENABLED", "false").toLowerCase() === "true",
  /** Slash commands only work in these channels (empty = everywhere). Applies to everyone, admins included. */
  allowedChannelIds: parseChannelIds(process.env.ALLOWED_CHANNEL_IDS),
  logLevel: optional("LOG_LEVEL", "info"),
  defaultVolume: integer("DEFAULT_VOLUME", 100, 0, 150),
  /** How long the bot waits with an empty queue or empty channel before leaving. */
  idleTimeoutMs: 3 * 60 * 1000,
} as const;

export type Config = typeof config;
