import { SlashCommandBuilder } from "discord.js";
import { playFromQueue } from "../music/actions.js";
import { respondWithTracks } from "../music/picker.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const playqueue: Command = {
  data: new SlashCommandBuilder()
    .setName("playqueue")
    .setDescription("Play a song from the queue right now (the other songs stay queued)")
    .addIntegerOption((o) =>
      o
        .setName("song")
        .setDescription("Start typing a title, or pick from the list")
        .setRequired(true)
        .setMinValue(1)
        .setAutocomplete(true),
    ),
  execute: (interaction, client) =>
    runAction(interaction, client, (p) => playFromQueue(p, interaction.options.getInteger("song", true) - 1), {
      quiet: true,
    }),
  autocomplete: (interaction, client) =>
    respondWithTracks(interaction, client.lavalink.getPlayer(interaction.guildId)?.queue.tracks ?? []),
};
