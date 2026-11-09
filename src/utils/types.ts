import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { LavalinkManager } from "lavalink-client";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction<"cached">, client: BotClient) => Promise<void>;
  /** Suggestions while the user types an option marked .setAutocomplete(true). */
  autocomplete?: (interaction: AutocompleteInteraction<"cached">, client: BotClient) => Promise<void>;
}

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (client: BotClient, ...args: ClientEvents[K]) => Promise<void> | void;
}

export interface BotClient extends Client {
  lavalink: LavalinkManager;
  commands: Map<string, Command>;
}

/** What we store as a track's requester. */
export interface Requester {
  id: string;
  username: string;
}
