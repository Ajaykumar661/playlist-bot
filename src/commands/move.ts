import { SlashCommandBuilder } from "discord.js";
import type { Track, UnresolvedTrack } from "lavalink-client";
import { escapeMd, truncate } from "../utils/format.js";
import { fail, ok } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const move: Command = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue")
    .addIntegerOption((o) => o.setName("from").setDescription("Current position").setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName("to").setDescription("New position (1 = next up)").setRequired(true).setMinValue(1)),
  execute: (interaction, client) =>
    runAction(interaction, client, async (p) => {
      const from = interaction.options.getInteger("from", true);
      const length = p.queue.tracks.length;
      const to = Math.min(interaction.options.getInteger("to", true), length);
      if (from > length) return fail(`There are only ${length} tracks in the queue.`);
      if (from === to) return fail("That track is already there.");
      const removed = (await p.queue.splice(from - 1, 1)) as (Track | UnresolvedTrack)[] | undefined;
      const track = removed?.[0];
      if (!track) return fail("Couldn't find that track.");
      await p.queue.splice(to - 1, 0, track);
      return ok(`↕️ Moved **${escapeMd(truncate(track.info.title, 80))}** to position ${to}.`);
    }),
};
