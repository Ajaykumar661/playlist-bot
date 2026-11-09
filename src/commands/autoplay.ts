import { SlashCommandBuilder } from "discord.js";
import { toggleAutoplay } from "../music/actions.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const autoplay: Command = {
  data: new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Toggle autoplay: keep playing similar songs when the queue runs out"),
  execute: (interaction, client) => runAction(interaction, client, toggleAutoplay),
};
