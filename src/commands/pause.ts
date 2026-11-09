import { SlashCommandBuilder } from "discord.js";
import { togglePause } from "../music/actions.js";
import { fail } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const pause: Command = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  execute: (interaction, client) =>
    runAction(interaction, client, (p) => (p.paused ? fail("Already paused. Use `/resume`.") : togglePause(p))),
};
