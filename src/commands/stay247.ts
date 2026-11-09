import { SlashCommandBuilder } from "discord.js";
import { cancelIdleTimer } from "../music/idleManager.js";
import { ok } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const stay247: Command = {
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("Toggle 24/7 mode: stay in the voice channel even when idle or alone"),
  execute: (interaction, client) =>
    runAction(interaction, client, (p) => {
      const on = !p.get<boolean>("stay247");
      p.set("stay247", on);
      if (on) cancelIdleTimer(p.guildId);
      return ok(
        on
          ? "📌 24/7 mode **on**: I'll stay in the channel until `/stop` or `/leave`."
          : "📌 24/7 mode **off**: I'll leave after 3 minutes idle or alone.",
      );
    }),
};
