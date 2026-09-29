import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Destination {
  id: number;
  label: string;
  chatId: string;
  enabled: boolean;
  createdAt: string;
}

export interface BotState {
  mode: "idle" | "continuous" | "batch";
  batchItems: string;
}

const DEFAULT_STATE: BotState = { mode: "idle", batchItems: "[]" };

export class Store {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dataDirectory = dirname(dbPath);
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    this.db = new Database(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1) throw new Error(`Database schema version ${version} is newer than supported`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS destinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        chat_id TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS bot_state (
        user_id INTEGER PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'idle',
        batch_items TEXT NOT NULL DEFAULT '[]'
      );
    `);
    this.db.pragma("user_version = 1");
  }

  seedDefaultsIfEmpty(defaults: { label: string; chatId: string }[]): void {
    const count = this.db
      .prepare("SELECT COUNT(*) as n FROM destinations")
      .get() as { n: number };
    if (count.n > 0) return;
    const insert = this.db.prepare(
      "INSERT INTO destinations (label, chat_id, enabled) VALUES (?, ?, 1)",
    );
    for (const dest of defaults) {
      insert.run(dest.label, dest.chatId);
    }
  }

  listDestinations(): Destination[] {
    const rows = this.db
      .prepare(
        "SELECT id, label, chat_id as chatId, enabled, created_at as createdAt FROM destinations ORDER BY id",
      )
      .all() as Array<{
      id: number;
      label: string;
      chatId: string;
      enabled: number;
      createdAt: string;
    }>;
    return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
  }

  listEnabledDestinations(): Destination[] {
    return this.listDestinations().filter((dest) => dest.enabled);
  }

  addDestination(label: string, chatId: string): Destination {
    const row = this.db
      .prepare(`
        INSERT INTO destinations (label, chat_id, enabled) VALUES (?, ?, 1)
        RETURNING id, label, chat_id as chatId, enabled, created_at as createdAt
      `)
      .get(label, chatId) as {
        id: number;
        label: string;
        chatId: string;
        enabled: number;
        createdAt: string;
      };
    return { ...row, enabled: row.enabled === 1 };
  }

  removeDestination(id: number): boolean {
    const info = this.db.prepare("DELETE FROM destinations WHERE id = ?").run(id);
    return info.changes > 0;
  }

  toggleDestination(id: number, enabled: boolean): boolean {
    const info = this.db
      .prepare("UPDATE destinations SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
    return info.changes > 0;
  }

  getState(userId: number): BotState {
    const row = this.db
      .prepare("SELECT mode, batch_items as batchItems FROM bot_state WHERE user_id = ?")
      .get(userId) as BotState | undefined;
    return row ?? { ...DEFAULT_STATE };
  }

  setState(userId: number, state: BotState): void {
    this.db
      .prepare(
        `INSERT INTO bot_state (user_id, mode, batch_items) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode, batch_items = excluded.batch_items`,
      )
      .run(userId, state.mode, state.batchItems);
  }

  close(): void {
    this.db.close();
  }
}
