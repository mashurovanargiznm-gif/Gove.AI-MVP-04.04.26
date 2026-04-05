import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../transactions.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    debtor_bin TEXT NOT NULL,
    amount_kzt REAL NOT NULL,
    description TEXT NOT NULL,
    knp_code TEXT NOT NULL,
    oked_code TEXT NOT NULL,
    receiver_iin TEXT NOT NULL,
    ai_decision TEXT NOT NULL,
    withheld_percent INTEGER NOT NULL DEFAULT 0,
    ai_reason TEXT NOT NULL,
    strike_count INTEGER NOT NULL DEFAULT 0,
    solana_signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
  )
`);

// Migrate existing tables that may not have strike_count column
try {
  db.exec(`ALTER TABLE transactions ADD COLUMN strike_count INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

export interface Transaction {
  id: string;
  created_at: string;
  debtor_bin: string;
  amount_kzt: number;
  description: string;
  knp_code: string;
  oked_code: string;
  receiver_iin: string;
  ai_decision: string;
  withheld_percent: number;
  ai_reason: string;
  strike_count: number;
  solana_signature: string | null;
  status: "pending" | "approved" | "blocked";
}

export function insertTransaction(data: Omit<Transaction, "id" | "created_at">): Transaction {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO transactions
      (id, debtor_bin, amount_kzt, description, knp_code, oked_code, receiver_iin,
       ai_decision, withheld_percent, ai_reason, strike_count, solana_signature, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.debtor_bin,
    data.amount_kzt,
    data.description,
    data.knp_code,
    data.oked_code,
    data.receiver_iin,
    data.ai_decision,
    data.withheld_percent,
    data.ai_reason,
    data.strike_count,
    data.solana_signature ?? null,
    data.status
  );
  return getTransaction(id)!;
}

export function getTransaction(id: string): Transaction | null {
  return db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Transaction | null;
}

export function updateTransaction(id: string, updates: Partial<Transaction>): void {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;
  const fields = keys.map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE transactions SET ${fields} WHERE id = ?`).run(...values);
}

export function getAllTransactions(): Transaction[] {
  return db.prepare("SELECT * FROM transactions ORDER BY created_at DESC").all() as Transaction[];
}

/**
 * Returns the cumulative number of BLOCK decisions for a given BIN
 * (i.e., how many times this company has triggered a violation).
 */
export function getStrikeCount(debtor_bin: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM transactions WHERE debtor_bin = ? AND ai_decision = 'block'`)
    .get(debtor_bin) as { cnt: number };
  return row?.cnt ?? 0;
}

/**
 * Returns a short history of recent transactions for a BIN,
 * used as context for the AI strike-system analysis.
 */
export function getRecentHistory(debtor_bin: string, limit = 10): Transaction[] {
  return db
    .prepare(`SELECT * FROM transactions WHERE debtor_bin = ? ORDER BY created_at DESC LIMIT ?`)
    .all(debtor_bin, limit) as Transaction[];
}
