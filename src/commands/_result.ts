import type { ActionResult } from "../music/actions.js";

export const fail = (message: string): ActionResult => ({ ok: false, message });
export const ok = (message: string): ActionResult => ({ ok: true, message });
