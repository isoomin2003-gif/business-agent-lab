// SQLite 데이터베이스 (Node 내장 node:sqlite). DB_PATH 환경 변수로 파일 위치 지정.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      nickname_key TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id),
      rules_version TEXT NOT NULL,
      seed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      finished_at INTEGER,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id, created_at);
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
      player_id TEXT NOT NULL REFERENCES players(id),
      rules_version TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      head_kills INTEGER NOT NULL,
      timeouts INTEGER NOT NULL,
      shots INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_version ON runs(rules_version, player_id, time_ms);
  `);

  // 이전 버전(고정 시드) DB에는 seed 열이 없으므로 추가
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!cols.includes('seed')) db.exec('ALTER TABLE sessions ADD COLUMN seed INTEGER NOT NULL DEFAULT 0');
  // 이전 DB에는 기록별 배경 ID 열이 없으므로 추가 (이전 기록은 당시 유일한 배경 'range')
  const runCols = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
  if (!runCols.includes('background_id')) db.exec("ALTER TABLE runs ADD COLUMN background_id TEXT NOT NULL DEFAULT 'range'");

  const stmts = {
    insertPlayer: db.prepare('INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    playerByToken: db.prepare('SELECT id, nickname, created_at FROM players WHERE token_hash = ?'),
    playerByNickKey: db.prepare('SELECT id FROM players WHERE nickname_key = ?'),
    renamePlayer: db.prepare('UPDATE players SET nickname = ?, nickname_key = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (id, player_id, rules_version, seed, created_at) VALUES (?, ?, ?, ?, ?)'),
    getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    closeSession: db.prepare("UPDATE sessions SET status = ?, finished_at = ?, reason = ? WHERE id = ? AND status = 'open'"),
    expireOpenSessions: db.prepare("UPDATE sessions SET status = 'aborted', finished_at = ?, reason = '새 세션 시작' WHERE player_id = ? AND status = 'open'"),
    insertRun: db.prepare('INSERT INTO runs (session_id, player_id, rules_version, time_ms, head_kills, timeouts, shots, created_at, background_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    bestOf: db.prepare('SELECT MIN(time_ms) AS best FROM runs WHERE rules_version = ? AND player_id = ?'),
    ranked: db.prepare(`
      WITH best AS (
        SELECT player_id, time_ms, created_at,
               ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY time_ms ASC, created_at ASC) AS rn
        FROM runs WHERE rules_version = ?
      ), ordered AS (
        SELECT b.player_id, p.nickname, b.time_ms, b.created_at,
               ROW_NUMBER() OVER (ORDER BY b.time_ms ASC, b.created_at ASC) AS rank
        FROM best b JOIN players p ON p.id = b.player_id WHERE b.rn = 1
      )
      SELECT * FROM ordered WHERE rank <= ? OR player_id = ? ORDER BY rank
    `),
    countPlayers: db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM runs WHERE rules_version = ?'),
  };

  return { db, stmts };
}
