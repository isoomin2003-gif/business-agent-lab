// HTTP 서버: 정적 파일(public/) 제공 + 랭킹 API. 외부 의존성 없음 (Node 22.13+).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { validateRankRun } from './validate.js';
import { RANK } from '../public/js/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const NICK_RE = /^[0-9A-Za-z가-힣_-]{2,12}$/;
const LEADERBOARD_LIMIT = 50;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nickKey = (n) => n.toLowerCase();

/** 간단한 IP별 요청 제한 (메모리) */
function createRateLimiter() {
  const buckets = new Map();
  return function hit(key, limit, windowMs) {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now - b.start > windowMs) {
      buckets.set(key, { start: now, n: 1 });
      if (buckets.size > 10000) buckets.clear();
      return true;
    }
    b.n += 1;
    return b.n <= limit;
  };
}

export function createApp({
  dbFile = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'ranking.db'),
  now = () => Date.now(),
  limits = { registerPerHour: 30, sessionsPerHour: 120 },
} = {}) {
  const { db, stmts } = openDb(dbFile);
  const limiter = createRateLimiter();

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 1_000_000) { reject(new HttpError(413, '요청이 너무 큽니다.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON 형식이 올바르지 않습니다.')); }
      });
      req.on('error', reject);
    });
  }

  function auth(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer ([0-9a-f]{64})$/.exec(h);
    if (!m) throw new HttpError(401, '사용자 인증 정보가 없습니다.');
    const p = stmts.playerByToken.get(sha256(m[1]));
    if (!p) throw new HttpError(401, '등록되지 않은 사용자입니다.');
    return p;
  }

  function validNickname(raw) {
    const nick = typeof raw === 'string' ? raw.trim() : '';
    if (!NICK_RE.test(nick)) throw new HttpError(400, '닉네임은 2~12자의 한글·영문·숫자·_·- 만 사용할 수 있습니다.');
    return nick;
  }

  function ip(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  }

  const routes = {
    'GET /api/health': () => ({ ok: true, rulesVersion: RANK.rulesVersion }),

    // 사용자 등록: 무작위 토큰 발급. 서버는 토큰의 해시만 저장. 닉네임은 중복 불가(대소문자 무시)
    'POST /api/players': async (req) => {
      if (!limiter(`reg:${ip(req)}`, limits.registerPerHour, 60 * 60 * 1000)) throw new HttpError(429, '잠시 후 다시 시도해 주세요.');
      const body = await readJson(req);
      const nick = validNickname(body.nickname);
      if (stmts.playerByNickKey.get(nickKey(nick))) throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString('hex');
      try {
        stmts.insertPlayer.run(id, nick, nickKey(nick), sha256(token), now());
      } catch {
        throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
      }
      return { playerId: id, nickname: nick, token };
    },

    'GET /api/players/me': (req) => {
      const p = auth(req);
      return { playerId: p.id, nickname: p.nickname };
    },

    'PATCH /api/players/me': async (req) => {
      const p = auth(req);
      const body = await readJson(req);
      const nick = validNickname(body.nickname);
      const other = stmts.playerByNickKey.get(nickKey(nick));
      if (other && other.id !== p.id) throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
      stmts.renamePlayer.run(nick, nickKey(nick), p.id);
      return { playerId: p.id, nickname: nick };
    },

    // 랭크 세션 발급: 서버 시각을 기록하고, 이 판의 표적 위치·순서를 정할 무작위 시드를 발급
    'POST /api/rank/sessions': async (req) => {
      const p = auth(req);
      if (!limiter(`sess:${p.id}`, limits.sessionsPerHour, 60 * 60 * 1000)) throw new HttpError(429, '세션 요청이 너무 많습니다.');
      const body = await readJson(req);
      if (body.rulesVersion !== RANK.rulesVersion) throw new HttpError(409, '랭크 규칙이 변경되었습니다. 페이지를 새로고침해 주세요.');
      const t = now();
      stmts.expireOpenSessions.run(t, p.id);
      const id = crypto.randomUUID();
      const seed = crypto.randomInt(0, 2 ** 32 - 1);
      stmts.insertSession.run(id, p.id, RANK.rulesVersion, seed, t);
      return { sessionId: id, rulesVersion: RANK.rulesVersion, seed };
    },

    'POST /api/rank/sessions/:id/abort': (req, params) => {
      const p = auth(req);
      const s = stmts.getSession.get(params.id);
      if (!s || s.player_id !== p.id) throw new HttpError(404, '세션을 찾을 수 없습니다.');
      stmts.closeSession.run('aborted', now(), '중도 종료', s.id);
      return { ok: true };
    },

    'POST /api/rank/sessions/:id/submit': async (req, params) => {
      const p = auth(req);
      const body = await readJson(req);
      const s = stmts.getSession.get(params.id);
      if (!s || s.player_id !== p.id) throw new HttpError(404, '세션을 찾을 수 없습니다.');
      if (s.status !== 'open') throw new HttpError(409, '이미 종료되었거나 사용된 세션입니다.');
      const t = now();

      const flags = body.flags || {};
      if (flags.focusLost || flags.resized) {
        const reason = flags.focusLost ? '진행 중 탭/창 이탈' : '진행 중 창 크기 변경';
        stmts.closeSession.run('disqualified', t, reason, s.id);
        return { ranked: false, reason: `${reason}으로 랭킹 등록 대상에서 제외되었습니다.` };
      }

      const v = validateRankRun(body, s, t);
      if (!v.ok) {
        stmts.closeSession.run('rejected', t, v.reason, s.id);
        return { ranked: false, reason: v.reason };
      }
      const prev = stmts.bestOf.get(RANK.rulesVersion, p.id).best;
      db.exec('BEGIN');
      try {
        const changed = stmts.closeSession.run('completed', t, null, s.id).changes;
        if (changed !== 1) throw new HttpError(409, '이미 사용된 세션입니다.');
        stmts.insertRun.run(s.id, p.id, RANK.rulesVersion, v.result.timeMs, v.result.headKills, v.result.timeouts, v.result.shots, t, v.result.backgroundId);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      const rows = stmts.ranked.all(RANK.rulesVersion, LEADERBOARD_LIMIT, p.id);
      const mine = rows.find((r) => r.player_id === p.id);
      return {
        ranked: true,
        timeMs: v.result.timeMs,
        previousBestMs: prev ?? null,
        personalBest: prev == null || v.result.timeMs < prev,
        rank: mine ? mine.rank : null,
      };
    },

    'GET /api/leaderboard': (req) => {
      let me = null;
      if (req.headers.authorization) {
        try { me = auth(req); } catch { me = null; }
      }
      const rows = stmts.ranked.all(RANK.rulesVersion, LEADERBOARD_LIMIT, me ? me.id : '');
      const top = rows.filter((r) => r.rank <= LEADERBOARD_LIMIT);
      const mineRow = me ? rows.find((r) => r.player_id === me.id) : null;
      const map = (r) => ({ rank: r.rank, nickname: r.nickname, timeMs: r.time_ms, achievedAt: r.created_at, isMe: !!me && r.player_id === me.id });
      return {
        rulesVersion: RANK.rulesVersion,
        totalPlayers: stmts.countPlayers.get(RANK.rulesVersion).n,
        entries: top.map(map),
        me: mineRow ? map(mineRow) : null,
      };
    },
  };

  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ');
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([0-9a-f-]{36})'; }) + '$');
    return { method, re, names, handler };
  });

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(PUBLIC_DIR, '.' + rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      serveStatic(req, res, url.pathname);
      return;
    }
    try {
      for (const r of compiled) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]]));
        const out = await r.handler(req, params);
        sendJson(res, 200, out);
        return;
      }
      throw new HttpError(404, '알 수 없는 API입니다.');
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
      else { console.error(e); sendJson(res, 500, { error: '서버 오류가 발생했습니다.' }); }
    }
  });

  return { server, db };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`AimTrace30 서버 실행 중: http://localhost:${port}`);
  });
}
