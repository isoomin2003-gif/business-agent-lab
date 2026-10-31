// 랭킹 서버 API 클라이언트. 같은 출처(origin)의 /api 를 사용합니다.
const STORE_KEY = 'aimTrainer.player.v1';
let memoryPlayer = null;

export function loadPlayer() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : memoryPlayer;
  } catch {
    return memoryPlayer;
  }
}

function savePlayer(p) {
  memoryPlayer = p;
  try {
    if (p) localStorage.setItem(STORE_KEY, JSON.stringify(p));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* 저장 불가 환경: 메모리에만 유지 */ }
}

async function request(method, path, body, { auth = false, timeoutMs = 8000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const p = loadPlayer();
  if (auth || p) {
    if (p?.token) headers.Authorization = `Bearer ${p.token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
  } catch {
    throw Object.assign(new Error('서버에 연결할 수 없습니다.'), { network: true });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error(data?.error || `서버 오류 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (data === null) throw Object.assign(new Error('서버 응답이 올바르지 않습니다.'), { network: true });
  return data;
}

export const api = {
  health: () => request('GET', '/health', null, { timeoutMs: 4000 }),
  async register(nickname) {
    const r = await request('POST', '/players', { nickname });
    savePlayer({ playerId: r.playerId, nickname: r.nickname, token: r.token });
    return r;
  },
  async me() {
    const r = await request('GET', '/players/me', null, { auth: true });
    const p = loadPlayer();
    if (p) savePlayer({ ...p, nickname: r.nickname });
    return r;
  },
  async rename(nickname) {
    const r = await request('PATCH', '/players/me', { nickname }, { auth: true });
    savePlayer({ ...loadPlayer(), nickname: r.nickname });
    return r;
  },
  forget: () => savePlayer(null),
  leaderboard: () => request('GET', '/leaderboard'),
  createSession: (rulesVersion) => request('POST', '/rank/sessions', { rulesVersion }, { auth: true }),
  abortSession: (id) => request('POST', `/rank/sessions/${id}/abort`, {}, { auth: true }),
  submit: (id, payload) => request('POST', `/rank/sessions/${id}/submit`, payload, { auth: true, timeoutMs: 15000 }),
};
