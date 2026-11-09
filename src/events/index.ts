import type { BotEvent } from "../utils/types.js";
import { readyEvent } from "./ready.js";
import { interactionCreateEvent } from "./interactionCreate.js";
import { voiceStateUpdateEvent } from "./voiceStateUpdate.js";

// Each entry is typed against its own event; the loader only needs the common shape.
export const events = [readyEvent, interactionCreateEvent, voiceStateUpdateEvent] as unknown as BotEvent[];
