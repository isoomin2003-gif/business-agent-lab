// 홈 화면 (게임 로비): 왼쪽 큰 모드 메뉴, 선택한 모드의 설명·설정만 보여주는 패널, 가장 눈에 띄는 시작 버튼.
// 안내 수치는 모두 config.js 값에서 가져옵니다.
import {
  DIFFICULTIES, EXPOSURE_MS, MOVE_SPEED, TARGETS_PER_GAME, RANK, ANALYSIS_TYPES, TRACKING, SPAWN_GAP_MS, TARGET_SHAPE, FLOOR,
} from './config.js';
import { $, esc } from './ui.js';
import { prepareBackground, drawPreparedBackground } from './backgrounds.js';
import { drawSilhouette, drawBall } from './render.js';

const s = (ms) => `${ms / 1000}초`;
const PREF_KEY = 'aimTrainer.home.v1';

export const HOME_MODES = [
  {
    id: 'basic', name: '기본', title: '기본 모드',
    desc: '정지한 표적이 하나씩 등장합니다. 머리를 맞히면 즉시 제거됩니다.',
    options: ['easy', 'normal', 'hard'],
    optionLabel: (o) => DIFFICULTIES[o],
    facts: (o) => [`노출 시간 ${s(EXPOSURE_MS.static[o])}`, `표적 ${TARGETS_PER_GAME}개 처리 시 종료`, '머리 명중 +1점'],
  },
  {
    id: 'moving', name: '움직임', title: '움직임 모드',
    desc: '표적이 좌우로 지그재그 이동합니다. 클릭한 순간의 실제 위치로 판정합니다.',
    options: ['easy', 'normal', 'hard'],
    optionLabel: (o) => DIFFICULTIES[o],
    facts: (o) => [`노출 시간 ${s(EXPOSURE_MS.moving[o])}`, `이동 속도 ${MOVE_SPEED}px/초 (모든 난이도 동일)`, `표적 ${TARGETS_PER_GAME}개 처리 시 종료`],
  },
  {
    id: 'analysis', name: '분석', title: '분석 모드',
    desc: '표적 30개를 처리한 뒤 명중 위치 분포와 조준 경향을 분석합니다.',
    options: ['static', 'moving'],
    optionLabel: (o) => ANALYSIS_TYPES[o].label,
    facts: (o) => [`노출 시간 ${s(ANALYSIS_TYPES[o].exposureMs)}`, o === 'moving' ? `이동 속도 ${MOVE_SPEED}px/초 (움직임 보통과 동일)` : '정지 표적 (기본 보통과 동일)', '기록 비교를 위해 고정 배경'],
  },
  {
    id: 'rank', name: '랭크', title: '랭크 모드',
    desc: `머리 명중 +${RANK.headPoints}점, 시간 초과 ${RANK.timeoutPenalty}점. ${RANK.goalScore}점에 도달하는 시간으로 전체 사용자와 순위를 겨룹니다.`,
    options: [],
    facts: () => [`정지 표적 · 노출 ${s(RANK.exposureMs)} · 등장 간격 ${s(SPAWN_GAP_MS)}`, '표적 수·전체 시간 제한 없음, 일시정지 불가', '고정 배경 · 서버 검증 후 등록'],
  },
  {
    id: 'tracking', name: '트래킹', title: '트래킹 모드',
    desc: `움직이는 공을 조준점으로 ${TRACKING.durationMs / 1000}초 동안 따라갑니다. 클릭할 필요 없이 마우스만 움직이세요.`,
    options: ['easy', 'normal', 'hard'],
    optionLabel: (o) => DIFFICULTIES[o],
    facts: (o) => [
      { easy: '느린 좌우 이동', normal: '중간 속도 상하좌우 이동 · 완만한 방향 전환', hard: '빠른 이동 · 잦은 방향 전환' }[o] + ` (${TRACKING.difficulties[o].speed}px/초)`,
      `공 지름 ${TRACKING.ballRadius * 2}px (모든 난이도 동일)`,
      '탭을 벗어나면 일시정지',
    ],
  },
];

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 저장 불가 환경 */ }
}

