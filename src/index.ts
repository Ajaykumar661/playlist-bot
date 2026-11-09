import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import type { BotClient, Command } from "./utils/types.js";
import { createLavalink } from "./music/lavalink.js";
import { commands } from "./commands/index.js";
import { events } from "./events/index.js";
import { loadMatchingConfig } from "./music/matchingConfig.js";
import { initTrackResolver } from "./music/trackResolver.js";
import { initEmbeddings } from "./music/embeddings.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel],
}) as BotClient;

// Track matching: config, SQLite cache, and the embedding model (loads in the background).
const matchingConfig = loadMatchingConfig();
const matchCache = initTrackResolver(matchingConfig, config.deezerEnabled);
void initEmbeddings(matchingConfig.rerank);

client.commands = new Map<string, Command>(commands.map((c) => [c.data.name, c]));
client.lavalink = createLavalink(client);

for (const event of events) {
  const handler = (...args: unknown[]) => {
    Promise.resolve((event.execute as (c: BotClient, ...a: unknown[]) => unknown)(client, ...args)).catch(
      (error: unknown) => logger.error({ err: error, event: event.name }, "Event handler failed"),
    );
  };
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

// lavalink-client needs the raw VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE gateway packets.
client.on("raw", (packet: Parameters<typeof client.lavalink.sendRawData>[0]) => {
  void client.lavalink.sendRawData(packet);
});

client.on("error", (error) => logger.error({ err: error }, "Discord client error"));
client.on("shardDisconnect", (_e, id) => logger.warn({ shard: id }, "Discord gateway disconnected"));
client.on("shardReconnecting", (id) => logger.info({ shard: id }, "Reconnecting to Discord gateway"));

process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Unhandled promise rejection"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception, exiting");
  // Give pino-pretty a moment to flush. Docker / your process manager restarts the bot.
  setTimeout(() => process.exit(1), 500);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  try {
    await Promise.allSettled([...client.lavalink.players.values()].map((p) => p.destroy("Shutdown")));
    await client.destroy();
    matchCache.close();
  } finally {
    process.exit(0);
  }
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

logger.info("Starting bot…");
try {
  await client.login(config.discord.token);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.fatal(`Discord login failed: ${message} Check DISCORD_TOKEN in .env (README > Troubleshooting > Discord token issues).`);
  setTimeout(() => process.exit(1), 500);
}
