import { Events, MessageFlags } from "discord.js";
import { config } from "../config.js";
import { isChannelAllowed, wrongChannelMessage } from "../utils/allowlist.js";
import { logger } from "../utils/logger.js";
import { replyError } from "../utils/embeds.js";
import type { BotEvent } from "../utils/types.js";
import { handleControlButton, handleQueuePageButton, isControlButton } from "../music/controls.js";
import { handleChoiceButton, isChoiceButton } from "../music/choice.js";
import { handlePickMenu, isPickMenu } from "../music/picker.js";
import { isQueuePageButton } from "../music/queueView.js";
import { handleLyricsButton, isLyricsButton } from "../music/liveLyrics.js";

export const interactionCreateEvent: BotEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    // "Play now / Play next / Add to queue" buttons.
    if (interaction.isButton() && isChoiceButton(interaction.customId)) {
      if (!interaction.inCachedGuild()) return;
      try {
        await handleChoiceButton(interaction, client);
      } catch (error) {
        logger.error({ err: error, button: interaction.customId }, "Choice button failed");
      }
      return;
    }

    // Live lyrics buttons (Full lyrics / Stop).
    if (interaction.isButton() && isLyricsButton(interaction.customId)) {
      if (!interaction.inCachedGuild()) return;
      try {
        await handleLyricsButton(interaction, client);
      } catch (error) {
        logger.error({ err: error, button: interaction.customId }, "Lyrics button failed");
      }
      return;
    }

    // Queue page buttons (in the now-playing message and on /queue).
    if (interaction.isButton() && isQueuePageButton(interaction.customId)) {
      if (!interaction.inCachedGuild()) return;
      try {
        await handleQueuePageButton(interaction, client);
      } catch (error) {
        logger.error({ err: error, button: interaction.customId }, "Queue page button failed");
      }
      return;
    }

    // Now-playing control buttons. The /search menu uses a collector in its command.
    if (interaction.isButton() && isControlButton(interaction)) {
      if (!interaction.inCachedGuild()) return;
      try {
        await handleControlButton(interaction, client);
      } catch (error) {
        logger.error({ err: error, button: interaction.customId }, "Control button failed");
      }
      return;
    }

    // "Pick a song" menus under /queue and /history.
    if (interaction.isStringSelectMenu() && isPickMenu(interaction.customId)) {
      if (!interaction.inCachedGuild()) return;
      try {
        await handlePickMenu(interaction, client);
      } catch (error) {
        logger.error({ err: error, menu: interaction.customId }, "Pick menu failed");
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      if (!interaction.inCachedGuild()) return;
      // No suggestions (and no searches) outside the allowed channels.
      if (!isChannelAllowed(config.allowedChannelIds, interaction.channelId)) {
        await interaction.respond([]).catch(() => undefined);
        return;
      }
      const command = client.commands.get(interaction.commandName);
      await command?.autocomplete?.(interaction, client).catch((error: unknown) => {
        logger.warn({ err: error, command: interaction.commandName }, "Autocomplete failed");
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Channel allowlist (ALLOWED_CHANNEL_IDS): checked before any command runs, for everyone, admins included.
    if (!isChannelAllowed(config.allowedChannelIds, interaction.channelId)) {
      await interaction
        .reply({ content: wrongChannelMessage(config.allowedChannelIds), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }

    if (!interaction.inCachedGuild()) {
      if (interaction.isRepliable()) await replyError(interaction, "This command only works inside a server.");
      return;
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      await replyError(interaction, "Unknown command. Try running `npm run deploy-commands` again.");
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      logger.error({ err: error, command: interaction.commandName, guildId: interaction.guildId }, "Command failed");
      await replyError(interaction, "Something went wrong running that command. Please try again.").catch(() => undefined);
    }
  },
};
