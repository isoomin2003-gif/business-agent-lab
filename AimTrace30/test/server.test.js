import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { buildGameConfig, RANK } from '../public/js/config.js';
import { createEngine } from '../public/js/core/engine.js';

let clock = 1_700_000_000_000;
let server;
let appDb;
let base;

before(async () => {
  ({ server, db: appDb } = createApp({ dbFile: ':memory:', now: () => clock, limits: { registerPerHour: 1000, sessionsPerHour: 1000 } }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

/** 랭크 규칙대로 실제 플레이를 시뮬레이션해 제출 데이터를 만듦. missEvery: n번째마다 놓침 */
function simulateRank({ reaction = 350, missEvery = 0, bodyFirst = true } = {}, seed) {
  const e = createEngine(buildGameConfig('rank', null, seed));
  e.start();
  let i = 0;
  while (e.state.status === 'running') {
    const tg = e.state.current;
    i++;
    if (missEvery && i % missEvery === 0) {
      e.shoot(tg.spawnT + 200, 1, 1); // 허공
      e.advance(tg.expireAt);
    } else {
      const t = tg.spawnT + reaction;
      if (bodyFirst && i % 3 === 0) e.shoot(t - 100, tg.x0, tg.y0 + 40);
      e.shoot(t, tg.x0 + 2, tg.y0 - 1);
    }
    if (e.state.status === 'running') e.advance(e.state.nextSpawnAt);
  }
  const st = e.state;
  return {
    rulesVersion: RANK.rulesVersion,
    backgroundId: RANK.backgroundId,
    shots: st.shots.map((s) => ({ t: s.t, x: s.x, y: s.y })),
    claimed: { timeMs: st.endTime, score: st.score, headKills: st.headKills, timeouts: st.timeouts, outcomes: st.targets.map((t) => t.outcome) },
    flags: {},
  };
}

async function register(nick) {
  const r = await call('POST', '/api/players', { nickname: nick });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

const newSession = (token) => call('POST', '/api/rank/sessions', { rulesVersion: RANK.rulesVersion }, token);

/** 세션 발급 → 서버가 준 시드로 플레이 시뮬레이션 → (선택) 조작 → 제출 */
async function playAndSubmit(token, opts = {}, mutate = () => {}, wallExtraMs = 5000) {
  const s = await newSession(token);
  assert.equal(s.status, 200);
  assert.ok(Number.isInteger(s.data.seed));
  const payload = simulateRank(opts, s.data.seed);
  mutate(payload);
  clock += 3000 + payload.claimed.timeMs + wallExtraMs;
  const r = await call('POST', `/api/rank/sessions/${s.data.sessionId}/submit`, payload, token);
  return { ...r, payload };
}

test('헬스 체크와 규칙 버전', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.data.rulesVersion, RANK.rulesVersion);
});

test('사용자 등록: 토큰 발급, 닉네임 중복(대소문자 무시) 불가, 잘못된 닉네임 거부', async () => {
  const t = await register('Alpha');
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal((await call('POST', '/api/players', { nickname: 'alpha' })).status, 409);
  assert.equal((await call('POST', '/api/players', { nickname: 'a' })).status, 400);
  assert.equal((await call('POST', '/api/players', { nickname: '<script>' })).status, 400);
  const me = await call('GET', '/api/players/me', null, t);
  assert.equal(me.data.nickname, 'Alpha');
  assert.equal((await call('GET', '/api/players/me', null, 'f'.repeat(64))).status, 401);
});

test('정상 기록은 서버 재계산 후 등록되고 순위표에 표시됨', async () => {
  const token = await register('정상플레이어');
  const r = await playAndSubmit(token, { missEvery: 5 });
  const { payload } = r;
  assert.ok(payload.claimed.timeouts > 0);
  assert.equal(r.status, 200);
  assert.equal(r.data.ranked, true, JSON.stringify(r.data));
  assert.equal(r.data.timeMs, Math.round(payload.claimed.timeMs));
  const lb = await call('GET', '/api/leaderboard', null, token);
  const mine = lb.data.entries.find((e) => e.isMe);
  assert.equal(mine.nickname, '정상플레이어');
  assert.equal(mine.timeMs, r.data.timeMs);
});

test('사용자별 최고 기록 한 개만 순위에 표시, 느린 기록은 최고 기록을 바꾸지 않음', async () => {
  const token = await register('최고기록');
  const fast = await playAndSubmit(token, { reaction: 300 });
  const slow = await playAndSubmit(token, { reaction: 450, missEvery: 4 });
  assert.equal(fast.data.ranked, true);
  assert.equal(slow.data.ranked, true);
  assert.equal(slow.data.personalBest, false);
  const lb = await call('GET', '/api/leaderboard', null, token);
  const rows = lb.data.entries.filter((e) => e.nickname === '최고기록');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timeMs, fast.data.timeMs);
  // 순위는 시간 오름차순
  const times = lb.data.entries.map((e) => e.timeMs);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  // 다른 사람이 볼 때는 isMe가 아님
  const anon = await call('GET', '/api/leaderboard');
  assert.ok(anon.data.entries.every((e) => !e.isMe));
});

test('조작된 완료 시간·점수·결과는 거부', async () => {
  const token = await register('조작시도');
  assert.match((await playAndSubmit(token, {}, (p) => { p.claimed.timeMs -= 2000; })).data.reason, /완료 시간/);
  assert.match((await playAndSubmit(token, { missEvery: 5 }, (p) => { p.claimed.outcomes = p.claimed.outcomes.map(() => 'head'); })).data.reason, /성공·실패/);
  // 20점에 도달하지 않은 기록
  assert.match((await playAndSubmit(token, {}, (p) => { p.shots = p.shots.slice(0, -3); })).data.reason, /도달하지 않았습니다/);
  // 표적 위치와 맞지 않는 발사
  const r4 = await playAndSubmit(token, {}, (p) => { p.shots[0] = { ...p.shots[0], x: p.shots[0].x + 400 }; });
  assert.equal(r4.data.ranked, false);
  // 비정상적으로 빠른 반응
  assert.match((await playAndSubmit(token, { reaction: 40, bodyFirst: false })).data.reason, /빠른 명중/);

  // 실제로 흐른 시간보다 짧은 시간에 제출
  const s = await newSession(token);
  const p6 = simulateRank({}, s.data.seed);
  clock += 1000;
  assert.match((await call('POST', `/api/rank/sessions/${s.data.sessionId}/submit`, p6, token)).data.reason, /경과 시간/);

  const lb = await call('GET', '/api/leaderboard', null, token);
  assert.equal(lb.data.me, null, '조작 기록은 하나도 등록되지 않음');
});

test('탭 이탈·창 크기 변경 기록은 랭킹 제외, 세션 재사용·타인 세션 사용 불가', async () => {
  const token = await register('규칙위반');
  const r = await playAndSubmit(token, {}, (p) => { p.flags = { focusLost: true }; });
  assert.equal(r.data.ranked, false);
  assert.match(r.data.reason, /탭\/창 이탈/);

  assert.match((await playAndSubmit(token, {}, (p) => { p.flags = { resized: true }; })).data.reason, /창 크기 변경/);

  // 세션 재사용
  const s = await call('POST', '/api/rank/sessions', { rulesVersion: RANK.rulesVersion }, token);
  clock += 120000;
  const ok = await call('POST', `/api/rank/sessions/${s.data.sessionId}/submit`, simulateRank({}, s.data.seed), token);
  assert.equal(ok.data.ranked, true);
  const again = await call('POST', `/api/rank/sessions/${s.data.sessionId}/submit`, simulateRank({}, s.data.seed), token);
  assert.equal(again.status, 409);

  // 다른 사용자의 세션으로 제출 불가 (닉네임만으로 남의 기록을 덮어쓸 수 없음)
  const other = await register('다른사람');
  const s2 = await call('POST', '/api/rank/sessions', { rulesVersion: RANK.rulesVersion }, token);
  clock += 120000;
  const stolen = await call('POST', `/api/rank/sessions/${s2.data.sessionId}/submit`, simulateRank({}, s2.data.seed), other);
  assert.equal(stolen.status, 404);
  // 인증 없이 제출 불가
  assert.equal((await call('POST', `/api/rank/sessions/${s2.data.sessionId}/submit`, simulateRank({}, s2.data.seed))).status, 401);
});

test('중도 종료 세션은 이후 제출 불가', async () => {
  const token = await register('중도종료');
  const s = await call('POST', '/api/rank/sessions', { rulesVersion: RANK.rulesVersion }, token);
  await call('POST', `/api/rank/sessions/${s.data.sessionId}/abort`, {}, token);
  clock += 120000;
  const r = await call('POST', `/api/rank/sessions/${s.data.sessionId}/submit`, simulateRank({}, s.data.seed), token);
  assert.equal(r.status, 409);
});

test('랭크 세션마다 다른 무작위 시드 발급, 다른 시드로 플레이한 기록은 거부', async () => {
  const token = await register('무작위');
  const seeds = new Set();
  for (let i = 0; i < 5; i++) seeds.add((await newSession(token)).data.seed);
  assert.equal(seeds.size, 5, '세션마다 시드가 다름');
  // 서버가 발급한 시드가 아닌 다른 시드(다른 표적 위치·순서)로 만든 기록
  const s = await newSession(token);
  const forged = simulateRank({}, (s.data.seed + 1) >>> 0);
  clock += 3000 + forged.claimed.timeMs + 5000;
  const r = await call('POST', `/api/rank/sessions/${s.data.sessionId}/submit`, forged, token);
  assert.equal(r.data.ranked, false);
});

test('랭크 고정 배경이 아닌 기록은 거부, 기록에 배경 ID 저장', async () => {
  const token = await register('배경검사');
  assert.match((await playAndSubmit(token, {}, (p) => { p.backgroundId = 'dojo'; })).data.reason, /고정 배경/);
  const ok = await playAndSubmit(token, {});
  assert.equal(ok.data.ranked, true);
  const ids = appDb.prepare('SELECT DISTINCT background_id AS b FROM runs').all().map((r) => r.b);
  assert.deepEqual(ids, [RANK.backgroundId]);
});

test('규칙 버전이 다르면 세션 발급·제출 거부', async () => {
  const token = await register('구버전');
  assert.equal((await call('POST', '/api/rank/sessions', { rulesVersion: 'rank-v0' }, token)).status, 409);
  assert.match((await playAndSubmit(token, {}, (p) => { p.rulesVersion = 'rank-v0'; })).data.reason, /규칙 버전/);
});

test('닉네임 변경은 본인만, 다른 사람 닉네임으로 변경 불가', async () => {
  const a = await register('변경A');
  await register('변경B');
  assert.equal((await call('PATCH', '/api/players/me', { nickname: '변경B' }, a)).status, 409);
  assert.equal((await call('PATCH', '/api/players/me', { nickname: '변경C' }, a)).data.nickname, '변경C');
  assert.equal((await call('PATCH', '/api/players/me', { nickname: '변경D' })).status, 401);
});

test('정적 파일 제공과 경로 이탈 차단', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /AimTrace30/);
  const js = await fetch(`${base}/js/core/engine.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  const bad = await fetch(`${base}/..%2fserver%2findex.js`);
  assert.notEqual(bad.status, 200);
});
