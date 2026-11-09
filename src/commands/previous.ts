import { SlashCommandBuilder } from "discord.js";
import { previousTrack } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const previous: Command = {
  data: new SlashCommandBuilder()
    .setName("previous")
    .setDescription("Go back to the previous track (restarts the current one if it's past 5 seconds)"),
  execute: (interaction, client) => runAction(interaction, client, previousTrack, { quiet: true }),
};
