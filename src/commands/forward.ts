import { SlashCommandBuilder } from "discord.js";
import { seekTo } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const forward: Command = {
  data: new SlashCommandBuilder()
    .setName("forward")
    .setDescription("Fast-forward the current track")
    .addIntegerOption((o) => o.setName("seconds").setDescription("How far (default 10)").setMinValue(1).setMaxValue(3600)),
  execute: (interaction, client) =>
    runAction(interaction, client, (p) => seekTo(p, p.position + (interaction.options.getInteger("seconds") ?? 10) * 1000)),
};
