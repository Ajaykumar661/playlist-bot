import type { ChatInputCommandInteraction } from "discord.js";
import type { Player } from "lavalink-client";
import type { ActionResult } from "../music/actions.js";
import { refreshNowPlaying } from "../music/nowPlaying.js";
import { replyError, replySuccess, respond, successEmbed } from "../utils/embeds.js";
import { checkVoice } from "../utils/voice.js";
import type { BotClient } from "../utils/types.js";

/**
 * Run a shared player action from a slash command: voice checks, reply, and refresh the
 * now-playing buttons so they match (e.g. after /pause the ⏸️ button turns into ▶️).
 *
 * `quiet`: for actions that change the song (skip, previous, jump…). The now-playing message
 * updates itself, so the confirmation is shown only to the person who used the command.
 */
export async function runAction(
  interaction: ChatInputCommandInteraction<"cached">,
  client: BotClient,
  action: (player: Player) => Promise<ActionResult> | ActionResult,
  options: { quiet?: boolean } = {},
): Promise<void> {
  const ctx = await checkVoice(interaction, client, { requirePlayer: true });
  if (!ctx?.player) return;
  const result = await action(ctx.player);
  if (!result.ok) {
    await replyError(interaction, result.message);
    return;
  }
  if (options.quiet) {
    await respond(interaction, successEmbed(result.message), true);
    return;
  }
  await replySuccess(interaction, result.message);
  await refreshNowPlaying(client, ctx.player);
}
