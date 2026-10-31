// 분석 모드 결과 계산과 규칙 기반 피드백 생성.
// 피드백의 판단 조건과 최소 데이터 기준은 모두 ANALYSIS_RULES에서 관리합니다.

import { ratio } from './core/engine.js';
import { shapeBounds } from './core/geometry.js';

export const ANALYSIS_RULES = Object.freeze({
  segmentSize: 10, // 초반·중반·후반 구간 크기

  // 첫 클릭 위치 경향
  minFirstShotsOverall: 10, // 전체 첫 클릭 경향을 말하기 위한 최소 첫 클릭 수
  minFirstShotsPerSegment: 5, // 구간 비교에 필요한 구간별 최소 첫 클릭 수
  biasPx: 4, // 평균 편차가 이 값(px) 이상이면 위/아래·좌/우 경향으로 판단 (머리 가로 반지름 7px 기준)
  segmentShiftPx: 4, // 구간 간 평균 세로 위치 차이 기준(px)
  segmentShareDiff: 0.25, // 구간 간 '머리 중심 아래쪽' 비율 차이 기준 (25%p)

  // 지나침(오버슈트) 판별: 표적 등장 당시 커서 위치와 이후 경로가 있을 때만
  overshoot: {
    minApproachPx: 80, // 등장 당시 커서가 머리에서 이만큼 이상 떨어져 있어야 판별 대상
    minSamples: 4, // 등장~첫 발사 사이 경로 샘플 최소 개수
    passPx: 10, // 접근 방향으로 머리 중심을 이만큼 이상 넘어가야 '지나침'
    returnPx: 6, // 지나친 지점에서 이만큼 이상 되돌아온 뒤 발사해야 '되돌아옴'
    minMeasurable: 8, // 판별 가능한 표적이 이 수 이상일 때만 피드백
    repeatRatio: 0.35, // 판별 가능 표적 중 이 비율 이상이면 '반복'
    minRepeatCount: 3, // 그리고 최소 이 횟수 이상
  },

  // 이동형: 이동 방향 기준 앞/뒤 분포
  lead: {
    nearPx: 50, // 머리 중심 좌우 이 범위 안의 클릭만 사용 (엉뚱한 클릭 제외)
    minShots: 8,
    dominantShare: 0.65, // 한쪽 비율이 이 이상이면 '몰림'
    minMeanPx: 3,
  },

  minShotsForTrend: 10, // 전체 발사가 이보다 적으면 경향 분석 생략
});

const PART_LABEL = { head: '머리', body: '몸통', feet: '발', miss: '표적 밖' };

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

function segmentStats(targets) {
  const shots = targets.flatMap((t) => t.shots);
  const kills = targets.filter((t) => t.outcome === 'head');
  const fired = targets.filter((t) => t.shots.length > 0);
  const firstShots = fired.map((t) => t.shots[0]);
  return {
    range: `${targets[0].index}~${targets[targets.length - 1].index}`,
    targets: targets.length,
    kills: kills.length,
    timeouts: targets.filter((t) => t.outcome === 'timeout').length,
    firstShotHeads: firstShots.filter((s) => s.part === 'head').length,
    shots: shots.length,
    headShots: shots.filter((s) => s.part === 'head').length,
    headHitRate: ratio(shots.filter((s) => s.part === 'head').length, shots.length),
    avgKillMs: mean(kills.map((t) => t.resolvedT - t.spawnT)),
    firstShotCount: firstShots.length,
    firstMeanDy: mean(firstShots.map((s) => s.dy)),
    firstBelowShare: firstShots.length ? firstShots.filter((s) => s.dy > 0).length / firstShots.length : null,
  };
}

