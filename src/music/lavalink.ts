import { LavalinkManager, type LavalinkNode, type LavalinkNodeOptions, type Player } from "lavalink-client";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { warnEmbed } from "../utils/embeds.js";
import type { BotClient, Requester } from "../utils/types.js";
import { registerPlayerEvents } from "./playerEvents.js";
import { sendToPlayerChannel } from "./notify.js";
import { createAutoplay } from "./autoplay.js";

const NODE_ID = "main";
/** Keep the Lavalink session alive this long during a websocket drop so players survive it. */
const SESSION_RESUME_TIMEOUT_MS = 60_000;
const NODE_RECREATE_DELAY_MS = 15_000;

const nodeOptions: LavalinkNodeOptions = {
  id: NODE_ID,
  host: config.lavalink.host,
  port: config.lavalink.port,
  authorization: config.lavalink.password,
  secure: false,
  // Never give up: retry every 10 s for as long as Lavalink is down.
  retryAmount: Number.POSITIVE_INFINITY,
  retryDelay: 10_000,
  retryTimespan: -1,
  requestSignalTimeoutMS: 15_000,
  closeOnError: true,
  heartBeatInterval: 30_000,
};

/** Normalise whatever we pass as requester (a discord.js User) to a small plain object. */
function toRequester(input: unknown): Requester {
  if (input && typeof input === "object" && "id" in input) {
    const obj = input as { id: unknown; username?: unknown; globalName?: unknown };
    const username =
      typeof obj.globalName === "string" && obj.globalName
        ? obj.globalName
        : typeof obj.username === "string"
          ? obj.username
          : "unknown";
    return { id: String(obj.id), username };
  }
  return { id: "0", username: "unknown" };
}

export function createLavalink(client: BotClient): LavalinkManager {
  const manager = new LavalinkManager({
    nodes: [nodeOptions],
    sendToShard: (guildId, payload) => {
      client.guilds.cache.get(guildId)?.shard.send(payload);
    },
    client: { id: config.discord.clientId, username: "AppleMusicBot" },
    autoSkip: true,
    autoSkipOnResolveError: true,
    emitNewSongsOnly: false,
    playerOptions: {
      defaultSearchPlatform: "ytmsearch",
      applyVolumeAsFilter: false,
      clientBasedPositionUpdateInterval: 150,
      requesterTransformer: toRequester,
      onDisconnect: { autoReconnect: false, destroyPlayer: true },
      // We run our own 3-minute idle timer (idleManager.ts), so the library's is off.
      // autoPlayFunction only acts when /autoplay is on for that server.
      onEmptyQueue: {
        destroyAfterMs: undefined,
        autoPlayFunction: createAutoplay(() => ({
          id: client.user?.id ?? config.discord.clientId,
          username: "Autoplay",
        })),
      },
      // The library destroys the player after 3 errors in 35 s by default. A playlist with a
      // few unmatched songs would trip that, so it's disabled. playerEvents.ts has its own guard.
      maxErrorsPerTime: { threshold: 0, maxAmount: 0 },
    },
    queueOptions: { maxPreviousTracks: 50 },
    advancedOptions: {
      enableDebugEvents: config.logLevel === "debug" || config.logLevel === "trace",
    },
  });

  registerNodeEvents(client, manager);
  registerPlayerEvents(client, manager);

  if (manager.options.advancedOptions?.enableDebugEvents) {
    manager.on("debug", (event, data) => logger.debug({ event, layer: data.functionLayer }, data.message));
  }

  return manager;
}

