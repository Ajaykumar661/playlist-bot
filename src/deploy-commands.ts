import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { commands } from "./commands/index.js";

// Guild-scoped registration updates instantly (global commands can take up to an hour).
const body = commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(config.discord.token);

try {
  logger.info(`Registering ${body.length} slash commands to guild ${config.discord.guildId}…`);
  const result = (await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
    body,
  })) as unknown[];
  logger.info(`Registered ${result.length} commands.`);
} catch (error) {
  logger.error({ err: error }, "Failed to register commands. Check DISCORD_TOKEN, CLIENT_ID and GUILD_ID.");
  process.exitCode = 1;
}
