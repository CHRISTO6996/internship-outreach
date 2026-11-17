import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databasePath } from '../config.js';

const schema = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');

export const db = new DatabaseSync(databasePath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(schema);

/** Run a statement and return the inserted row id. */
export function insert(sql, ...params) {
  const result = db.prepare(sql).run(...params);
  return Number(result.lastInsertRowid);
}

/** Convenience: single row or undefined. */
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

/** Convenience: all rows. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function nowIso() {
  return new Date().toISOString();
}
