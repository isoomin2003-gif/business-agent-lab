// 트래킹 모드 엔진. 움직이는 공 하나를 조준점으로 따라가는 동안 '조준점 중심이 공 안에 있는 시간'을 누적합니다.
// DOM에 의존하지 않는 순수 모듈입니다.
//
// 시간 기준: 엔진 시각 t(ms)는 '카운트다운이 끝나 공이 움직이기 시작한 순간 = 0'이며, 일시정지 시간은 포함하지 않습니다.
// 추적 시간은 화면 프레임 수와 무관하게 1ms 단위로 적분합니다. 커서 위치는 마우스 이동 이벤트 시각에 바뀌는
// 계단 함수로 보고, 공 위치는 미리 계산한 1ms 경로를 씁니다. 따라서 주사율이 달라도 같은 입력이면 같은 결과가 나옵니다.
// 마우스 버튼(클릭·누르고 있기)은 판정에 전혀 쓰이지 않습니다.

import { createRng } from './rng.js';
import { buildStrafeTrack } from './motion.js';

const DEG = Math.PI / 180;

/** 공의 30초 이동 경로를 1ms 단위로 미리 계산 (같은 시드 → 같은 경로) */
export function buildTrackingPath(rng, diff, area, durationMs) {
  const n = Math.ceil(durationMs) + 2;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const cx = (area.x0 + area.x1) / 2;
  const cy = (area.y0 + area.y1) / 2;

  if (diff.pattern === 'horizontal') {
    // 쉬움: 같은 높이에서 느리게 좌우 이동 (가끔 방향 전환, 전환은 부드럽게)
    const x0 = cx + (rng() - 0.5) * (area.x1 - area.x0) * 0.4;
    const track = buildStrafeTrack(rng, x0, rng() < 0.5 ? -1 : 1, {
      speed: diff.speed, minX: area.x0, maxX: area.x1, durationMs,
      segMinMs: diff.segMinMs, segMaxMs: diff.segMaxMs, flipChance: diff.flipChance, turnMs: diff.turnMs,
    });
    xs.set(track.xs.subarray(0, n));
    ys.fill(cy);
    return { xs, ys };
  }

  // 보통·어려움: 일정 속도로 상하좌우 이동하며 진행 방향을 부드럽게 회전
  const v = diff.speed / 1000; // px/ms
  const maxTurn = (diff.maxTurnDegPerSec * DEG) / 1000; // rad/ms
  const angAcc = (diff.turnAccelDegPerSec2 * DEG) / 1e6; // rad/ms²
  let x = cx + (rng() - 0.5) * 200;
  let y = cy + (rng() - 0.5) * 100;
  let heading = rng() * Math.PI * 2;
  let omega = 0;
  let targetOmega = 0;
  let changeAt = 0;
  const margin = diff.wallMargin;
  for (let i = 0; i < n; i++) {
    xs[i] = x;
    ys[i] = y;
    if (i >= changeAt) {
      targetOmega = (rng() * 2 - 1) * maxTurn;
      changeAt = i + diff.changeMinMs + rng() * (diff.changeMaxMs - diff.changeMinMs);
    }
    // 가장자리에 가까우면 가운데 쪽으로 부드럽게 방향을 틀어 화면 밖·UI 쪽으로 나가지 않게 함
    let want = targetOmega;
    const near = x < area.x0 + margin || x > area.x1 - margin || y < area.y0 + margin || y > area.y1 - margin;
    if (near) {
      let d = Math.atan2(cy - y, cx - x) - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > Math.PI / 2.5) want = Math.sign(d) * maxTurn * 1.6;
    }
    omega += Math.max(-angAcc, Math.min(angAcc, want - omega));
    heading += omega;
    x += Math.cos(heading) * v;
    y += Math.sin(heading) * v;
    // 안전장치: 경계에 닿으면 그 축의 진행 방향만 반사 (위치는 연속)
    if (x < area.x0) { x = area.x0; heading = Math.PI - heading; }
    if (x > area.x1) { x = area.x1; heading = Math.PI - heading; }
    if (y < area.y0) { y = area.y0; heading = -heading; }
    if (y > area.y1) { y = area.y1; heading = -heading; }
  }
  return { xs, ys };
}

