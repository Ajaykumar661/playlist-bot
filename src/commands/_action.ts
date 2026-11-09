import type { ChatInputCommandInteraction } from "discord.js";
import type { Player } from "lavalink-client";
import type { ActionResult } from "../music/actions.js";
import { refreshNowPlaying } from "../music/nowPlaying.js";
import { replyError, replySuccess } from "../utils/embeds.js";
import { checkVoice } from "../utils/voice.js";
import type { BotClient } from "../utils/types.js";

/**
 * Run a shared player action from a slash command: voice checks, reply, and refresh the
 * now-playing buttons so they match (e.g. after /pause the ⏸️ button turns into ▶️).
 */
export async function runAction(
  interaction: ChatInputCommandInteraction<"cached">,
  client: BotClient,
  action: (player: Player) => Promise<ActionResult> | ActionResult,
  options: { refresh?: boolean } = { refresh: true },
): Promise<void> {
  const ctx = await checkVoice(interaction, client, { requirePlayer: true });
  if (!ctx?.player) return;
  const result = await action(ctx.player);
  if (!result.ok) {
    await replyError(interaction, result.message);
    return;
  }
  await replySuccess(interaction, result.message);
  if (options.refresh !== false) await refreshNowPlaying(client, ctx.player);
}
