import { SlashCommandBuilder } from "discord.js";
import { seekTo } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const replay: Command = {
  data: new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning"),
  execute: (interaction, client) => runAction(interaction, client, (p) => seekTo(p, 0)),
};
