import { SlashCommandBuilder } from "discord.js";
import type { Player } from "lavalink-client";
import { ok } from "./_result.js";
import { runAction } from "./_action.js";
import type { Command } from "../utils/types.js";

type Preset = { label: string; apply: (p: Player) => Promise<unknown> };

const fm = (p: Player) => p.filterManager;

/** Each preset starts from a clean state so they don't stack in confusing ways. */
const PRESETS: Record<string, Preset> = {
  off: { label: "Off", apply: () => Promise.resolve() },
  bassboost: { label: "Bass boost", apply: (p) => fm(p).setEQPreset("BassboostMedium") },
  bassboost_high: { label: "Bass boost (high)", apply: (p) => fm(p).setEQPreset("BassboostHigh") },
  nightcore: { label: "Nightcore", apply: (p) => fm(p).toggleNightcore() },
  vaporwave: { label: "Vaporwave", apply: (p) => fm(p).toggleVaporwave() },
  "8d": { label: "8D", apply: (p) => fm(p).toggleRotation(0.2) },
  karaoke: { label: "Karaoke (vocals reduced)", apply: (p) => fm(p).toggleKaraoke() },
  soft: { label: "Soft (low-pass)", apply: (p) => fm(p).toggleLowPass(20) },
  tremolo: { label: "Tremolo", apply: (p) => fm(p).toggleTremolo() },
  vibrato: { label: "Vibrato", apply: (p) => fm(p).toggleVibrato() },
  pop: { label: "Pop EQ", apply: (p) => fm(p).setEQPreset("Pop") },
  rock: { label: "Rock EQ", apply: (p) => fm(p).setEQPreset("Rock") },
  electronic: { label: "Electronic EQ", apply: (p) => fm(p).setEQPreset("Electronic") },
  classical: { label: "Classical EQ", apply: (p) => fm(p).setEQPreset("Classic") },
  speed_up: { label: "Speed 1.25×", apply: (p) => fm(p).setSpeed(1.25) },
  slow_down: { label: "Speed 0.8×", apply: (p) => fm(p).setSpeed(0.8) },
};

export const filter: Command = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Apply an audio filter (bass boost, nightcore, 8D…)")
    .addStringOption((o) =>
      o
        .setName("preset")
        .setDescription("Filter to apply")
        .setRequired(true)
        .addChoices(...Object.entries(PRESETS).map(([value, p]) => ({ name: p.label, value }))),
    ),
  execute: (interaction, client) =>
    runAction(interaction, client, async (p) => {
      const key = interaction.options.getString("preset", true);
      const preset = PRESETS[key] ?? PRESETS.off!;
      await fm(p).resetFilters();
      await fm(p).clearEQ();
      await preset.apply(p);
      p.set("filter", key === "off" ? null : preset.label);
      return ok(key === "off" ? "🎛️ Filters cleared." : `🎛️ Filter **${preset.label}** on. Use \`/filter off\` to clear it.`);
    }),
};
