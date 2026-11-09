/**
 * SQLite cache of final matches, keyed by "isrc:<ISRC>" or "am:<Apple track id>".
 * Also stores per-song blacklisted video ids from /wrong.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import type { MatchingConfig } from "./matchingConfig.js";

export interface CachedMatch {
  key: string;
  videoId: string;
  encoded: string;
  title: string;
  author: string;
  durationMs: number;
  score: number | null;
  method: string;
}

interface MatchRow {
  key: string;
  video_id: string;
  encoded: string;
  title: string;
  author: string;
  duration_ms: number;
  score: number | null;
  method: string;
  updated_at: number;
}

export class MatchCache {
  private readonly db: Database.Database | null;
  private readonly maxAgeMs: number;

  constructor(cfg: MatchingConfig["cache"]) {
    this.maxAgeMs = cfg.maxAgeDays * 24 * 60 * 60 * 1000;
    if (!cfg.enabled) {
      // Blacklist still needs storage, so use an in-memory db when caching is off.
      this.db = new Database(":memory:");
    } else {
      const path = resolve(cfg.path);
      mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path);
      this.db.pragma("journal_mode = WAL");
      logger.info({ path }, "Match cache opened");
    }
    this.cacheEnabled = cfg.enabled;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        key         TEXT PRIMARY KEY,
        video_id    TEXT NOT NULL,
        encoded     TEXT NOT NULL,
        title       TEXT NOT NULL,
        author      TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        score       REAL,
        method      TEXT NOT NULL,
        updated_at  INTEGER NOT NULL,
        hits        INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS blacklist (
        key        TEXT NOT NULL,
        video_id   TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (key, video_id)
      );
    `);
  }

  private readonly cacheEnabled: boolean;

  /** First non-expired match for any of the keys. */
  get(keys: string[]): CachedMatch | null {
    if (!this.cacheEnabled || !this.db) return null;
    const stmt = this.db.prepare<[string], MatchRow>("SELECT * FROM matches WHERE key = ?");
    for (const key of keys) {
      const row = stmt.get(key);
      if (!row) continue;
      if (this.maxAgeMs > 0 && Date.now() - row.updated_at > this.maxAgeMs) {
        this.delete([key]);
        continue;
      }
      if (this.isBlacklisted(keys, row.video_id)) {
        this.delete([key]);
        continue;
      }
      this.db.prepare("UPDATE matches SET hits = hits + 1 WHERE key = ?").run(key);
      return {
        key: row.key,
        videoId: row.video_id,
        encoded: row.encoded,
        title: row.title,
        author: row.author,
        durationMs: row.duration_ms,
        score: row.score,
        method: row.method,
      };
    }
    return null;
  }

  set(match: CachedMatch): void {
    if (!this.cacheEnabled || !this.db) return;
    this.db
      .prepare(
        `INSERT INTO matches (key, video_id, encoded, title, author, duration_ms, score, method, updated_at)
         VALUES (@key, @videoId, @encoded, @title, @author, @durationMs, @score, @method, @now)
         ON CONFLICT(key) DO UPDATE SET video_id = excluded.video_id, encoded = excluded.encoded,
           title = excluded.title, author = excluded.author, duration_ms = excluded.duration_ms,
           score = excluded.score, method = excluded.method, updated_at = excluded.updated_at`,
      )
      .run({ ...match, now: Date.now() });
  }

  delete(keys: string[]): void {
    if (!this.db) return;
    const stmt = this.db.prepare("DELETE FROM matches WHERE key = ?");
    for (const key of keys) stmt.run(key);
  }

  blacklist(keys: string[], videoId: string): void {
    if (!this.db) return;
    const stmt = this.db.prepare("INSERT OR IGNORE INTO blacklist (key, video_id, created_at) VALUES (?, ?, ?)");
    for (const key of keys) stmt.run(key, videoId, Date.now());
  }

  blacklisted(keys: string[]): Set<string> {
    const out = new Set<string>();
    if (!this.db || keys.length === 0) return out;
    const stmt = this.db.prepare<[string], { video_id: string }>("SELECT video_id FROM blacklist WHERE key = ?");
    for (const key of keys) for (const row of stmt.all(key)) out.add(row.video_id);
    return out;
  }

  isBlacklisted(keys: string[], videoId: string): boolean {
    return this.blacklisted(keys).has(videoId);
  }

  close(): void {
    this.db?.close();
  }
}
