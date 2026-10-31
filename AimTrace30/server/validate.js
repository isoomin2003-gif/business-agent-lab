// 랭크 기록 검증. 클라이언트가 보낸 완료 시간을 그대로 믿지 않고,
// 공유 엔진으로 발사 기록을 서버에서 재현해 표적 순서·명중/시간 초과·점수·완료 시간을 다시 계산한 뒤 비교합니다.

import { ARENA, RANK, buildGameConfig } from '../public/js/config.js';
import { createEngine } from '../public/js/core/engine.js';

export const VALIDATION = Object.freeze({
  maxShots: 6000,
  maxTimeMs: 60 * 60 * 1000, // 한 판 최대 1시간
  sessionTtlMs: 2 * 60 * 60 * 1000, // 세션 유효 시간
  // 세션 생성 → 제출까지 실제 경과 시간이 (카운트다운 + 완료 시간)보다 이만큼 이상 짧으면 거부
  wallClockToleranceMs: 1500,
  countdownMs: 3000,
  // 표적 등장 후 이 시간 안의 머리 명중은 사람의 반응으로 보기 어려움
  minHumanReactionMs: 90,
  maxImplausibleHits: 2,
  timeToleranceMs: 0.5, // 클라이언트 계산 시간과 서버 재계산 시간의 허용 오차
});

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {object} submission { rulesVersion, shots:[{t,x,y}], claimed:{timeMs, score, headKills, timeouts, outcomes:[ 'head'|'timeout' ]} }
 * @param {object} session { created_at }
 * @param {number} now 서버 현재 시각(ms)
 */
export function validateRankRun(submission, session, now) {
  const fail = (reason) => ({ ok: false, reason });
  if (!submission || typeof submission !== 'object') return fail('잘못된 요청 형식입니다.');
  if (submission.rulesVersion !== RANK.rulesVersion) return fail('랭크 규칙 버전이 다릅니다. 페이지를 새로고침해 주세요.');
  if (submission.backgroundId !== RANK.backgroundId) return fail('랭크 고정 배경과 다른 배경에서 플레이한 기록입니다.');
  const { shots, claimed } = submission;
  if (!Array.isArray(shots) || shots.length === 0) return fail('발사 기록이 없습니다.');
  if (shots.length > VALIDATION.maxShots) return fail('발사 기록이 너무 많습니다.');
  if (!claimed || !isNum(claimed.timeMs) || !Array.isArray(claimed.outcomes)) return fail('결과 요약이 없습니다.');

  let prevT = 0;
  for (const s of shots) {
    if (!s || !isNum(s.t) || !isNum(s.x) || !isNum(s.y)) return fail('발사 기록 형식이 올바르지 않습니다.');
    if (s.t < prevT) return fail('발사 시각 순서가 올바르지 않습니다.');
    if (s.x < 0 || s.x > ARENA.width || s.y < 0 || s.y > ARENA.height) return fail('게임 영역 밖의 발사 좌표가 있습니다.');
    if (s.t > VALIDATION.maxTimeMs) return fail('진행 시간이 너무 깁니다.');
    prevT = s.t;
  }

  // 서버 재현: 세션 발급 시 서버가 저장한 시드로 표적 위치·순서를 다시 만듦 (클라이언트가 보낸 시드는 사용하지 않음)
  const engine = createEngine(buildGameConfig('rank', null, session.seed));
  engine.start();
  let implausible = 0;
  for (const s of shots) {
    const r = engine.shoot(s.t, s.x, s.y);
    if (!r.counted) return fail('표적이 없는 시점의 발사가 포함되어 있습니다.');
    if (r.shot.part === 'head' && r.shot.sinceSpawn < VALIDATION.minHumanReactionMs) implausible += 1;
  }
  const st = engine.state;
  if (st.status !== 'finished') return fail(`서버 재계산 결과 목표 점수 ${RANK.goalScore}점에 도달하지 않았습니다.`);
  const lastShot = shots[shots.length - 1];
  if (st.endTime !== lastShot.t) return fail('종료 이후의 발사 기록이 포함되어 있습니다.');
  if (implausible > VALIDATION.maxImplausibleHits) return fail('비정상적으로 빠른 명중이 반복되어 등록할 수 없습니다.');

  const outcomes = st.targets.map((t) => t.outcome);
  if (outcomes.length !== claimed.outcomes.length || outcomes.some((o, i) => o !== claimed.outcomes[i])) {
    return fail('표적별 성공·실패 기록이 서버 재계산과 일치하지 않습니다.');
  }
  if (claimed.score !== st.score || claimed.headKills !== st.headKills || claimed.timeouts !== st.timeouts) {
    return fail('점수 계산이 서버 재계산과 일치하지 않습니다.');
  }
  if (Math.abs(claimed.timeMs - st.endTime) > VALIDATION.timeToleranceMs) {
    return fail('완료 시간이 서버 재계산과 일치하지 않습니다.');
  }

  // 실제 경과 시간 검사: 서버가 세션을 발급한 뒤 흐른 시간보다 짧은 기록은 불가능
  const wall = now - session.created_at;
  if (wall + VALIDATION.wallClockToleranceMs < VALIDATION.countdownMs + st.endTime) {
    return fail('세션 발급 이후 실제 경과 시간보다 기록이 깁니다.');
  }
  if (wall > VALIDATION.sessionTtlMs) return fail('세션이 만료되었습니다.');

  return {
    ok: true,
    result: {
      timeMs: Math.round(st.endTime),
      backgroundId: RANK.backgroundId,
      score: st.score,
      headKills: st.headKills,
      timeouts: st.timeouts,
      targets: st.targets.length,
      shots: st.shots.length,
    },
  };
}
