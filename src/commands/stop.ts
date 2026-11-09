import { SlashCommandBuilder } from "discord.js";
import { stopPlayer } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const stop: Command = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback, clear the queue and leave"),
  execute: (interaction, client) => runAction(interaction, client, stopPlayer, { refresh: false }),
};