/** 표적 기준 상대 좌표로 변환한 커서 경로를 이용해 지나쳤다가 되돌아왔는지 판별 */
export function detectOvershoot(target, poseAt, rules = ANALYSIS_RULES.overshoot) {
  const first = target.shots[0];
  if (!first) return { measurable: false, reason: 'no-shot' };
  if (!target.cursorAtSpawn) return { measurable: false, reason: 'no-cursor' };
  const samples = target.path.filter((p) => p.t >= target.spawnT && p.t <= first.t);
  if (samples.length < rules.minSamples) return { measurable: false, reason: 'few-samples' };
  const rel = samples.map((p) => {
    const pose = poseAt(target, p.t);
    return { x: p.x - pose.x, y: p.y - pose.y };
  });
  const s0 = rel[0];
  const D = Math.hypot(s0.x, s0.y);
  if (D < rules.minApproachPx) return { measurable: false, reason: 'too-close' };
  const ux = -s0.x / D;
  const uy = -s0.y / D;
  const progress = rel.map((r) => (r.x - s0.x) * ux + (r.y - s0.y) * uy);
  let maxP = -Infinity;
  for (const p of progress) maxP = Math.max(maxP, p);
  const finalP = progress[progress.length - 1];
  const passed = maxP >= D + rules.passPx;
  const returned = passed && maxP - finalP >= rules.returnPx;
  return { measurable: true, overshoot: returned, passedBy: maxP - D, returnedBy: maxP - finalP, approachPx: D };
}

function fmtPx(v) {
  const r = Math.round(v);
  return `${r > 0 ? '+' : ''}${r}px`;
}
function fmtPct(v) {
  return `${Math.round(v * 100)}%`;
}

/**
 * 완료된 분석 게임(engine)에서 결과를 계산합니다.
 * 중도 종료나 30개 미만 처리 기록에는 호출하지 않습니다(호출 시 예외).
 */
