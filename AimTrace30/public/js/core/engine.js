// 게임 판정 엔진. DOM에 의존하지 않는 순수 상태 기계이며 브라우저와 서버(랭크 기록 재현 검증)가 공유합니다.
//
// 시간 기준: 엔진 시각 t(ms)는 '첫 표적 등장 순간 = 0'입니다. 카운트다운은 엔진 밖에서 처리되어 기록에 포함되지 않습니다.
// 모든 상태 변화(등장·시간 초과)는 예정된 정확한 시각에 처리되므로, advance()를 몇 번 호출하든 결과가 같습니다.

import { createRng } from './rng.js';
import { classifyHit, headRange } from './geometry.js';
import { buildStrafeTrack, trackPose } from './motion.js';

export const STATUS = Object.freeze({ READY: 'ready', RUNNING: 'running', FINISHED: 'finished', ABORTED: 'aborted' });

export function createEngine(cfg, { cursorSampleMs = 8 } = {}) {
  const rng = createRng(cfg.seed);
  const range = headRange(cfg.arena, cfg.shape, cfg.floor);

  const state = {
    status: STATUS.READY,
    score: 0, // 점수 (성과 기록. 랭크 모드에서만 종료 조건)
    processed: 0, // 처리된 표적 수 (머리 명중 제거 + 시간 초과). 점수와 별개
    headKills: 0,
    timeouts: 0,
    current: null, // 현재 노출 중인 표적 (항상 0개 또는 1개)
    nextSpawnAt: null,
    endTime: null,
    lastT: 0,
    targets: [], // 등장한 모든 표적 기록
    shots: [], // 유효 발사 기록 (표적이 있는 동안의 클릭만)
    lastCursor: null,
  };

  function nextPosition() {
    const prev = state.targets[state.targets.length - 1];
    let x;
    let y;
    for (let attempt = 0; attempt < 40; attempt++) {
      x = range.minX + rng() * (range.maxX - range.minX);
      y = range.minY + rng() * (range.maxY - range.minY);
      if (!prev) break;
      const dx = x - prev.x0;
      const dy = y - prev.y0;
      if (dx * dx + dy * dy >= cfg.minSpawnDistance * cfg.minSpawnDistance) break;
    }
    const dir = rng() < 0.5 ? -1 : 1;
    return { x: Math.round(x), y: Math.round(y), dir };
  }

  /** 표적의 시각 t 위치(머리 중심)와 이동 방향 */
  function targetPose(target, t) {
    if (!cfg.moving) return { x: target.x0, y: target.y0, dir: 0 };
    const m = trackPose(target.track, t - target.spawnT, target.dir);
    return { x: m.x, y: target.y0, dir: m.dir };
  }

  function spawn(t, events) {
    const p = nextPosition();
    const target = {
      index: state.targets.length + 1,
      spawnT: t,
      expireAt: t + cfg.exposureMs, // 클릭으로 초기화되지 않는 고정 만료 시각
      x0: p.x,
      y0: p.y,
      dir: cfg.moving ? p.dir : 0,
      outcome: null, // 'head' | 'timeout'
      resolvedT: null,
      shots: [],
      cursorAtSpawn: state.lastCursor ? { ...state.lastCursor } : null,
      path: [],
    };
    if (cfg.moving) {
      // 노출 시간 전체의 지그재그 경로를 등장 순간에 미리 계산 (기록 객체를 가볍게 두기 위해 열거되지 않는 속성)
      Object.defineProperty(target, 'track', {
        value: buildStrafeTrack(rng, p.x, p.dir, {
          ...cfg.movePattern, speed: cfg.speed, minX: range.minX, maxX: range.maxX, durationMs: cfg.exposureMs,
        }),
      });
    }
    if (state.lastCursor) target.path.push({ t, x: state.lastCursor.x, y: state.lastCursor.y });
    state.targets.push(target);
    state.current = target;
    state.nextSpawnAt = null;
    events.push({ type: 'spawn', target });
  }

  function isFinishedNow() {
    if (cfg.end.type === 'targets') return state.processed >= cfg.end.count;
    return state.score >= cfg.end.goal;
  }

  function resolve(target, t, outcome, events) {
    if (state.current !== target || target.outcome) return; // 중복 처리 방지
    target.outcome = outcome;
    target.resolvedT = t;
    state.current = null;
    state.processed += 1;
    if (outcome === 'head') {
      state.headKills += 1;
      state.score += cfg.scoring.head;
    } else {
      state.timeouts += 1;
      state.score += cfg.scoring.timeout; // 표적당 한 번만 적용됨 (resolve가 한 번만 실행)
    }
    events.push({ type: outcome, target });
    if (isFinishedNow()) {
      state.status = STATUS.FINISHED;
      state.endTime = t;
      state.nextSpawnAt = null;
      events.push({ type: 'finish', t });
    } else {
      state.nextSpawnAt = t + cfg.spawnGapMs;
    }
  }

  /** 시각 t까지 예정된 시간 초과·등장을 순서대로 처리 */
  function advance(t, events = []) {
    if (state.status !== STATUS.RUNNING) return events;
    if (t < state.lastT) t = state.lastT;
    state.lastT = t;
    for (let guard = 0; guard < 100000; guard++) {
      if (state.status !== STATUS.RUNNING) break;
      if (state.current) {
        if (t >= state.current.expireAt) {
          resolve(state.current, state.current.expireAt, 'timeout', events);
          continue;
        }
        break;
      }
      if (state.nextSpawnAt !== null && t >= state.nextSpawnAt) {
        spawn(state.nextSpawnAt, events);
        continue;
      }
      break;
    }
    return events;
  }

  return {
    cfg,
    state,
    range,
    targetPose,

    start() {
      if (state.status !== STATUS.READY) return [];
      state.status = STATUS.RUNNING;
      state.nextSpawnAt = 0;
      return advance(0);
    },

    advance,

    /**
     * 발사 1회. 표적이 없거나 게임 중이 아니면 기록하지 않고 { counted: false }.
     * 판정은 클릭한 순간 t의 표적 실제 위치 기준입니다.
     */
    shoot(t, x, y) {
      const events = [];
      if (state.status !== STATUS.RUNNING) return { counted: false, events };
      if (t < state.lastT) t = state.lastT; // 시간 역행 방지 (서버 재현과 동일한 규칙)
      advance(t, events);
      const target = state.current;
      if (state.status !== STATUS.RUNNING || !target) return { counted: false, events };
      const pose = targetPose(target, t);
      const dx = x - pose.x;
      const dy = y - pose.y;
      const part = classifyHit(dx, dy, cfg.shape);
      const shot = {
        t, x, y, part,
        targetIndex: target.index,
        order: target.shots.length + 1, // 이 표적에 대한 몇 번째 발사인지
        hx: pose.x, hy: pose.y, dx, dy,
        moveDir: pose.dir,
        sinceSpawn: t - target.spawnT,
      };
      target.shots.push(shot);
      state.shots.push(shot);
      target.path.push({ t, x, y });
      if (part === 'head') resolve(target, t, 'head', events);
      return { counted: true, shot, target, events };
    },

    /** 커서 이동 기록 (분석 모드의 경로 분석용). 판정에는 영향 없음 */
    trackCursor(t, x, y, events = []) {
      if (state.status === STATUS.RUNNING) advance(t, events);
      state.lastCursor = { t, x, y };
      const target = state.current;
      if (target) {
        const last = target.path[target.path.length - 1];
        if (!last || t - last.t >= cursorSampleMs) target.path.push({ t, x, y });
      }
      return events;
    },

    /** 커서가 게임 영역을 벗어나면 위치를 알 수 없으므로 '등장 당시 커서 위치'로 쓰지 않음 */
    clearCursor() {
      state.lastCursor = null;
    },

    abort(t) {
      if (state.status !== STATUS.RUNNING && state.status !== STATUS.READY) return;
      state.status = STATUS.ABORTED;
      state.endTime = Math.max(t, state.lastT);
      state.current = null;
      state.nextSpawnAt = null;
    },

    elapsed(t) {
      if (state.endTime !== null) return state.endTime;
      if (state.status !== STATUS.RUNNING) return 0;
      return Math.max(0, t);
    },

    summary() {
      const shots = state.shots;
      const count = (p) => shots.filter((s) => s.part === p).length;
      return {
        status: state.status,
        score: state.score,
        processed: state.processed,
        spawned: state.targets.length,
        headKills: state.headKills,
        timeouts: state.timeouts,
        shots: shots.length,
        headShots: count('head'),
        bodyShots: count('body'),
        feetShots: count('feet'),
        missShots: count('miss'),
        timeMs: state.endTime,
      };
    },
  };
}

/** 0으로 나누는 경우 null(측정 불가)을 돌려주는 비율 계산 */
export function ratio(num, den) {
  if (!den) return null;
  return (num / den) * 100;
}
