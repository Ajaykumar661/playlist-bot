import { SlashCommandBuilder } from "discord.js";
import { MAX_VOLUME, setVolume } from "../music/actions.js";
import { mayClip } from "../music/audioQuality.js";
import { ok } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

export const volume: Command = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Show or set the playback volume")
    .addIntegerOption((o) =>
      o.setName("level").setDescription(`Volume from 0 to ${MAX_VOLUME}`).setMinValue(0).setMaxValue(MAX_VOLUME),
    ),
  execute: (interaction, client) =>
    runAction(interaction, client, async (p) => {
      const level = interaction.options.getInteger("level");
      const result = level === null ? ok(`🔊 Volume is **${p.volume}%**.`) : await setVolume(p, level);
      if (result.ok && mayClip(p)) {
        result.message += "\n-# Above 100% loud songs can distort. To make it louder for yourself, right-click the bot → User Volume.";
      }
      return result;
    }),
};