function registerNodeEvents(client: BotClient, manager: LavalinkManager): void {
  const nodes = manager.nodeManager;
  /** Nodes that dropped and haven't sent a fresh "ready" yet. */
  const disconnectedNodes = new Set<string>();

  nodes.on("connect", (node) => {
    logger.info({ node: node.id }, `Connected to Lavalink at ${node.options.host}:${node.options.port}`);
  });

  nodes.on("reconnecting", (node) => {
    logger.warn({ node: node.id }, "Reconnecting to Lavalink…");
  });

  nodes.on("disconnect", (node, reason) => {
    logger.warn({ node: node.id, ...reason }, "Disconnected from Lavalink");
    if (disconnectedNodes.has(node.id)) return;
    disconnectedNodes.add(node.id);
    for (const player of playersOn(manager, node)) {
      void sendToPlayerChannel(client, player, {
        embeds: [warnEmbed("Lost connection to the audio server. Reconnecting… playback will continue automatically.")],
      });
    }
  });

  nodes.on("resumed", (node, _payload, players) => {
    disconnectedNodes.delete(node.id);
    const count = Array.isArray(players) ? players.length : 0;
    logger.info({ node: node.id, players: count }, "Lavalink session resumed, players kept playing");
  });

  // "ready" with resumed=false after a drop means Lavalink restarted and forgot our players.
  // Re-send each player's voice state and current track.
  nodes.on("raw", (node, payload) => {
    logFrameStats(node, payload);
    if (!isReadyPayload(payload)) return;
    // The library stores the new session id after emitting "raw", so wait a moment before using it.
    setTimeout(() => {
      // Resuming has to be switched on again for every new session.
      if (!payload.resumed) enableResuming(node);
      if (payload.resumed || !disconnectedNodes.has(node.id)) return;
      disconnectedNodes.delete(node.id);
      void restorePlayers(client, manager, node);
    }, 1_000);
  });

  nodes.on("error", (node, error) => {
    logger.error({ node: node.id, err: error }, "Lavalink node error");
  });

  // Only reached if the library gives up on the node entirely. Recreate it.
  nodes.on("destroy", (node, reason) => {
    logger.error({ node: node.id, reason }, `Lavalink node destroyed. Recreating in ${NODE_RECREATE_DELAY_MS / 1000}s`);
    setTimeout(() => {
      if (nodes.nodes.has(NODE_ID)) return;
      try {
        const fresh = nodes.createNode(nodeOptions);
        disconnectedNodes.add(fresh.id);
        void fresh.connect();
      } catch (error) {
        logger.error({ err: error }, "Failed to recreate Lavalink node");
      }
    }, NODE_RECREATE_DELAY_MS).unref();
  });
}

/**
 * Lavalink sends stats every minute. frameStats covers the last minute of audio:
 * ~3000 frames expected per playing player; "nulled" = no audio ready in time, "deficit" = frames
 * that never reached Discord. Either one is audible as stutter or speeding up / slowing down.
 */
function logFrameStats(node: LavalinkNode, payload: unknown): void {
  const p = payload as {
    op?: string;
    playingPlayers?: number;
    cpu?: { systemLoad: number; lavalinkLoad: number };
    frameStats?: { sent: number; nulled: number; deficit: number } | null;
  };
  if (p.op !== "stats" || !p.frameStats || !p.playingPlayers) return;
  const { sent, nulled, deficit } = p.frameStats;
  const expected = 3000 * p.playingPlayers;
  const lossPct = Math.round(((nulled + Math.max(0, deficit)) / expected) * 1000) / 10;
  const details = {
    node: node.id,
    playing: p.playingPlayers,
    sent,
    nulled,
    deficit,
    lossPct,
    cpuSystem: p.cpu ? Math.round(p.cpu.systemLoad * 100) : undefined,
    cpuLavalink: p.cpu ? Math.round(p.cpu.lavalinkLoad * 100) : undefined,
  };
  if (lossPct >= 1) logger.warn(details, `Audio frames lost in the last minute (${lossPct}%): playback may stutter or change speed`);
  else logger.debug(details, "Audio frame stats");
}

/** Ask Lavalink to keep this session's players alive for a while if the websocket drops. */
function enableResuming(node: LavalinkNode): void {
  node
    .updateSession(true, SESSION_RESUME_TIMEOUT_MS)
    .then(() => logger.info({ node: node.id }, `Lavalink session resuming on (${SESSION_RESUME_TIMEOUT_MS / 1000}s)`))
    .catch((error: unknown) => logger.warn({ err: error, node: node.id }, "Could not enable Lavalink session resuming"));
}

function playersOn(manager: LavalinkManager, node: LavalinkNode): Player[] {
  return [...manager.players.values()].filter((p) => p.node?.id === node.id);
}

function isReadyPayload(payload: unknown): payload is { op: "ready"; resumed: boolean; sessionId: string } {
  return typeof payload === "object" && payload !== null && (payload as { op?: unknown }).op === "ready";
}

async function restorePlayers(client: BotClient, manager: LavalinkManager, node: LavalinkNode): Promise<void> {
  const players = playersOn(manager, node);
  if (players.length === 0) return;
  logger.info({ node: node.id, players: players.length }, "Lavalink restarted, restoring players");

  for (const player of players) {
    try {
      const current = player.queue.current;
      if (!current && player.queue.tracks.length === 0) continue;
      await player.play({
        ...(current ? { clientTrack: current, position: Math.max(0, player.lastPosition) } : {}),
        paused: player.paused,
        voice: player.voice,
      });
      logger.info({ guildId: player.guildId }, "Player restored after Lavalink restart");
    } catch (error) {
      logger.error({ err: error, guildId: player.guildId }, "Could not restore player, destroying it");
      await sendToPlayerChannel(client, player, {
        embeds: [warnEmbed("The audio server restarted and I couldn't resume playback. Please `/play` again.")],
      });
      await player.destroy("RestoreFailed").catch(() => undefined);
    }
  }
}
