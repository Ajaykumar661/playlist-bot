import { SlashCommandBuilder } from "discord.js";
import type { RepeatMode } from "lavalink-client";
import { LOOP_MESSAGES } from "../music/actions.js";
import { ok } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const loop: Command = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the loop mode")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("What to loop")
        .setRequired(true)
        .addChoices({ name: "off", value: "off" }, { name: "track", value: "track" }, { name: "queue", value: "queue" }),
    ),
  execute: (interaction, client) =>
    runAction(interaction, client, async (p) => {
      const mode = interaction.options.getString("mode", true) as RepeatMode;
      await p.setRepeatMode(mode);
      return ok(LOOP_MESSAGES[mode]);
    }),
};
