/**
 * ArcRoute – SQLite database layer (using better-sqlite3)
 *
 * Schema:
 *   transactions
 *     id          TEXT PRIMARY KEY
 *     chain       TEXT
 *     token       TEXT
 *     amount      TEXT
 *     destination TEXT
 *     status      TEXT   -- pending | swapping | bridging | sending | completed | failed
 *     step_swap   TEXT   -- pending | done | skipped | failed
 *     step_bridge TEXT
 *     step_send   TEXT
 *     tx_hash     TEXT
 *     error       TEXT
 *     created_at  TEXT
 *     updated_at  TEXT
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH ?? './arcroute.db';

// Ensure parent directory exists
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// ── Pragmas for performance & safety ─────────────────────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    chain       TEXT NOT NULL,
    token       TEXT NOT NULL,
    amount      TEXT NOT NULL,
    destination TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    step_swap   TEXT NOT NULL DEFAULT 'pending',
    step_bridge TEXT NOT NULL DEFAULT 'pending',
    step_send   TEXT NOT NULL DEFAULT 'pending',
    tx_hash     TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

// ─── Types ────────────────────────────────────────────────────────────────────
export type StepStatus = 'pending' | 'done' | 'skipped' | 'failed';
export type TxStatus = 'pending' | 'swapping' | 'bridging' | 'sending' | 'completed' | 'failed';

export interface Transaction {
  id: string;
  chain: string;
  token: string;
  amount: string;
  destination: string;
  status: TxStatus;
  step_swap: StepStatus;
  step_bridge: StepStatus;
  step_send: StepStatus;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Repository ───────────────────────────────────────────────────────────────
export const txRepo = {
  create(data: Pick<Transaction, 'id' | 'chain' | 'token' | 'amount' | 'destination'>): Transaction {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO transactions (id, chain, token, amount, destination, status,
        step_swap, step_bridge, step_send, tx_hash, error, created_at, updated_at)
      VALUES (@id, @chain, @token, @amount, @destination, 'pending',
        'pending', 'pending', 'pending', NULL, NULL, @now, @now)
    `);
    stmt.run({ ...data, now });
    return this.findById(data.id)!;
  },

  findById(id: string): Transaction | undefined {
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Transaction | undefined;
  },

  update(id: string, patch: Partial<Omit<Transaction, 'id' | 'created_at'>>): void {
    const now = new Date().toISOString();
    const fields = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE transactions SET ${fields}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...patch, updated_at: now, id });
  },
};

export default db;
