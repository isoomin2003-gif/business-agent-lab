import {
  ARENA, TARGET_SHAPE, VISUAL_FX, DIFFICULTIES, SPAWN_GAP_MS, COUNTDOWN_SECONDS,
  RANK, MODES, ANALYSIS_TYPES, CURSOR_SAMPLE_MIN_INTERVAL_MS, TRACKING, buildGameConfig,
} from './config.js';
import { createEngine, STATUS } from './core/engine.js';
import { createTrackingEngine } from './core/tracking.js';
import { randomSeed } from './core/rng.js';
import { PART_LABEL } from './analysis.js';
import { setupCanvas, drawScoreBoard, drawSilhouette, drawTimerBar, drawEffect, drawBall, makeKillBurst } from './render.js';
import { pickBackground, prepareBackground, drawPreparedBackground } from './backgrounds.js';
import { createAudio } from './audio.js';
import { initHome, paintHomeBackground } from './home.js';
import { renderResult, showRankOutcome, recordMetrics } from './results.js';
import { saveRecord, lastRecord } from './history.js';
import { api, loadPlayer } from './api.js';
import { $, $$, esc, fmtSec, fmtDate } from './ui.js';

const MIN_VIEW = { width: ARENA.width + 40, height: ARENA.height + 120 };
const LAST_BG_KEY = 'aimTrainer.lastBackground.v1';

const audio = createAudio();
let home = null;

// ---------- 화면 전환 (화면마다 배경음악 지정) ----------
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  window.scrollTo(0, 0);
  if (name === 'home' || name === 'rank') audio.setScene('home');
  else if (name === 'result') audio.setScene('result');
  if (name === 'home') paintHomeBackground();
}

// ---------- 기기 / 창 크기 안내 ----------
const isTouchOnly = () => !window.matchMedia('(pointer: fine)').matches;
const viewTooSmall = () => window.innerWidth < MIN_VIEW.width || window.innerHeight < MIN_VIEW.height;

function showDeviceNotice(text, dismissable = true) {
  $('#device-notice-text').textContent = text;
  $('#device-notice-close').hidden = !dismissable;
  $('#device-notice').hidden = false;
}
function checkDevice() {
  if (isTouchOnly()) showDeviceNotice('이 에임 훈련은 PC 마우스 사용을 기준으로 만들어졌습니다. 마우스가 연결된 PC 브라우저에서 접속해 주세요.');
}
function canStartGame() {
  if (viewTooSmall()) {
    showDeviceNotice(`게임 영역(${ARENA.width}×${ARENA.height})이 모두 보이도록 브라우저 창을 넓혀 주세요. 최소 ${MIN_VIEW.width}×${MIN_VIEW.height} 이상이 필요합니다. (현재 ${window.innerWidth}×${window.innerHeight})`);
    return false;
  }
  return true;
}