export function analyzeGame(engine, rules = ANALYSIS_RULES) {
  const { state, cfg } = engine;
  const total = cfg.end.count;
  if (state.status !== 'finished' || state.processed !== total) {
    throw new Error('완료되지 않은 기록은 분석하지 않습니다.');
  }
  const targets = state.targets;
  const shots = state.shots;
  const partCounts = { head: 0, body: 0, feet: 0, miss: 0 };
  for (const s of shots) partCounts[s.part] += 1;
  const kills = targets.filter((t) => t.outcome === 'head');
  const firedTargets = targets.filter((t) => t.shots.length > 0);
  const firstShotHeadTargets = firedTargets.filter((t) => t.shots[0].part === 'head');

  const metrics = {
    totalTargets: total,
    removalRate: ratio(kills.length, total),
    firstShotHeadRate: ratio(firstShotHeadTargets.length, total),
    firstShotHeadCount: firstShotHeadTargets.length,
    headHitRate: ratio(partCounts.head, shots.length),
    shots: shots.length,
    partCounts,
    partRates: Object.fromEntries(Object.keys(partCounts).map((k) => [k, ratio(partCounts[k], shots.length)])),
    kills: kills.length,
    timeouts: targets.filter((t) => t.outcome === 'timeout').length,
    noShotTargets: total - firedTargets.length,
    avgKillMs: mean(kills.map((t) => t.resolvedT - t.spawnT)),
    timeMs: state.endTime,
  };

  const size = rules.segmentSize;
  const segments = [0, 1, 2].map((i) => segmentStats(targets.slice(i * size, (i + 1) * size)));
  segments.forEach((s, i) => { s.label = ['초반', '중반', '후반'][i]; });

  const points = shots.map((s) => ({
    dx: s.dx, dy: s.dy, part: s.part, first: s.order === 1, segment: Math.floor((s.targetIndex - 1) / size),
    moveDir: s.moveDir,
  }));

  const feedback = [];
  const notes = [];
  notes.push(`한 번의 ${total}개 테스트에서 나온 이번 플레이의 경향입니다. 같은 조건으로 여러 번 반복해 비교해 보세요.`);

  // 1) 첫 클릭 위치 경향 (발사가 없었던 표적 제외)
  const firstShots = firedTargets.map((t) => t.shots[0]);
  const excluded = total - firstShots.length;
  if (shots.length < rules.minShotsForTrend) {
    feedback.push({ kind: 'data', text: `전체 발사가 ${shots.length}회로 적어 조준 경향 분석을 생략했습니다. (기준: ${rules.minShotsForTrend}회 이상)` });
  } else if (firstShots.length < rules.minFirstShotsOverall) {
    feedback.push({ kind: 'data', text: `첫 클릭이 있는 표적이 ${firstShots.length}개로 적어 첫 클릭 위치 경향을 판단하지 않았습니다. (기준: ${rules.minFirstShotsOverall}개 이상)` });
  } else {
    const mdy = mean(firstShots.map((s) => s.dy));
    const mdx = mean(firstShots.map((s) => s.dx));
    const head = cfg.shape.head;
    const base = `첫 클릭 ${firstShots.length}개 기준${excluded ? `, 발사가 없던 표적 ${excluded}개 제외` : ''}`;
    const vert = Math.abs(mdy) >= rules.biasPx ? (mdy > 0 ? '머리 중심보다 아래쪽' : '머리 중심보다 위쪽') : null;
    const horiz = !cfg.moving && Math.abs(mdx) >= rules.biasPx ? (mdx > 0 ? '오른쪽' : '왼쪽') : null;
    if (vert || horiz) {
      const parts = [];
      if (vert) parts.push(`세로 평균 ${fmtPx(mdy)}로 ${vert}`);
      if (horiz) parts.push(`가로 평균 ${fmtPx(mdx)}로 ${horiz}`);
      feedback.push({ kind: 'observe', text: `첫 클릭이 ${parts.join(', ')}에 분포했습니다. (${base}, 머리 크기 가로 ${head.rx * 2}px·세로 ${head.ry * 2}px)` });
    } else {
      feedback.push({ kind: 'observe', text: `첫 클릭의 평균 위치가 머리 중심에서 크게 치우치지 않았습니다. (세로 ${fmtPx(mdy)}${cfg.moving ? '' : `, 가로 ${fmtPx(mdx)}`}, ${base})` });
    }
  }

  // 2) 구간 비교: 초반 vs 후반 첫 클릭 세로 위치
  const [early, , late] = segments;
  if (early.firstShotCount >= rules.minFirstShotsPerSegment && late.firstShotCount >= rules.minFirstShotsPerSegment) {
    const shift = late.firstMeanDy - early.firstMeanDy;
    const shareDiff = late.firstBelowShare - early.firstBelowShare;
    const counts = `비교에 사용한 첫 클릭: 초반 ${early.firstShotCount}개, 후반 ${late.firstShotCount}개`;
    if (Math.abs(shift) >= rules.segmentShiftPx && Math.abs(shareDiff) >= rules.segmentShareDiff && Math.sign(shift) === Math.sign(shareDiff)) {
      const where = shift > 0 ? '아래쪽' : '위쪽';
      feedback.push({
        kind: 'observe',
        text: `후반 10개 표적에서 첫 클릭이 초반 10개보다 머리 중심 ${where}에 더 많이 분포했습니다. `
          + `(머리 중심 아래쪽 비율 ${fmtPct(early.firstBelowShare)} → ${fmtPct(late.firstBelowShare)}, 평균 세로 위치 ${fmtPx(early.firstMeanDy)} → ${fmtPx(late.firstMeanDy)}; ${counts}) `
          + '이번 플레이에서 관찰된 차이이며, 조준점이 계속 이동한다고 단정할 수는 없습니다.',
      });
    } else {
      feedback.push({ kind: 'observe', text: `초반과 후반의 첫 클릭 세로 위치에 뚜렷한 차이가 없었습니다. (평균 ${fmtPx(early.firstMeanDy)} → ${fmtPx(late.firstMeanDy)}; ${counts})` });
    }
  } else {
    feedback.push({ kind: 'data', text: `초반(${early.firstShotCount}개) 또는 후반(${late.firstShotCount}개)의 첫 클릭이 ${rules.minFirstShotsPerSegment}개 미만이라 구간별 첫 클릭 위치를 비교하지 않았습니다.` });
  }

  // 3) 지나침(오버슈트) — 경로를 실제로 측정·판별할 수 있을 때만
  const ov = targets.map((t) => detectOvershoot(t, engine.targetPose, rules.overshoot));
  const measurable = ov.filter((o) => o.measurable);
  const overshoots = measurable.filter((o) => o.overshoot);
  const overshootInfo = { measurable: measurable.length, overshoots: overshoots.length, total };
  const R = rules.overshoot;
  if (measurable.length < R.minMeasurable) {
    feedback.push({ kind: 'data', text: `커서 경로로 지나침 여부를 판별할 수 있는 표적이 ${measurable.length}개라 지나침 분석을 하지 않았습니다. (기준: ${R.minMeasurable}개 이상. 표적 등장 시 커서가 게임 영역 안에 있고 머리에서 ${R.minApproachPx}px 이상 떨어져 있어야 판별됩니다)` });
  } else if (overshoots.length >= R.minRepeatCount && overshoots.length / measurable.length >= R.repeatRatio) {
    feedback.push({ kind: 'suggest', text: `표적을 지나쳐 되돌아오는 움직임이 반복됐습니다. (판별 가능한 표적 ${measurable.length}개 중 ${overshoots.length}개, ${fmtPct(overshoots.length / measurable.length)}) 감도를 조금 낮춘 뒤 같은 조건에서 비교해 보세요.` });
  } else {
    feedback.push({ kind: 'observe', text: `표적을 지나쳐 되돌아오는 움직임은 반복되지 않았습니다. (판별 가능한 표적 ${measurable.length}개 중 ${overshoots.length}개)` });
  }

  // 4) 이동형: 이동 방향 기준 앞/뒤 분포
  let leadInfo = null;
  if (cfg.moving) {
    const L = rules.lead;
    const near = shots.filter((s) => s.moveDir !== 0 && Math.abs(s.dx) <= L.nearPx
      && s.dy >= -L.nearPx && s.dy <= shapeBounds(cfg.shape).maxY);
    const signed = near.map((s) => s.dx * s.moveDir);
    const ahead = signed.filter((v) => v > 0).length;
    const behind = signed.filter((v) => v < 0).length;
    leadInfo = { n: near.length, ahead, behind, meanPx: mean(signed) };
    if (near.length < L.minShots) {
      feedback.push({ kind: 'data', text: `표적 근처 클릭이 ${near.length}개라 이동 방향 기준 앞/뒤 분포를 판단하지 않았습니다. (기준: ${L.minShots}개 이상)` });
    } else {
      const aShare = ahead / near.length;
      const bShare = behind / near.length;
      const basis = `머리 중심 좌우 ${L.nearPx}px 이내 클릭 ${near.length}개 기준, 앞쪽 ${ahead}개 · 뒤쪽 ${behind}개, 평균 ${fmtPx(leadInfo.meanPx)}`;
      if (aShare >= L.dominantShare && leadInfo.meanPx >= L.minMeanPx) {
        feedback.push({ kind: 'observe', text: `클릭 당시 표적의 이동 방향 기준으로 클릭이 머리 앞쪽에 몰렸습니다. (${basis}) 표적보다 먼저 가 있는 조준이 많았습니다.` });
      } else if (bShare >= L.dominantShare && leadInfo.meanPx <= -L.minMeanPx) {
        feedback.push({ kind: 'observe', text: `클릭 당시 표적의 이동 방향 기준으로 클릭이 머리 뒤쪽에 몰렸습니다. (${basis}) 표적을 따라가는 조준이 늦은 경우가 많았습니다.` });
      } else if (aShare >= L.dominantShare || bShare >= L.dominantShare) {
        const side = aShare >= L.dominantShare ? '앞쪽' : '뒤쪽';
        feedback.push({ kind: 'observe', text: `이동 방향 기준 ${side} 클릭이 더 많았지만 평균 거리가 ${Math.abs(Math.round(leadInfo.meanPx))}px로 작아 뚜렷한 치우침으로 보기는 어렵습니다. (${basis})` });
      } else {
        feedback.push({ kind: 'observe', text: `이동 방향 기준 앞/뒤 클릭 분포가 한쪽으로 크게 몰리지 않았습니다. (${basis})` });
      }
    }
  }

  // 5) 부위 분포 관찰
  if (shots.length >= rules.minShotsForTrend) {
    const top = Object.entries(partCounts).filter(([k]) => k !== 'head').sort((a, b) => b[1] - a[1])[0];
    if (top[1] > 0) {
      feedback.push({ kind: 'observe', text: `머리 이외의 클릭은 ${PART_LABEL[top[0]]}이 가장 많았습니다. (${top[1]}회, 전체 발사의 ${Math.round(ratio(top[1], shots.length))}%)` });
    }
  }

  notes.push('감도 관련 내용은 이 웹앱에서의 마우스 움직임을 바탕으로 한 제안일 뿐이며, 다른 FPS 게임의 적정 감도를 확정하지 않습니다.');

  return { metrics, segments, points, feedback, notes, overshootInfo, leadInfo, moving: cfg.moving };
}

export { PART_LABEL };
