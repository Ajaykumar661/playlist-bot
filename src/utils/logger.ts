import { pino } from "pino";

const level = process.env.LOG_LEVEL?.trim() || "info";
// Human-readable logs by default (also in Docker). Set LOG_FORMAT=json for structured logs.
const pretty = process.env.LOG_FORMAT?.trim().toLowerCase() !== "json";

export const logger = pino({
  level,
  ...(pretty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});