// ---------- 설정 ----------
function initSettings() {
  const modal = $('#settings-modal');
  const fill = () => {
    const st = audio.settings;
    $('#set-music-on').checked = st.musicOn;
    $('#set-music-vol').value = Math.round(st.musicVolume * 100);
    $('#set-music-val').textContent = `${Math.round(st.musicVolume * 100)}`;
    $('#set-sfx-on').checked = st.sfxOn;
    $('#set-sfx-vol').value = Math.round(st.sfxVolume * 100);
    $('#set-sfx-val').textContent = `${Math.round(st.sfxVolume * 100)}`;
    $('#set-track-on').checked = st.trackOn;
    $('#set-track-vol').value = Math.round(st.trackVolume * 100);
    $('#set-track-val').textContent = `${Math.round(st.trackVolume * 100)}`;
  };
  const open = () => { fill(); modal.hidden = false; $('#settings-close').focus(); };
  $('#set-music-on').addEventListener('change', (e) => audio.update({ musicOn: e.target.checked }));
  $('#set-sfx-on').addEventListener('change', (e) => audio.update({ sfxOn: e.target.checked }));
  $('#set-music-vol').addEventListener('input', (e) => { audio.update({ musicVolume: e.target.value / 100 }); fill(); });
  $('#set-sfx-vol').addEventListener('input', (e) => { audio.update({ sfxVolume: e.target.value / 100 }); fill(); });
  $('#set-track-on').addEventListener('change', (e) => audio.update({ trackOn: e.target.checked }));
  $('#set-track-vol').addEventListener('input', (e) => { audio.update({ trackVolume: e.target.value / 100 }); fill(); });
  $('#settings-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  $('#result-settings').addEventListener('click', open);
  return open;
}

// ---------- 게임 진행 ----------
const canvas = $('#arena');
let ctx = null;
let current = null; // 진행 중인 게임 (다시 시작하면 완전히 새로 만듦)
let gameSeq = 0;

function readLastBg() { try { return localStorage.getItem(LAST_BG_KEY); } catch { return null; } }
function writeLastBg(id) { try { localStorage.setItem(LAST_BG_KEY, id); } catch { /* 저장 불가 */ } }

function cleanupGame() {
  if (!current) return;
  cancelAnimationFrame(current.raf);
  current.timers.forEach(clearTimeout);
  current.timers = [];
  if (current.rankWatch) current.rankWatch.detach();
  if (current.rank?.sessionId && !current.closed && current.rank.online) api.abortSession(current.rank.sessionId).catch(() => {});
  current.closed = true;
  current = null;
  audio.trackingToneStop();
  audio.resume('tracking-pause');
  $('#countdown').hidden = true;
  $('#loading').hidden = true;
  $('#pause-overlay').hidden = true;
  $('#rank-banner').hidden = true;
}

function eventTime(e) {
  const now = performance.now();
  const ts = e.timeStamp;
  return typeof ts === 'number' && ts > 0 && ts <= now + 5 && now - ts < 1000 ? ts : now;
}

function arenaPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * ARENA.width) / rect.width,
    y: ((e.clientY - rect.top) * ARENA.height) / rect.height,
    inside: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
  };
}

/** 트래킹 시계: 공이 움직이기 시작한 뒤 흐른 실제 시간 (일시정지 시간 제외) */
function playClock(g, now) {
  if (g.t0 === null) return 0;
  const end = g.phase === 'paused' ? g.pausedAt : now;
  return end - g.t0 - g.pausedTotal;
}

/**
 * @param {string} mode basic | moving | analysis | rank | tracking
 * @param {string|null} option 난이도 또는 분석 유형
 * @param {{ rank?: object, backgroundId?: string }} opts backgroundId: 같은 조건 다시 하기에서 직전 배경 유지
 */
async function startGame(mode, option, { rank = null, backgroundId = null } = {}) {
  if (!canStartGame()) return;
  cleanupGame();
  const id = ++gameSeq;
  const requested = backgroundId ?? pickBackground(mode, readLastBg());
  showScreen('game');
  audio.setScene(mode === 'tracking' ? 'tracking' : 'none'); // 사격 모드는 배경음악 없이 효과음만
  $('#hud-items').innerHTML = '';
  $('#hud-last').innerHTML = '';
  ctx = setupCanvas(canvas, ARENA.width, ARENA.height);
  ctx.fillStyle = '#0d121b';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  $('#loading').hidden = false;
  // 배경은 카운트다운 전에 준비 완료 (실패하면 기본 배경)
  const bg = await prepareBackground(requested);
  if (id !== gameSeq) return;
  $('#loading').hidden = true;
  writeLastBg(requested);

  const kind = mode === 'tracking' ? 'tracking' : 'targets';
  const cfg = buildGameConfig(mode, option, rank?.seed ?? randomSeed());
  const engine = kind === 'tracking' ? createTrackingEngine(cfg) : createEngine(cfg, { cursorSampleMs: CURSOR_SAMPLE_MIN_INTERVAL_MS });
  current = {
    id, mode, option, kind, cfg, engine, rank, bg,
    t0: null, raf: 0, timers: [], effects: [], flash: null,
    phase: 'countdown', closed: false, pausedTotal: 0, pausedAt: null,
    rankWatch: null,
  };
  render(performance.now());
  updateHud(performance.now());
  if (mode === 'rank') current.rankWatch = watchRankEnvironment(current);
  runCountdown(id);
}

