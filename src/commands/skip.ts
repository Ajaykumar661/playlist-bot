import { SlashCommandBuilder } from "discord.js";
import { skipTrack } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const skip: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip to the next track"),
  execute: (interaction, client) => runAction(interaction, client, skipTrack, { quiet: true }),
};
