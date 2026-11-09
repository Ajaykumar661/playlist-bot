import { SlashCommandBuilder } from "discord.js";
import { parseTime, seekTo } from "../music/actions.js";
import { fail } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const seek: Command = {
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Jump to a time in the current track")
    .addStringOption((o) => o.setName("time").setDescription("e.g. 1:30, 90, 1m30s").setRequired(true).setMaxLength(12)),
  execute: (interaction, client) =>
    runAction(interaction, client, (p) => {
      const ms = parseTime(interaction.options.getString("time", true));
      return ms === null ? fail("I couldn't read that time. Try `1:30` or `90`.") : seekTo(p, ms);
    }),
};