function runCountdown(id) {
  const cd = $('#countdown');
  const num = $('#countdown-num');
  cd.hidden = false;
  let n = COUNTDOWN_SECONDS;
  num.textContent = n;
  const tick = () => {
    if (!current || current.id !== id || current.phase !== 'countdown') return;
    n -= 1;
    if (n > 0) {
      num.textContent = n;
      current.timers.push(setTimeout(tick, 1000));
    } else {
      cd.hidden = true;
      beginPlay(id);
    }
  };
  current.timers.push(setTimeout(tick, 1000));
}

function beginPlay(id) {
  if (!current || current.id !== id) return;
  current.phase = 'playing';
  current.t0 = performance.now(); // 사격 모드: 첫 표적 등장 = 0, 트래킹: 공이 움직이기 시작 = 0
  if (current.kind === 'tracking') {
    current.engine.start();
    audio.trackingToneStart();
  }
  else handleEvents(current.engine.start(), current.t0);
  const loop = () => {
    const g = current;
    if (!g || g.id !== id) return;
    const now = performance.now();
    if (g.kind === 'tracking') {
      if (g.phase === 'playing') {
        g.engine.advance(playClock(g, now));
        if (g.engine.state.status === 'finished') { finishGame(); return; }
      }
    } else {
      handleEvents(g.engine.advance(now - g.t0), now);
      if (current !== g) return;
    }
    render(now);
    updateHud(now);
    if (g.rankWatch) g.rankWatch.poll();
    if (g.phase === 'playing' || g.phase === 'paused') g.raf = requestAnimationFrame(loop);
  };
  current.raf = requestAnimationFrame(loop);
}

function handleEvents(events, now) {
  if (!current) return;
  const { engine } = current;
  for (const ev of events) {
    if (ev.type === 'timeout') {
      const pose = engine.targetPose(ev.target, ev.target.expireAt);
      current.effects.push({
        kind: 'vanish', layer: 'under', shape: TARGET_SHAPE, x: pose.x, y: pose.y,
        t0: current.t0 + ev.target.expireAt, dur: VISUAL_FX.timeoutFlashMs,
      });
    } else if (ev.type === 'finish') {
      finishGame();
      return;
    }
  }
}

function onPointerDown(e) {
  if (e.button !== 0) return; // 왼쪽 버튼만. 누르고 있어도 연사되지 않음 (pointerdown 1회 = 1발)
  e.preventDefault();
  if (!current || current.phase !== 'playing') return; // 카운트다운·대기·종료 후 클릭은 기록·소리 없음
  if (current.kind === 'tracking') return; // 트래킹: 클릭은 판정·소리와 무관
  const ts = eventTime(e);
  const { x, y } = arenaPoint(e);
  const r = current.engine.shoot(ts - current.t0, x, y); // 판정 먼저
  const now = performance.now();
  if (r.counted) {
    const s = r.shot;
    audio.fire(s.part); // 판정 직후: 항상 같은 총성 + 명중 시 명중음(머리=헤드샷 확인음, 몸통·발=피격음)
    if (s.part === 'head') {
      current.effects.push(makeKillBurst(TARGET_SHAPE, s.hx, s.hy, now, VISUAL_FX));
    } else if (s.part === 'miss') {
      current.effects.push({ kind: 'hole', layer: 'under', x, y, t0: now, dur: VISUAL_FX.bulletHoleMs });
    } else {
      current.effects.push({ kind: 'hit', layer: 'over', x, y, t0: now, dur: 260 });
      current.flash = { part: s.part, t0: now, targetIndex: s.targetIndex };
    }
    const cls = { head: 'p-head', body: 'p-body', feet: 'p-feet', miss: '' }[s.part];
    const label = s.part === 'miss' ? '빗나감' : `${PART_LABEL[s.part]} 명중${s.part === 'head' ? ' · 제거' : ''}`;
    $('#hud-last').innerHTML = `최근 발사: <b class="${cls}">${label}</b>`;
  } else if (current.engine.state.status === STATUS.RUNNING) {
    // 플레이 중 표적이 없는 대기 시간(등장 간격)의 클릭: 총소리와 탄흔만 표시하고 발사 기록·적중률·랭크 검증에는 넣지 않음
    audio.fire('miss');
    current.effects.push({ kind: 'hole', layer: 'under', x, y, t0: now, dur: VISUAL_FX.bulletHoleMs });
    $('#hud-last').innerHTML = '최근 발사: <b>빗나감</b> <span class="muted">(표적 없음)</span>';
  }
  handleEvents(r.events, now);
}

