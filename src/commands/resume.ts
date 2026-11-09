import { SlashCommandBuilder } from "discord.js";
import { togglePause } from "../music/actions.js";
import { fail } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const resume: Command = {
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  execute: (interaction, client) =>
    runAction(interaction, client, (p) => (!p.paused ? fail("Playback isn't paused.") : togglePause(p))),
};
