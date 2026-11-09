import { SlashCommandBuilder } from "discord.js";
import { shuffleQueue } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const shuffle: Command = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the upcoming tracks"),
  execute: (interaction, client) => runAction(interaction, client, shuffleQueue),
};
