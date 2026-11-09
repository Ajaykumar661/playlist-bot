import { ActivityType, Events } from "discord.js";
import { logger } from "../utils/logger.js";
import type { BotEvent } from "../utils/types.js";

export const readyEvent: BotEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  async execute(client, readyClient) {
    logger.info(`Logged in as ${readyClient.user.tag}`);
    readyClient.user.setActivity({ name: "/play <Apple Music link>", type: ActivityType.Listening });
    // Connect to Lavalink now that the bot's user id is known.
    await client.lavalink.init({ id: readyClient.user.id, username: readyClient.user.username });
  },
};