/**
 * @param {{ onStart(mode, option), onOpenRank(), onSettings() }} handlers
 */
export function initHome(handlers) {
  const prefs = loadPrefs();
  const state = {
    mode: HOME_MODES.some((m) => m.id === prefs.mode) ? prefs.mode : 'basic',
    options: { basic: 'normal', moving: 'normal', analysis: 'static', tracking: 'normal', ...(prefs.options || {}) },
  };

  const menu = $('#home-menu');
  menu.innerHTML = HOME_MODES.map((m) => `<button type="button" class="hm-item" data-mode="${m.id}"><span class="hm-name">${esc(m.name)}</span><span class="hm-sub">${esc(m.title)}</span></button>`).join('');

  function renderPanel() {
    const m = HOME_MODES.find((x) => x.id === state.mode);
    const opt = state.options[m.id];
    menu.querySelectorAll('.hm-item').forEach((b) => {
      const on = b.dataset.mode === m.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const chips = m.options.length
      ? `<div class="hp-label">${m.id === 'analysis' ? '표적 유형' : '난이도'}</div>
         <div class="chips" role="radiogroup">${m.options.map((o) => `<button type="button" role="radio" class="chip${o === opt ? ' on' : ''}" aria-checked="${o === opt}" data-option="${o}">${esc(m.optionLabel(o))}</button>`).join('')}</div>`
      : '';
    $('#home-panel').innerHTML = `
      <div class="hp-title">${esc(m.title)}</div>
      <p class="hp-desc">${esc(m.desc)}</p>
      ${chips}
      <ul class="hp-facts">${m.facts(opt).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <button type="button" class="start-btn" id="home-start">${m.id === 'rank' ? '규칙과 순위표 보기' : '시작'}</button>`;
    $('#home-panel').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
      state.options[m.id] = c.dataset.option;
      savePrefs(state);
      renderPanel();
    }));
    $('#home-start').addEventListener('click', () => {
      if (m.id === 'rank') handlers.onOpenRank();
      else handlers.onStart(m.id, state.options[m.id]);
    });
  }

  menu.addEventListener('click', (e) => {
    const b = e.target.closest('.hm-item');
    if (!b) return;
    state.mode = b.dataset.mode;
    savePrefs(state);
    renderPanel();
  });
  $('#open-settings').addEventListener('click', handlers.onSettings);
  renderPanel();
  paintHomeBackground();
  window.addEventListener('resize', () => { if ($('#screen-home').classList.contains('active')) paintHomeBackground(); });
  return { refresh: () => { renderPanel(); paintHomeBackground(); } };
}

/** 홈 배경: 우리 사격장 장면(표적·공 포함)을 화면 전체에 비율 유지로 깔아 공간감을 만듦 */
export async function paintHomeBackground() {
  const canvas = $('#home-bg');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = await prepareBackground('range');
  const scale = Math.max(w / 1040, h / 600);
  const ox = (w - 1040 * scale) / 2;
  const oy = (h - 600 * scale) * 0.6;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  drawPreparedBackground(ctx, bg);
  // 사격장 안쪽에 선 표적들과 공 (원근감: 뒤쪽은 작고 흐리게)
  drawSilhouette(ctx, TARGET_SHAPE, 760, FLOOR.horizonY + 6, { scale: 0.8, alpha: 0.8 });
  drawSilhouette(ctx, TARGET_SHAPE, 930, FLOOR.horizonY + 70, { scale: 1.45 });
  drawSilhouette(ctx, TARGET_SHAPE, 690, FLOOR.horizonY + 40, { scale: 1.05, alpha: 0.9 });
  drawBall(ctx, 860, 230, TRACKING.ballRadius, false);
  ctx.restore();
}