export function createTrackingEngine(cfg) {
  const path = buildTrackingPath(createRng(cfg.seed), cfg.diff, cfg.area, cfg.durationMs);
  const D = cfg.durationMs;
  const segCount = Math.ceil(D / cfg.segmentMs);
  const r2 = cfg.radius * cfg.radius;

  const state = {
    status: 'ready', // ready | running | finished | aborted
    t: 0, // 적분이 끝난 시각 (= 실제 플레이 시간)
    cursor: null, // 조준점 위치 (게임 영역 밖이면 null)
    inside: false,
    insideMs: 0,
    segInside: new Array(segCount).fill(0),
    streakMs: 0,
    bestStreakMs: 0,
    endTime: null,
  };

  function ballAt(t) {
    const e = Math.min(Math.max(t, 0), path.xs.length - 2);
    const i = Math.floor(e);
    const f = e - i;
    return { x: path.xs[i] + (path.xs[i + 1] - path.xs[i]) * f, y: path.ys[i] + (path.ys[i + 1] - path.ys[i]) * f };
  }

  function isInside(t) {
    if (!state.cursor) return false;
    const b = ballAt(t);
    const dx = state.cursor.x - b.x;
    const dy = state.cursor.y - b.y;
    return dx * dx + dy * dy <= r2;
  }

  /** 시각 t까지 1ms 단위로 추적 시간을 적분 */
  function advance(t) {
    if (state.status !== 'running') return;
    const end = Math.min(t, D);
    while (state.t < end) {
      const next = Math.min(end, Math.floor(state.t) + 1);
      const dt = next - state.t;
      const inside = isInside(state.t);
      state.inside = inside;
      if (inside) {
        state.insideMs += dt;
        state.segInside[Math.min(segCount - 1, Math.floor(state.t / cfg.segmentMs))] += dt;
        state.streakMs += dt;
        if (state.streakMs > state.bestStreakMs) state.bestStreakMs = state.streakMs;
      } else {
        state.streakMs = 0;
      }
      state.t = next;
    }
    if (state.t >= D) {
      state.status = 'finished';
      state.endTime = D;
    }
  }

  return {
    cfg,
    state,
    ballAt,
    start() { if (state.status === 'ready') state.status = 'running'; },
    advance,
    /** 마우스 이동: t까지 이전 위치로 적분한 뒤 새 위치로 바꿈 */
    setCursor(t, x, y) {
      advance(t);
      state.cursor = { x, y };
    },
    clearCursor(t) {
      advance(t);
      state.cursor = null;
    },
    /** 지금 조준점이 공 안에 있는지 (화면 표시용) */
    insideNow(t) { return isInside(Math.min(t, D)); },
    abort(t) {
      if (state.status !== 'running' && state.status !== 'ready') return;
      advance(t);
      state.status = 'aborted';
      state.endTime = state.t;
    },
    remaining(t) { return Math.max(0, D - Math.min(t, D)); },
    summary() {
      const played = state.t;
      const segments = state.segInside.map((inside, i) => {
        const segStart = i * cfg.segmentMs;
        const segLen = Math.min(cfg.segmentMs, D - segStart);
        const p = Math.max(0, Math.min(segLen, played - segStart));
        return {
          index: i,
          fromSec: segStart / 1000,
          toSec: (segStart + segLen) / 1000,
          playedMs: p,
          status: p <= 0 ? 'unplayed' : p < segLen ? 'partial' : 'full',
          rate: p > 0 ? (inside / p) * 100 : null, // 미진행 구간은 null ('미진행'으로 표시)
        };
      });
      return {
        status: state.status,
        playedMs: played,
        insideMs: state.insideMs,
        rate: played > 0 ? (state.insideMs / played) * 100 : null,
        bestStreakMs: state.bestStreakMs,
        segments,
      };
    },
  };
}
