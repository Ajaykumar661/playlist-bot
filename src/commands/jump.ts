import { SlashCommandBuilder } from "discord.js";
import { escapeMd, truncate } from "../utils/format.js";
import { respondWithTracks } from "../music/picker.js";
import { fail, ok } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const jump: Command = {
  data: new SlashCommandBuilder()
    .setName("jump")
    .setDescription("Skip to a song in the queue and remove the songs before it (/playqueue keeps them)")
    .addIntegerOption((o) => o.setName("position").setDescription("Start typing a title, or pick from the list").setRequired(true).setMinValue(1).setAutocomplete(true)),
  execute: (interaction, client) =>
    runAction(
      interaction,
      client,
      async (p) => {
        const position = interaction.options.getInteger("position", true);
        const target = p.queue.tracks[position - 1];
        if (!target) return fail(`There are only ${p.queue.tracks.length} tracks in the queue.`);
        await p.skip(position, false);
        return ok(`⏭️ Jumped to **${escapeMd(truncate(target.info.title, 80))}**.`);
      },
      { refresh: false },
    ),
  autocomplete: (interaction, client) =>
    respondWithTracks(interaction, client.lavalink.getPlayer(interaction.guildId)?.queue.tracks ?? []),
};