function onPointerMove(e) {
  const g = current;
  if (!g || g.phase !== 'playing') return;
  const { x, y } = arenaPoint(e);
  if (g.kind === 'tracking') {
    g.engine.setCursor(eventTime(e) - g.t0 - g.pausedTotal, x, y);
    return;
  }
  handleEvents(g.engine.trackCursor(eventTime(e) - g.t0, x, y), performance.now());
}

function onPointerLeave() {
  const g = current;
  if (!g) return;
  if (g.kind === 'tracking') { if (g.phase === 'playing') g.engine.clearCursor(playClock(g, performance.now())); }
  else g.engine.clearCursor();
}

function render(now) {
  const g = current;
  if (!ctx || !g) return;
  drawPreparedBackground(ctx, g.bg);
  drawScoreBoard(ctx, ARENA.width, boardItems(now));
  if (g.kind === 'tracking') {
    const t = playClock(g, now);
    const b = g.engine.ballAt(t);
    const tracking = g.phase === 'playing' && g.engine.insideNow(t);
    drawBall(ctx, b.x, b.y, g.cfg.radius, tracking);
    // 소리는 하나의 지속음을 켜고 끄기만 함 (페이드는 소리에만 적용, 추적 시간 계산은 엔진의 정확한 판정)
    if (g.phase === 'playing') audio.trackingTone(tracking);
    return;
  }
  const { engine } = g;
  const under = g.effects.filter((fx) => fx.layer === 'under');
  const over = g.effects.filter((fx) => fx.layer !== 'under');
  const alive = new Set(under.filter((fx) => drawEffect(ctx, fx, now)));
  const target = engine.state.current;
  if (target && g.t0 !== null) {
    const t = Math.min(now - g.t0, target.expireAt);
    const pose = engine.targetPose(target, Math.max(t, target.spawnT));
    let flash = null;
    if (g.flash && g.flash.targetIndex === target.index) {
      const k = 1 - (now - g.flash.t0) / 180;
      if (k > 0) flash = { part: g.flash.part, k };
    }
    const half = VISUAL_FX.spawnShimmerMs / 2;
    const age = t - target.spawnT;
    const materialize = age < 2 * half ? 1 - Math.abs(age - half) / half : 0;
    drawSilhouette(ctx, TARGET_SHAPE, pose.x, pose.y, { flash, materialize });
    drawTimerBar(ctx, TARGET_SHAPE, pose.x, pose.y, (target.expireAt - t) / g.cfg.exposureMs);
  }
  for (const fx of over) if (drawEffect(ctx, fx, now)) alive.add(fx);
  g.effects = g.effects.filter((fx) => alive.has(fx));
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 천장 점수판 내용 (HUD와 같은 정보) */
function boardItems(now) {
  const { mode, engine, cfg } = current;
  if (current.kind === 'tracking') {
    const t = playClock(current, now);
    const rate = t > 0 ? (engine.state.insideMs / Math.min(t, cfg.durationMs)) * 100 : null;
    return [{ label: '남은 시간', value: pad2(Math.ceil(engine.remaining(t) / 1000)) }, { label: '추적 성공률', value: rate == null ? '--' : `${Math.round(rate)}%` }];
  }
  const st = engine.state;
  if (mode === 'rank') return [{ label: '점수', value: st.score < 0 ? `-${pad2(-st.score)}` : pad2(st.score) }, { label: '목표', value: pad2(cfg.end.goal) }];
  const remaining = pad2(cfg.end.count - st.processed);
  if (mode === 'analysis') return [{ label: '처리', value: pad2(st.processed) }, { label: '남은 표적', value: remaining }];
  return [{ label: '점수', value: pad2(st.score) }, { label: '남은 표적', value: remaining }];
}

function hudItem(k, v) {
  return `<div class="hud-item"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

function updateHud(now) {
  const g = current;
  if (!g) return;
  const { mode, option, engine, cfg } = g;
  let html = '';
  if (g.kind === 'tracking') {
    const t = playClock(g, now);
    const played = Math.min(t, cfg.durationMs);
    const rate = played > 0 ? (engine.state.insideMs / played) * 100 : null;
    html = hudItem('모드', MODES.tracking.label) + hudItem('난이도', DIFFICULTIES[option])
      + hudItem('남은 시간', `${(engine.remaining(t) / 1000).toFixed(1)}초`)
      + hudItem('현재 추적 성공률', rate == null ? '-' : `${rate.toFixed(1)}%`);
    $('#hud-items').innerHTML = html;
    return;
  }
  const t = now - (g.t0 ?? now);
  const st = engine.state;
  const elapsed = g.t0 === null ? 0 : engine.elapsed(t);
  const shown = st.targets.length;
  if (mode === 'basic' || mode === 'moving') {
    html = hudItem('모드', MODES[mode].label) + hudItem('난이도', DIFFICULTIES[option])
      + hudItem('현재 표적', `${shown}/${cfg.end.count}`) + hudItem('점수', `${st.score}점`) + hudItem('경과 시간', fmtSec(elapsed));
  } else if (mode === 'analysis') {
    html = hudItem('모드', MODES.analysis.label) + hudItem('표적 유형', ANALYSIS_TYPES[option].label)
      + hudItem('현재 표적', `${shown}/${cfg.end.count}`) + hudItem('경과 시간', fmtSec(elapsed));
  } else {
    html = hudItem('모드', MODES.rank.label) + hudItem('현재 점수', `${st.score}점`)
      + hudItem('목표 점수', `${cfg.end.goal}점`) + hudItem('경과 시간', fmtSec(elapsed));
  }
  $('#hud-items').innerHTML = html;
}

// ---------- 트래킹 일시정지 ----------
function pauseTracking() {
  const g = current;
  if (!g || g.kind !== 'tracking') return;
  if (g.phase === 'playing') {
    const now = performance.now();
    g.engine.advance(playClock(g, now));
    g.phase = 'paused';
    g.pausedAt = now;
  } else if (g.phase === 'countdown') {
    g.timers.forEach(clearTimeout); // 카운트다운 중이면 재개 후 처음부터 다시
    g.timers = [];
    $('#countdown').hidden = true;
    g.phase = 'paused-countdown';
  } else {
    return;
  }
  $('#pause-overlay').hidden = false;
  audio.trackingToneStop();
  audio.pause('tracking-pause');
}

function resumeTracking(e) {
  const g = current;
  if (!g || g.kind !== 'tracking') return;
  $('#pause-overlay').hidden = true;
  audio.resume('tracking-pause');
  if (g.phase === 'paused-countdown') {
    g.phase = 'countdown';
    runCountdown(g.id);
    return;
  }
  if (g.phase !== 'paused') return;
  const now = performance.now();
  g.pausedTotal += now - g.pausedAt;
  g.pausedAt = null;
  g.phase = 'playing';
  audio.trackingToneStart();
  const p = e ? arenaPoint(e) : null;
  if (p && p.inside) g.engine.setCursor(playClock(g, now), p.x, p.y);
  else g.engine.clearCursor(playClock(g, now));
}

function quitGame() {
  const g = current;
  if (!g || g.phase === 'done') return;
  const now = performance.now();
  if (g.kind === 'tracking') {
    g.engine.abort(playClock(g, now));
  } else {
    const t = g.t0 === null ? 0 : now - g.t0;
    if (g.t0 !== null) handleEvents(g.engine.advance(t), now);
    if (current !== g || g.phase === 'done') return; // 마지막 순간에 정상 종료된 경우
    g.engine.abort(t);
  }
  g.phase = 'done';
  cancelAnimationFrame(g.raf);
  g.timers.forEach(clearTimeout);
  if (g.rankWatch) g.rankWatch.detach();
  if (g.rank?.sessionId && g.rank.online) api.abortSession(g.rank.sessionId).catch(() => {});
  g.closed = true;
  $('#countdown').hidden = true;
  $('#pause-overlay').hidden = true;
  audio.trackingToneStop();
  audio.resume('tracking-pause');
  showResult(g, { aborted: true });
}

function finishGame() {
  const g = current;
  if (!g || g.phase === 'done') return;
  g.phase = 'done';
  audio.trackingToneStop();
  if (g.mode === 'rank') g.closed = true; // 세션은 제출 요청이 닫음
  cancelAnimationFrame(g.raf);
  render(performance.now());
  updateHud(performance.now());
  if (g.rankWatch) g.rankWatch.detach();
  showResult(g, { aborted: false });
}

// ---------- 랭크: 환경 감시 ----------
function watchRankEnvironment(g) {
  const flags = { focusLost: false, resized: false };
  const base = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
  const banner = $('#rank-banner');
  const mark = (key, text) => {
    if (flags[key]) return;
    flags[key] = true;
    banner.textContent = `${text} — 이번 기록은 랭킹 등록 대상에서 제외됩니다.`;
    banner.hidden = false;
  };
  const onVis = () => { if (document.hidden) mark('focusLost', '탭 이탈 감지'); };
  const onBlur = () => mark('focusLost', '창 이탈 감지');
  const onResize = () => mark('resized', '창 크기 변경 감지');
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
  if (!document.hasFocus()) onBlur();
  g.rankFlags = flags;
  return {
    poll() {
      if (window.innerWidth !== base.w || window.innerHeight !== base.h || window.devicePixelRatio !== base.dpr) onResize();
    },
    detach() {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
    },
  };
}

// ---------- 결과 화면 ----------
function showResult(g, { aborted }) {
  const metrics = !aborted ? recordMetrics(g) : null;
  const prev = metrics ? lastRecord(g.mode, g.option) : null;
  const { html, bind } = renderResult(g, { aborted, prev });
  $('#result-body').innerHTML = html;
  showScreen('result');
  bind();
  if (metrics) saveRecord({ mode: g.mode, option: g.option, backgroundId: g.bg.id, metrics });
  if (g.mode === 'rank' && !aborted) {
    $('#to-leaderboard').onclick = openRankLobby;
    submitRank(g);
  }
  // 같은 조건으로 다시 하기: 모드·난이도·표적 유형·직전 배경 유지
  $('#again-btn').onclick = () => (g.mode === 'rank' ? startRank() : startGame(g.mode, g.option, { backgroundId: g.bg.id }));
}

async function submitRank(g) {
  if (!g.rank || !g.rank.online) { showRankOutcome({ practice: true }); return; }
  const st = g.engine.state;
  const payload = {
    rulesVersion: RANK.rulesVersion,
    backgroundId: g.bg.id,
    shots: st.shots.map((s) => ({ t: s.t, x: s.x, y: s.y })),
    claimed: { timeMs: st.endTime, score: st.score, headKills: st.headKills, timeouts: st.timeouts, outcomes: st.targets.map((t) => t.outcome) },
    flags: g.rankFlags || {},
  };
  try {
    const r = await api.submit(g.rank.sessionId, payload);
    g.closed = true;
    showRankOutcome(r);
  } catch (e) {
    showRankOutcome(null, e.message);
  }
}

// ---------- 랭크 로비 ----------
const lobby = { online: false, player: null };

function renderRankRules() {
  $('#rank-rules').innerHTML = [
    `정지 표적, 노출 시간 <b>${RANK.exposureMs / 1000}초</b>`,
    `머리 명중 <b>+${RANK.headPoints}점</b>, 머리를 못 맞히고 시간 초과 <b>${RANK.timeoutPenalty}점</b> (표적당 한 번)`,
    '몸통·발·허공 발사는 감점 없음. 점수는 0점에서 시작하며 음수도 가능',
    `<b>${RANK.goalScore}점</b>에 도달하면 즉시 종료. 표적 수·전체 시간 제한 없음`,
    '기록 = 첫 표적 등장부터 목표 점수 도달까지의 시간 (카운트다운 제외, 표적 등장 간격 포함). 짧을수록 높은 순위',
    `비교 조건 고정: 게임 영역 ${ARENA.width}×${ARENA.height}, 표적 크기, 노출 시간, 등장 간격 ${SPAWN_GAP_MS / 1000}초, 배경`,
    '표적 위치와 등장 순서는 매 판 무작위로 바뀝니다 (서버가 판마다 발급한 시드로 기록을 검증)',
    `규칙 버전: <code>${RANK.rulesVersion}</code> — 규칙이 바뀌면 기존 기록과 분리됩니다`,
  ].map((t) => `<li>${t}</li>`).join('');
}

function renderPlayerBox(error = '') {
  const box = $('#player-box');
  const p = lobby.player;
  if (!lobby.online) {
    box.innerHTML = '<div class="muted">랭킹 서버에 연결되지 않아 사용자 등록을 할 수 없습니다.</div>';
  } else if (!p) {
    box.innerHTML = `<div><b>닉네임 등록</b> <span class="muted small">— 등록 시 이 브라우저에 사용자 인증 키가 저장됩니다. 같은 닉네임은 다른 사람이 사용할 수 없습니다.</span></div>
      <form class="form-row" id="reg-form"><input id="nick-input" maxlength="12" placeholder="2~12자" autocomplete="off" required>
      <button class="btn primary" type="submit">등록</button></form>${error ? `<div class="err">${esc(error)}</div>` : ''}`;
    $('#reg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.register($('#nick-input').value.trim());
        lobby.player = loadPlayer();
        renderPlayerBox();
        updateRankStart();
        loadLeaderboard();
      } catch (err) { renderPlayerBox(err.message); }
    });
  } else {
    box.innerHTML = `<div>플레이어: <b>${esc(p.nickname)}</b> <button class="btn ghost small" id="rename-btn" type="button">닉네임 변경</button></div>
      <form class="form-row" id="rename-form" hidden><input id="rename-input" maxlength="12" value="${esc(p.nickname)}" autocomplete="off">
      <button class="btn small" type="submit">저장</button></form>${error ? `<div class="err">${esc(error)}</div>` : ''}
      <div class="muted small" style="margin-top:.4rem">사용자 인증 키는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 같은 계정으로 다시 접근할 수 없습니다.</div>`;
    $('#rename-btn').addEventListener('click', () => { $('#rename-form').hidden = false; });
    $('#rename-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.rename($('#rename-input').value.trim());
        lobby.player = loadPlayer();
        renderPlayerBox();
        loadLeaderboard();
      } catch (err) { renderPlayerBox(err.message); }
    });
  }
}

function updateRankStart() {
  const btn = $('#rank-start');
  if (lobby.online) {
    btn.textContent = '랭크 시작';
    btn.disabled = !lobby.player;
  } else {
    btn.textContent = '연습 플레이 (랭킹 미등록)';
    btn.disabled = false;
  }
}

async function loadLeaderboard() {
  const el = $('#leaderboard');
  if (!lobby.online) {
    el.innerHTML = '<div class="empty">랭킹 서버에 연결되지 않았습니다. 전체 사용자 순위를 불러올 수 없습니다.<br>(README의 ‘랭킹 서버 설정’ 참고)</div>';
    $('#lb-meta').textContent = '';
    return;
  }
  el.innerHTML = '<div class="empty">불러오는 중…</div>';
  try {
    const lb = await api.leaderboard();
    $('#lb-meta').textContent = `규칙 버전 ${lb.rulesVersion} · 등록 사용자 ${lb.totalPlayers}명 · 사용자별 최고 기록 기준`;
    if (!lb.entries.length) {
      el.innerHTML = '<div class="empty">아직 등록된 기록이 없습니다. 첫 기록의 주인공이 되어 보세요.</div>';
      return;
    }
    const row = (r) => `<tr class="${r.isMe ? 'me' : ''}"><td class="num">${r.rank}</td><td>${esc(r.nickname)}${r.isMe ? '<span class="tag">나</span>' : ''}</td>
      <td class="num">${fmtSec(r.timeMs)}</td><td class="num">${fmtDate(r.achievedAt)}</td></tr>`;
    let body = lb.entries.map(row).join('');
    if (lb.me && !lb.entries.some((r) => r.isMe)) body += `<tr><td colspan="4" class="muted small" style="text-align:center">⋯</td></tr>${row(lb.me)}`;
    el.innerHTML = `<table><thead><tr><th class="num">순위</th><th>닉네임</th><th class="num">완료 시간</th><th class="num">달성 날짜</th></tr></thead><tbody>${body}</tbody></table>
      ${lb.me ? '' : (lobby.player ? '<p class="muted small">아직 내 랭킹 기록이 없습니다.</p>' : '')}`;
  } catch (e) {
    el.innerHTML = `<div class="empty">순위를 불러오지 못했습니다: ${esc(e.message)}</div>`;
  }
}

async function openRankLobby() {
  cleanupGame();
  showScreen('rank');
  renderRankRules();
  const status = $('#server-status');
  status.className = 'server-status';
  status.textContent = '서버 연결 확인 중…';
  $('#rank-start').disabled = true;
  try {
    const h = await api.health();
    lobby.online = true;
    if (h.rulesVersion !== RANK.rulesVersion) {
      status.className = 'server-status bad';
      status.textContent = `서버의 랭크 규칙(${h.rulesVersion})과 이 화면의 규칙(${RANK.rulesVersion})이 다릅니다. 페이지를 새로고침해 주세요.`;
      lobby.online = false;
    } else {
      status.className = 'server-status ok';
      status.textContent = '● 온라인 랭킹 서버에 연결됨';
    }
  } catch {
    lobby.online = false;
    status.className = 'server-status bad';
    status.textContent = '● 랭킹 서버에 연결되지 않음 — 연습 플레이만 가능하며 기록은 등록되지 않습니다.';
  }
  lobby.player = loadPlayer();
  if (lobby.online && lobby.player) {
    try { await api.me(); lobby.player = loadPlayer(); } catch (e) {
      if (e.status === 401) { api.forget(); lobby.player = null; }
    }
  }
  renderPlayerBox();
  updateRankStart();
  loadLeaderboard();
}

async function startRank() {
  if (!canStartGame()) return;
  if (!lobby.online) { startGame('rank', null, { rank: { online: false } }); return; }
  const btn = $('#rank-start');
  btn.disabled = true;
  try {
    const s = await api.createSession(RANK.rulesVersion);
    if (!Number.isInteger(s.seed)) throw new Error('서버 응답이 올바르지 않습니다. 새로고침해 주세요.');
    startGame('rank', null, { rank: { online: true, sessionId: s.sessionId, seed: s.seed } });
  } catch (e) {
    showScreen('rank');
    $('#server-status').className = 'server-status bad';
    $('#server-status').textContent = `랭크 세션을 시작하지 못했습니다: ${e.message}`;
  } finally {
    updateRankStart();
  }
}

// ---------- 초기화 ----------
function init() {
  const openSettings = initSettings();
  home = initHome({
    onStart: (mode, option) => startGame(mode, option),
    onOpenRank: openRankLobby,
    onSettings: openSettings,
  });
  checkDevice();
  // 브라우저 자동재생 제한: 첫 사용자 입력 때 오디오 활성화 (실패해도 무시)
  const unlock = () => audio.unlock();
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  // 탭 비활성화: 음악 일시정지 + 트래킹 일시정지 (돌아온 뒤 사용자가 재개)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { audio.pause('hidden'); pauseTracking(); } else audio.resume('hidden');
  });
  window.addEventListener('blur', pauseTracking);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dragstart', (e) => e.preventDefault());
  $('#resume-btn').addEventListener('click', resumeTracking);
  $('#quit-btn').addEventListener('click', quitGame);
  $('#rank-start').addEventListener('click', startRank);
  $('#lb-refresh').addEventListener('click', loadLeaderboard);
  $$('[data-nav="home"]').forEach((btn) => btn.addEventListener('click', () => { cleanupGame(); showScreen('home'); home.refresh(); }));
  $('#device-notice-close').addEventListener('click', () => { $('#device-notice').hidden = true; });
  window.addEventListener('resize', () => {
    if (!$('#device-notice').hidden && !isTouchOnly() && !viewTooSmall()) $('#device-notice').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#screen-game').classList.contains('active')) quitGame();
    if (e.key === 'Escape' && !$('#settings-modal').hidden) $('#settings-modal').hidden = true;
  });
  showScreen('home');
}

init();

// 개발·검증용 (브라우저 콘솔/자동화 테스트에서 상태 확인)
window.__aim = {
  get current() { return current; },
  audio,
  STATUS,
  TRACKING,
  pauseTracking,
};
