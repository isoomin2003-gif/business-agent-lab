// 결과 화면. 모드별로 대표 기록을 다르게 강조합니다.
// 가짜 기록·임의 등급은 만들지 않고, 이전 기록 비교와 순위는 실제 데이터가 있을 때만 표시합니다.
import { MODES, DIFFICULTIES, ANALYSIS_TYPES, TARGET_SHAPE, TRACKING, MOVE_SPEED } from './config.js';
import { ratio } from './core/engine.js';
import { analyzeGame, PART_LABEL } from './analysis.js';
import { COLORS, drawDistribution } from './render.js';
import { percentColumns, stackedShare } from './charts.js';
import { backgroundLabel } from './backgrounds.js';
import { $, $$, esc, fmtSec, fmtPct, fmtDate } from './ui.js';

const SERIES_A = '#3987e5'; // 검증된 2계열 조합
const SERIES_B = '#d95926';

function card(k, v, s = '') {
  return `<div class="rcard"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
}

function conditionLabel(g) {
  if (g.mode === 'analysis') return ANALYSIS_TYPES[g.option].label;
  if (g.mode === 'rank') return `목표 ${g.cfg.end.goal}점`;
  return DIFFICULTIES[g.option];
}

/** 이번 판의 비교용 핵심 수치 (정상 완료만 저장) */
export function recordMetrics(g) {
  if (g.mode === 'tracking') {
    const s = g.engine.summary();
    return { label: '추적 성공률', value: s.rate, unit: '%' };
  }
  const st = g.engine.state;
  if (g.mode === 'analysis') return { label: '표적 제거 성공률', value: ratio(st.headKills, g.cfg.end.count), unit: '%' };
  if (g.mode === 'rank') return null; // 랭크는 서버 기록으로 비교
  return { label: '성공한 표적', value: st.headKills, unit: `/${g.cfg.end.count}` };
}

function compareCard(g, prev) {
  if (!prev || !prev.metrics || prev.metrics.value == null) {
    return card('이전 기록 비교', '<span class="muted">없음</span>', '같은 모드·조건으로 정상 완료한 이전 기록이 있을 때만 표시합니다.');
  }
  const now = recordMetrics(g);
  if (!now || now.value == null) return '';
  const fmt = (v) => (now.unit === '%' ? `${v.toFixed(1)}%` : `${v}${now.unit}`);
  const d = now.value - prev.metrics.value;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const dTxt = now.unit === '%' ? `${sign}${Math.abs(d).toFixed(1)}%p` : `${sign}${Math.abs(d)}`;
  const bgNote = prev.backgroundId !== g.bg.id
    ? `<br>직전 기록은 ‘${esc(backgroundLabel(prev.backgroundId))}’ 배경이라 시인성 조건이 달라 그대로 비교하기 어렵습니다.`
    : '';
  return card('직전 같은 조건 기록', `${dTxt}`, `${now.label}: 직전 ${fmt(prev.metrics.value)} (${fmtDate(prev.at)}) → 이번 ${fmt(now.value)}${bgNote}`);
}

function shell(g, { aborted, statusText, tabs = null, main, side, extraCond = [] }) {
  const cond = [
    ['조건', esc(conditionLabel(g))],
    ['배경', `${esc(g.bg.label)}${g.bg.fallback ? ' <span class="muted">(선택한 배경을 불러오지 못해 기본 배경 사용)</span>' : ''}`],
    ...extraCond,
  ];
  return `<div class="res">
    <aside class="res-nav">
      <div class="res-mode">${esc(MODES[g.mode].label)}</div>
      <span class="badge ${aborted ? 'aborted' : 'done'}">${esc(statusText)}</span>
      ${tabs ? `<nav class="res-tabs" role="tablist">${tabs.map((t, i) => `<button type="button" role="tab" data-tab="${t.id}" class="${i === 0 ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</nav>` : ''}
      <dl class="res-cond">${cond.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    </aside>
    <main class="res-main">${main}</main>
    <aside class="res-side">${side}</aside>
  </div>`;
}

// ---------- 기본·움직임 ----------
function targetStrip(g) {
  const { targets } = g.engine.state;
  const n = g.cfg.end.count;
  let cells = '';
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    const cls = !t || !t.outcome ? 'unplayed' : t.outcome === 'head' ? 'hit' : 'miss';
    const label = !t || !t.outcome ? '미진행' : t.outcome === 'head' ? '머리 명중 제거' : '시간 초과';
    cells += `<i class="cell ${cls}" title="표적 ${i + 1}: ${label}"></i>`;
  }
  return `<div class="strip" aria-label="표적별 결과">${cells}</div>
    <div class="legend"><span><i class="lg hit"></i>머리 명중 제거</span><span><i class="lg miss"></i>시간 초과</span><span><i class="lg unplayed"></i>미진행</span></div>`;
}

function renderBasic(g, { aborted, prev }) {
  const sum = g.engine.summary();
  const n = g.cfg.end.count;
  const unplayed = n - sum.processed;
  const hero = aborted
    ? `<div class="hero"><div class="hk">성공한 표적 / 처리한 표적</div><div class="hv">${sum.headKills}<small> / ${sum.processed}</small></div>
        <div class="hs">전체 ${n}개 중 ${unplayed}개는 미진행 — 실패로 계산하지 않았습니다.</div></div>`
    : `<div class="hero"><div class="hk">성공한 표적 / 전체 표적</div><div class="hv">${sum.headKills}<small> / ${n}</small></div>
        <div class="hs">머리를 맞혀 제거한 표적 수</div></div>`;
  const side = [
    card('진행 시간', fmtSec(sum.timeMs), '첫 표적 등장부터 종료까지'),
    card('시간 초과로 놓친 표적', `${sum.timeouts}개`),
    card('발사 기준 헤드 적중률', fmtPct(ratio(sum.headShots, sum.shots)), sum.shots ? `머리 ${sum.headShots}회 ÷ 발사 ${sum.shots}회` : '발사 기록 없음'),
    aborted ? '' : compareCard(g, prev),
  ].join('');
  const extra = g.mode === 'moving' ? [['이동 속도', `${MOVE_SPEED}px/초`]] : [];
  return shell(g, {
    aborted, statusText: aborted ? '중도 종료' : '정상 완료',
    main: `${hero}<section class="res-sec"><h2>표적별 결과</h2>${targetStrip(g)}</section>`,
    side, extraCond: extra,
  });
}

// ---------- 분석 ----------
function renderAnalysis(g, { aborted, prev }) {
  if (aborted) {
    const st = g.engine.state;
    const n = g.cfg.end.count;
    return shell(g, {
      aborted: true, statusText: '중도 종료',
      main: `<div class="hero"><div class="hk">분석 결과</div><div class="hv small">만들지 않음</div>
        <div class="hs">표적 ${n}개를 모두 처리하지 않아 완성된 분석 결과로 표시하지 않습니다.</div></div>`,
      side: card('처리한 표적', `${st.processed} / ${n}`, `${n - st.processed}개 미진행`) + card('진행 시간', fmtSec(st.endTime)),
    });
  }
  const a = analyzeGame(g.engine);
  g.analysis = a;
  const m = a.metrics;
  const pc = m.partCounts;
  const summary = `<div class="hero-row">
      <div class="hero"><div class="hk">표적 제거 성공률</div><div class="hv">${fmtPct(m.removalRate)}</div><div class="hs">머리로 제거 ${m.kills}개 ÷ ${m.totalTargets}개</div></div>
      <div class="hero"><div class="hk">첫발 헤드 성공률</div><div class="hv">${fmtPct(m.firstShotHeadRate)}</div><div class="hs">첫 발사가 머리 ${m.firstShotHeadCount}개 ÷ ${m.totalTargets}개</div></div>
      <div class="hero"><div class="hk">발사 기준 헤드 적중률</div><div class="hv">${fmtPct(m.headHitRate)}</div><div class="hs">${m.shots ? `머리 ${pc.head}회 ÷ 발사 ${m.shots}회` : '발사 기록 없음'}</div></div>
    </div>
    <section class="res-sec"><h2>이번 플레이 관찰 결과</h2>
      <ul class="feedback">${a.feedback.map((f) => `<li class="${f.kind}">${esc(f.text)}</li>`).join('')}</ul>
      <p class="muted small">${a.notes.map(esc).join('<br>')}</p>
    </section>`;

  const partRows = ['head', 'body', 'feet', 'miss'].map((p) => `<tr><td><i class="sw" style="background:${COLORS[p]}"></i>${PART_LABEL[p]}</td><td class="num">${pc[p]}회</td><td class="num">${fmtPct(m.partRates[p])}</td></tr>`).join('');
  const hits = `<div class="hits">
      <div class="plot-box">
        <h2>클릭 위치 분포</h2>
        <p class="muted small">클릭 당시 머리 중심 기준${a.moving ? ' (움직이는 표적도 클릭 순간의 실제 위치)' : ''}. 흰 테두리 = 각 표적의 첫 클릭, 마름모 = 표적 밖, 속 빈 네모 = 그림 범위 밖.</p>
        <div class="ctl-row">
          <span class="seg" data-ctl="which"><button type="button" class="on" data-v="all">전체 발사</button><button type="button" data-v="first">첫 클릭만</button></span>
          <span class="seg" data-ctl="segment"><button type="button" class="on" data-v="-1">전체</button><button type="button" data-v="0">초반</button><button type="button" data-v="1">중반</button><button type="button" data-v="2">후반</button></span>
          ${a.moving ? '<span class="seg" data-ctl="align"><button type="button" class="on" data-v="dir">이동 방향 기준</button><button type="button" data-v="screen">화면 기준</button></span>' : ''}
        </div>
        <canvas id="dist-plot"></canvas>
        <div class="legend">${['head', 'body', 'feet', 'miss'].map((p) => `<span><i style="background:${COLORS[p]}"></i>${PART_LABEL[p]}</span>`).join('')}</div>
        <p class="muted small" id="dist-count"></p>
      </div>
      <div>
        <h2>부위별 비율</h2>
        ${stackedShare(['head', 'body', 'feet', 'miss'].map((p) => ({ name: PART_LABEL[p], value: pc[p], color: COLORS[p] })))}
        <h3>상세</h3>
        <div class="table-wrap"><table><thead><tr><th>부위</th><th class="num">횟수</th><th class="num">전체 발사 대비</th></tr></thead>
          <tbody>${partRows}<tr><td><b>합계</b></td><td class="num"><b>${m.shots}회</b></td><td></td></tr></tbody></table></div>
      </div>
    </div>`;

  const segChart = percentColumns({
    groups: a.segments.map((s) => ({ label: `${s.label} (${s.range})`, values: [ratio(s.kills, s.targets), ratio(s.firstShotHeads, s.targets)] })),
    series: [{ name: '표적 제거 성공률', color: SERIES_A }, { name: '첫발 헤드 성공률', color: SERIES_B }],
  });
  const segRows = a.segments.map((s) => `<tr><td>${s.label} (${s.range})</td><td class="num">${s.kills}</td><td class="num">${s.timeouts}</td><td class="num">${s.firstShotHeads}</td>
      <td class="num">${s.shots}</td><td class="num">${fmtPct(s.headHitRate)}</td><td class="num">${fmtSec(s.avgKillMs)}</td>
      <td class="num">${s.firstShotCount ? `${Math.round(s.firstMeanDy) > 0 ? '+' : ''}${Math.round(s.firstMeanDy)}px (${s.firstShotCount}개)` : '측정 불가'}</td></tr>`).join('');
  const segments = `<section class="res-sec"><h2>초반 · 중반 · 후반 비교</h2>${segChart}</section>
    <section class="res-sec"><h3>상세 기록</h3>
      <div class="table-wrap"><table><thead><tr><th>구간</th><th class="num">제거</th><th class="num">놓침</th><th class="num">첫발 헤드</th><th class="num">발사</th><th class="num">헤드 적중률</th><th class="num">평균 제거 시간</th><th class="num">첫 클릭 평균 세로 위치</th></tr></thead><tbody>${segRows}</tbody></table></div>
      <p class="muted small">세로 위치: 머리 중심 기준, +는 아래쪽. 첫 클릭 평균은 발사가 있었던 표적만 사용하며 괄호 안은 사용한 개수입니다. 평균 제거 시간은 성공한 표적만 포함합니다.</p>
    </section>`;

  const side = [
    card('시간 초과로 놓친 표적', `${m.timeouts}개`),
    card('성공한 표적의 평균 제거 시간', fmtSec(m.avgKillMs), m.kills ? `성공한 표적 ${m.kills}개만 포함` : '성공한 표적 없음'),
    card('전체 진행 시간', fmtSec(m.timeMs), `발사 ${m.shots}회 · 표적 ${m.totalTargets}개`),
    compareCard(g, prev),
  ].join('');
  return shell(g, {
    aborted: false, statusText: '정상 완료',
    tabs: [{ id: 'summary', label: '결과 요약' }, { id: 'hits', label: '명중 분석' }, { id: 'segments', label: '구간별 기록' }],
    main: `<div class="tab-panel" data-panel="summary">${summary}</div><div class="tab-panel" data-panel="hits" hidden>${hits}</div><div class="tab-panel" data-panel="segments" hidden>${segments}</div>`,
    side,
  });
}

// ---------- 랭크 ----------
function renderRank(g, { aborted }) {
  const sum = g.engine.summary();
  if (aborted) {
    return shell(g, {
      aborted: true, statusText: '중도 종료',
      main: `<div class="hero"><div class="hk">${g.cfg.end.goal}점 달성 시간</div><div class="hv small">기록 없음</div>
        <div class="hs">중도 종료한 기록은 순위에 등록되지 않습니다. (중도 종료 시점 점수 ${sum.score}점)</div></div>`,
      side: card('경과 시간', fmtSec(sum.timeMs)) + card('성공한 표적', `${sum.headKills}개`) + card('놓친 표적', `${sum.timeouts}개`),
    });
  }
  const main = `<div class="hero-row">
      <div class="hero"><div class="hk">${g.cfg.end.goal}점 달성 시간</div><div class="hv">${fmtSec(sum.timeMs)}</div><div class="hs">첫 표적 등장부터 목표 점수 도달까지 (카운트다운 제외, 등장 간격 포함)</div></div>
      <div class="hero" id="rank-hero"><div class="hk">서버에서 확인한 순위</div><div class="hv small">확인 중…</div><div class="hs" id="rank-hero-sub">서버가 기록을 다시 계산해 검증하고 있습니다.</div></div>
    </div>
    <div class="notice" id="rank-submit">랭킹 등록 결과를 확인하는 중…</div>
    <div class="btn-row"><button type="button" class="btn" id="to-leaderboard">순위표 보기</button></div>`;
  const side = [
    card('성공한 표적 수', `${sum.headKills}개`),
    card('놓친 표적 수', `${sum.timeouts}개`, '시간 초과 1개당 −1점'),
    card('등장한 표적 수', `${sum.spawned}개`),
    card('발사 기준 헤드 적중률', fmtPct(ratio(sum.headShots, sum.shots)), `발사 ${sum.shots}회`),
  ].join('');
  return shell(g, { aborted: false, statusText: '정상 완료', main, side });
}

// ---------- 트래킹 ----------
function renderTracking(g, { aborted, prev }) {
  const s = g.engine.summary();
  const segChart = percentColumns({
    groups: s.segments.map((seg) => ({
      label: `${['초반', '중반', '후반'][seg.index] ?? `구간 ${seg.index + 1}`} (${seg.fromSec}~${seg.toSec}초)`,
      sub: seg.status === 'partial' ? `진행 ${(seg.playedMs / 1000).toFixed(1)}초` : seg.status === 'unplayed' ? '' : '',
      values: [seg.rate],
    })),
    series: [{ name: '추적 성공률', color: SERIES_A }],
  });
  const main = `<div class="hero-row">
      <div class="hero"><div class="hk">추적 성공률</div><div class="hv">${fmtPct(s.rate)}</div><div class="hs">공 안에 조준점을 유지한 시간 ${fmtSec(s.insideMs)} ÷ 실제 플레이 시간 ${fmtSec(s.playedMs)}</div></div>
      <div class="hero"><div class="hk">최장 연속 추적 시간</div><div class="hv">${fmtSec(s.bestStreakMs)}</div><div class="hs">조준점이 공 밖으로 나가지 않고 이어진 가장 긴 시간</div></div>
    </div>
    <section class="res-sec"><h2>구간별 추적 성공률</h2>${segChart}
      <p class="muted small">각 구간의 성공률 = 그 구간에서 공 안에 있던 시간 ÷ 그 구간의 실제 진행 시간. 진행하지 않은 구간은 0%가 아니라 ‘미진행’입니다.</p>
    </section>`;
  const d = TRACKING.difficulties[g.option];
  const side = [
    card('실제 플레이 시간', fmtSec(s.playedMs), aborted ? '훈련을 중단한 시점까지 (일시정지 시간 제외)' : `정상 완료 ${TRACKING.durationMs / 1000}초 (일시정지 시간 제외)`),
    card('추적 시간 합계', fmtSec(s.insideMs)),
    aborted ? '' : compareCard(g, prev),
  ].join('');
  return shell(g, {
    aborted, statusText: aborted ? '훈련 중단' : '정상 완료', main, side,
    extraCond: [['공', `지름 ${TRACKING.ballRadius * 2}px · ${d.speed}px/초`], ...(aborted ? [['진행 시간', `${(s.playedMs / 1000).toFixed(1)}초 / ${TRACKING.durationMs / 1000}초`]] : [])],
  });
}

/** 결과 화면 HTML과, 화면에 붙인 뒤 실행할 바인딩 함수 */
export function renderResult(g, { aborted, prev }) {
  const html = g.mode === 'tracking' ? renderTracking(g, { aborted, prev })
    : g.mode === 'analysis' ? renderAnalysis(g, { aborted, prev })
      : g.mode === 'rank' ? renderRank(g, { aborted })
        : renderBasic(g, { aborted, prev });
  const bind = () => {
    const tabs = $$('.res-tabs button');
    tabs.forEach((b) => b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('on', x === b));
      $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
      if (b.dataset.tab === 'hits') drawPlot();
    }));
    let drawPlot = () => {};
    if (g.analysis) {
      const a = g.analysis;
      const opt = { which: 'all', segment: -1, align: 'dir' };
      drawPlot = () => {
        const pts = a.points.filter((p) => (opt.which === 'all' || p.first) && (opt.segment < 0 || p.segment === opt.segment));
        drawDistribution($('#dist-plot'), TARGET_SHAPE, pts, { mirrorDir: a.moving && opt.align === 'dir' });
        $('#dist-count').textContent = `표시된 클릭 ${pts.length}개`;
      };
      $$('.plot-box .seg').forEach((seg) => {
        seg.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          const key = seg.dataset.ctl;
          opt[key] = key === 'segment' ? Number(b.dataset.v) : b.dataset.v;
          drawPlot();
        });
      });
    }
  };
  return { html, bind };
}

/** 랭크 결과: 서버 응답을 받은 뒤 순위 표시 갱신 */
export function showRankOutcome(r, error) {
  const hero = $('#rank-hero');
  const box = $('#rank-submit');
  if (!hero || !box) return;
  const set = (v, sub, msg, ok) => {
    hero.querySelector('.hv').innerHTML = v;
    $('#rank-hero-sub').innerHTML = sub;
    box.innerHTML = msg;
    box.classList.toggle('ok', ok);
  };
  if (error) { set('미확인', '서버에 연결하지 못했습니다.', `<b>랭킹 등록 실패</b> — ${esc(error)}`, false); return; }
  if (r.practice) { set('미등록', '연습 플레이', '연습 플레이였습니다. 랭킹 서버에 연결되지 않은 상태로 시작해 기록이 등록되지 않았습니다.', false); return; }
  if (!r.ranked) { set('미등록', '서버 검증 결과 등록되지 않았습니다.', `<b>랭킹 미등록</b> — ${esc(r.reason)}`, false); return; }
  const pb = r.personalBest
    ? (r.previousBestMs == null ? '첫 랭킹 기록입니다.' : `개인 최고 기록 갱신 (이전 ${fmtSec(r.previousBestMs)})`)
    : `개인 최고 기록 ${fmtSec(r.previousBestMs)}보다 느려 순위는 최고 기록 기준으로 유지됩니다.`;
  set(r.rank ? `${r.rank}위` : '-', `서버 검증 기록 ${fmtSec(r.timeMs)} · 사용자별 최고 기록 기준`, `<b>랭킹 등록 완료</b> — ${esc(pb)}`, true);
}
