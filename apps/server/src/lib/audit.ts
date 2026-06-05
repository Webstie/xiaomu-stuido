/**
 * Append-only audit log writer.
 * Writes JSONL to data/audit.jsonl.
 * UI is deferred per CLAUDE.md; data is captured silently.
 */
import { writeFile } from 'fs/promises';
import path from 'path';
import { getDataPath } from './fileStore.js';

export async function appendAudit(entry: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  await writeFile(getDataPath('audit.jsonl'), line, { flag: 'a' }).catch(() => {
    // Non-fatal — audit must never crash the main path
  });
}
