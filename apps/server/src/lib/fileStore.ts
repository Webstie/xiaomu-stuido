/**
 * JSON file store for local-first persistence.
 * All paths are relative to DATA_DIR (repo root ./data by default).
 *
 * Resolves DATA_DIR relative to the repo root so it works regardless of
 * the process CWD (which changes when pnpm runs sub-package scripts).
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
// lib/ → src/ → server/ → apps/ → repo root
const REPO_ROOT = path.resolve(path.dirname(__filename), '../../../../');

const DATA_DIR_ENV = process.env['DATA_DIR'] ?? './data';
const DATA_DIR = path.isAbsolute(DATA_DIR_ENV)
  ? DATA_DIR_ENV
  : path.resolve(REPO_ROOT, DATA_DIR_ENV);

export function getDataPath(relativePath: string): string {
  return path.join(DATA_DIR, relativePath);
}

export async function ensureDir(relativePath: string): Promise<void> {
  await fs.mkdir(path.join(DATA_DIR, relativePath), { recursive: true });
}

export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(DATA_DIR, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(relativePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, relativePath), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(relativePath: string, data: T): Promise<void> {
  const fullPath = path.join(DATA_DIR, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listJsonDir(relativePath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(DATA_DIR, relativePath));
    return entries.filter((e) => e.endsWith('.json')).map((e) => e.replace('.json', ''));
  } catch {
    return [];
  }
}
