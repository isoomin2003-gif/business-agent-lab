import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGameConfig, TARGETS_PER_GAME, RANK_GOAL_SCORE, SPAWN_GAP_MS, ARENA, TARGET_SHAPE, EXPOSURE_MS, FLOOR, RANK, MOVE_SPEED, MOVE_PATTERN } from '../public/js/config.js';
import { createEngine } from '../public/js/core/engine.js';
import { shapeBounds, classifyHit } from '../public/js/core/geometry.js';

const make = (mode, option, seed = 12345) => createEngine(buildGameConfig(mode, option, seed));

/** 현재 표적 머리를 시각 t에 정확히 쏨 */
function headShot(e, t) {
  const pose = e.targetPose(e.state.current, t);
  return e.shoot(t, pose.x, pose.y);
}
/** 현재 표적 몸통 중앙을 쏨 */
function bodyShot(e, t) {
  const pose = e.targetPose(e.state.current, t);
  return e.shoot(t, pose.x, pose.y + 28); // 가슴
}
function feetShot(e, t) {
  const pose = e.targetPose(e.state.current, t);
  return e.shoot(t, pose.x + 8, pose.y + 80); // 오른쪽 정강이
}

test('노출 시간: 기본 쉬움 1.5초·보통 1초·어려움 0.5초, 움직임은 더 김, 분석 정지형=기본 보통, 랭크=1초', () => {
  assert.deepEqual(EXPOSURE_MS.static, { easy: 1500, normal: 1000, hard: 500 });
  for (const d of ['easy', 'normal', 'hard']) {
    assert.equal(buildGameConfig('basic', d, 1).exposureMs, EXPOSURE_MS.static[d]);
    assert.ok(buildGameConfig('moving', d, 1).exposureMs > EXPOSURE_MS.static[d]);
  }
  assert.equal(buildGameConfig('analysis', 'static', 1).exposureMs, 1000);
  assert.equal(buildGameConfig('rank', null, 1).exposureMs, 1000, '랭크 노출 1초');
  assert.equal(RANK.exposureMs, 1000);
  assert.deepEqual(EXPOSURE_MS.static, { easy: 1500, normal: 1000, hard: 500 }, '기본 모드 난이도는 그대로');
  assert.equal(SPAWN_GAP_MS, 500, '표적이 사라진 뒤 다음 표적까지 0.5초');
  assert.equal(RANK.rulesVersion, 'rank-v5', '노출 시간 변경으로 랭크 규칙 버전 분리');
});

test('판정 형상: 머리/몸통/발/밖 구분, 팔은 몸통, 다리는 발', () => {
  assert.equal(classifyHit(0, 0, TARGET_SHAPE), 'head');
  assert.equal(classifyHit(6.5, 0, TARGET_SHAPE), 'head'); // 타원 가로 끝
  assert.equal(classifyHit(0, -7.5, TARGET_SHAPE), 'head'); // 타원 위 끝
  assert.equal(classifyHit(6.5, 6.5, TARGET_SHAPE), 'miss'); // 타원 바깥 모서리
  assert.equal(classifyHit(0, 9, TARGET_SHAPE), 'miss'); // 목 틈
  assert.equal(classifyHit(18, 18, TARGET_SHAPE), 'body'); // 어깨 장갑
  assert.equal(classifyHit(-15, 30, TARGET_SHAPE), 'body'); // 가슴 앞 팔뚝
  assert.equal(classifyHit(0, 40, TARGET_SHAPE), 'body'); // 허리
  assert.equal(classifyHit(15, 38, TARGET_SHAPE), 'miss'); // 팔과 허리 사이
  assert.equal(classifyHit(-8, 80, TARGET_SHAPE), 'feet'); // 정강이
  assert.equal(classifyHit(14, 98, TARGET_SHAPE), 'feet'); // 부츠
  assert.equal(classifyHit(0, 80, TARGET_SHAPE), 'miss'); // 다리 사이
  assert.equal(classifyHit(30, 30, TARGET_SHAPE), 'miss');
});

test('판정 영역은 렌더러가 그리는 다각형과 같은 데이터 (좌우 대칭)', () => {
  for (const [x, y] of [[18, 18], [-15, 30], [-8, 80], [14, 98], [6.5, 0]]) {
    assert.equal(classifyHit(x, y, TARGET_SHAPE), classifyHit(-x, y, TARGET_SHAPE));
  }
  const b = shapeBounds(TARGET_SHAPE);
  assert.equal(b.maxY - b.minY, TARGET_SHAPE.height);
});

test('표적은 항상 한 번에 하나만 존재하고, 처리 후 정확히 등장 간격(0.5초) 뒤 다음 표적이 등장', () => {
  const e = make('basic', 'normal');
  e.start();
  let maxAlive = 0;
  for (let t = 0; e.state.status === 'running'; t += 7) {
    e.advance(t);
    const alive = e.state.targets.filter((x) => x.outcome === null).length;
    maxAlive = Math.max(maxAlive, alive);
    assert.ok(alive <= 1);
  }
  assert.equal(maxAlive, 1);
  const ts = e.state.targets;
  for (let i = 1; i < ts.length; i++) assert.equal(ts[i].spawnT, ts[i - 1].resolvedT + SPAWN_GAP_MS);
});

test('표적 실루엣은 항상 게임 영역 안에 등장', () => {
  for (const mode of ['basic', 'moving', 'rank']) {
    const e = make(mode, mode === 'rank' ? null : 'easy', 999);
    const b = shapeBounds(TARGET_SHAPE);
    e.start();
    for (let t = 0; e.state.status === 'running' && t < 200000; t += 5) {
      e.advance(t);
      const cur = e.state.current;
      if (!cur) continue;
      const p = e.targetPose(cur, t);
      assert.ok(p.x + b.minX >= 0 && p.x + b.maxX <= ARENA.width, `${mode} x 범위 ${p.x}`);
      assert.ok(p.y + b.minY >= 0 && p.y + b.maxY <= ARENA.height, `${mode} y 범위 ${p.y}`);
      assert.ok(p.y + b.maxY >= FLOOR.feetMinY && p.y + b.maxY <= FLOOR.feetMaxY, `${mode} 발이 바닥 위 ${p.y}`);
      if (mode === 'rank' && e.state.targets.length > 50) break;
    }
  }
});

test('머리 명중과 시간 초과가 같은 순간에 겹쳐도 중복 처리되지 않음', () => {
  const e = make('basic', 'hard');
  e.start();
  const target = e.state.current;
  // 만료 직전(경계 직전) 머리 명중
  const r1 = headShot(e, target.expireAt - 0.001);
  assert.equal(r1.shot.part, 'head');
  e.advance(target.expireAt + 50);
  assert.equal(e.state.processed, 1);
  assert.equal(e.state.score, 1);
  assert.equal(e.state.timeouts, 0);

  // 만료 시각과 정확히 같은 순간의 클릭은 시간 초과가 먼저 처리되어 발사로 기록되지 않음
  e.advance(target.resolvedT + SPAWN_GAP_MS);
  const t2 = e.state.current;
  const r2 = headShot(e, t2.expireAt);
  assert.equal(r2.counted, false);
  assert.equal(t2.outcome, 'timeout');
  assert.equal(e.state.processed, 2);
  assert.equal(e.state.score, 1);
  assert.equal(e.state.shots.length, 1);
});

test('몸통·발 명중 후에도 표적이 남은 시간 동안 유지되고 노출 시간이 초기화되지 않음', () => {
  const e = make('basic', 'easy');
  e.start();
  const target = e.state.current;
  const expire = target.expireAt;
  assert.equal(bodyShot(e, 300).shot.part, 'body');
  assert.equal(e.state.current, target);
  assert.equal(feetShot(e, 700).shot.part, 'feet');
  assert.equal(bodyShot(e, 1200).shot.part, 'body');
  assert.equal(e.state.current, target);
  assert.equal(target.expireAt, expire);
  e.advance(expire - 1);
  assert.equal(e.state.current, target, '만료 직전까지 유지');
  // 남은 시간 안에 머리를 다시 노릴 수 있음
  assert.equal(headShot(e, expire - 0.5).shot.part, 'head');
  assert.equal(target.outcome, 'head');
  assert.deepEqual(target.shots.map((s) => s.part), ['body', 'feet', 'body', 'head']);
  assert.equal(e.state.processed, 1);
});

test('몸통 명중만 하고 머리를 못 맞히면 원래 만료 시각에 시간 초과', () => {
  const e = make('basic', 'easy');
  e.start();
  const target = e.state.current;
  bodyShot(e, 1400);
  e.advance(EXPOSURE_MS.static.easy);
  assert.equal(target.outcome, 'timeout');
  assert.equal(target.resolvedT, EXPOSURE_MS.static.easy);
});

test('표적 바깥 클릭은 빗나간 발사, 표적이 없을 때 클릭은 기록 제외', () => {
  const e = make('basic', 'normal');
  assert.equal(e.shoot(0, 10, 10).counted, false, '시작 전');
  e.start();
  const pose = e.targetPose(e.state.current, 10);
  const far = { x: pose.x > 500 ? 20 : 1020, y: 20 };
  const r = e.shoot(10, far.x, far.y);
  assert.equal(r.shot.part, 'miss');
  headShot(e, 20);
  assert.equal(e.shoot(100, 500, 300).counted, false, '등장 간격 중');
  assert.equal(e.state.shots.length, 2);
});

test('움직이는 표적: 클릭 순간의 실제 위치로 판정 (생성 위치가 아님)', () => {
  const e = make('moving', 'normal');
  e.start();
  const target = e.state.current;
  const t = 600;
  const p = e.targetPose(target, t);
  assert.notEqual(p.x, target.x0, '표적이 이동함');
  // 생성 위치를 쏘면 머리가 아님
  const r1 = e.shoot(t, target.x0, target.y0);
  assert.notEqual(r1.shot.part, 'head');
  // 실제 위치를 쏘면 머리
  const r2 = e.shoot(t + 1, e.targetPose(target, t + 1).x, target.y0);
  assert.equal(r2.shot.part, 'head');
  assert.equal(r2.shot.hx, e.targetPose(target, t + 1).x);
});

test('움직이는 표적: 영상처럼 짧은 간격마다 좌우 방향을 바꾸는 지그재그 (속도 제한·영역 안·부드러운 전환)', () => {
  let turnsTotal = 0;
  let exposureTotal = 0;
  for (const option of ['easy', 'normal', 'hard']) {
    const e = make('moving', option, 4242);
    e.start();
    const { minX, maxX } = e.range;
    for (let k = 0; k < 30 && e.state.status === 'running'; k++) {
      const tg = e.state.current;
      let prev = { ...e.targetPose(tg, tg.spawnT), v: null };
      let turns = 0;
      let fullSpeedSteps = 0;
      let steps = 0;
      for (let t = tg.spawnT + 1; t < tg.expireAt; t += 1) {
        const p = e.targetPose(tg, t);
        const v = (p.x - prev.x) * 1000; // px/s
        assert.ok(p.x >= minX - 1e-9 && p.x <= maxX + 1e-9, '영역 밖으로 나가지 않음');
        assert.ok(Math.abs(v) <= MOVE_SPEED + 1e-6, `속도 제한 ${v}`);
        if (prev.v !== null) assert.ok(Math.abs(v - prev.v) <= ((2 * MOVE_SPEED) / MOVE_PATTERN.turnMs) * 1.01 + 1e-6, '순간 반전 없이 부드럽게 전환');
        if (Math.abs(Math.abs(v) - MOVE_SPEED) < 1e-6) fullSpeedSteps++;
        if (p.dir !== prev.dir) turns++;
        steps++;
        prev = { ...p, v };
      }
      assert.ok(fullSpeedSteps / steps > 0.5, '대부분의 시간은 일정한 속도');
      turnsTotal += turns;
      exposureTotal += tg.expireAt - tg.spawnT;
      e.advance(tg.expireAt);
      if (e.state.status === 'running') e.advance(e.state.nextSpawnAt);
    }
  }
  const perSecond = turnsTotal / (exposureTotal / 1000);
  assert.ok(perSecond > 1, `초당 방향 전환이 1회 이상 (평균 ${perSecond.toFixed(2)})`);
  // 같은 시드는 같은 경로 (재현 가능), 시드가 다르면 다른 경로
  const path = (seed) => { const e = make('moving', 'normal', seed); e.start(); const tg = e.state.current; return [0, 300, 900, 1500].map((t) => e.targetPose(tg, t).x); };
  assert.deepEqual(path(9), path(9));
  assert.notDeepEqual(path(9), path(10));
});

for (const [mode, option] of [['basic', 'easy'], ['basic', 'hard'], ['moving', 'normal'], ['analysis', 'static'], ['analysis', 'moving']]) {
  test(`${mode}/${option}: 모든 표적을 놓쳐도 정확히 ${TARGETS_PER_GAME}개 처리 후 종료`, () => {
    const e = make(mode, option);
    e.start();
    e.advance(10_000_000);
    assert.equal(e.state.status, 'finished');
    assert.equal(e.state.processed, TARGETS_PER_GAME);
    assert.equal(e.state.targets.length, TARGETS_PER_GAME, '31번째 표적을 만들지 않음');
    assert.equal(e.state.score, 0);
    assert.equal(e.state.timeouts, TARGETS_PER_GAME);
    assert.equal(e.state.nextSpawnAt, null);
    const last = e.state.targets.at(-1);
    assert.equal(e.state.endTime, last.resolvedT);
    const s = e.summary();
    assert.equal(s.shots, 0);
  });

  test(`${mode}/${option}: 20점을 얻어도 조기 종료되지 않고 성공 여부와 무관하게 30개 처리 후 종료`, () => {
    const e = make(mode, option);
    e.start();
    let t = 0;
    let n = 0;
    while (e.state.status === 'running') {
      e.advance(t);
      if (e.state.current) {
        const tg = e.state.current;
        n++;
        if (n % 3 === 0) { t = tg.expireAt; e.advance(t); } // 3개 중 1개는 놓침
        else { t = tg.spawnT + 300; headShot(e, t); }
        if (e.state.score >= RANK_GOAL_SCORE && e.state.processed < TARGETS_PER_GAME) assert.equal(e.state.status, 'running', '20점에서 종료되면 안 됨');
      }
      t += SPAWN_GAP_MS;
    }
    assert.equal(e.state.processed, TARGETS_PER_GAME);
    assert.equal(e.state.score, 20);
    assert.equal(e.state.timeouts, 10);
    assert.equal(e.state.headKills + e.state.timeouts, e.state.processed);
    // 종료 후 클릭은 무시
    assert.equal(e.shoot(t + 1000, 100, 100).counted, false);
  });
}

test('기본 모드: 30개 모두 머리 명중 시 30점, 30번째 처리 즉시 종료', () => {
  const e = make('basic', 'normal');
  e.start();
  let t = 0;
  while (e.state.status === 'running') {
    e.advance(t);
    if (e.state.current) { t = e.state.current.spawnT + 250; headShot(e, t); }
    t += SPAWN_GAP_MS;
  }
  assert.equal(e.state.score, 30);
  assert.equal(e.state.endTime, e.state.targets[29].resolvedT);
});

test('랭크: 30개를 넘게 진행해도 20점 미만이면 계속됨, 음수 점수와 시간 초과 감점', () => {
  const e = make('rank', null);
  e.start();
  // 처음 35개를 모두 놓침 → -35점, 계속 진행
  e.advance(0);
  for (let i = 0; i < 35; i++) {
    const tg = e.state.current;
    bodyShot(e, tg.spawnT + 100); // 몸통 발사는 감점 없음
    e.shoot(tg.spawnT + 150, 1, 1); // 허공 발사도 감점 없음
    e.advance(tg.expireAt);
    e.advance(tg.expireAt + SPAWN_GAP_MS);
  }
  assert.equal(e.state.status, 'running');
  assert.equal(e.state.score, -35, '시간 초과 1개당 -1점, 표적당 한 번만');
  assert.equal(e.state.processed, 35);
  assert.ok(e.state.targets.length > 30);
});

test('랭크: 20점에 도달한 순간 종료 (다음 표적 생성 안 함)', () => {
  const e = make('rank', null);
  e.start();
  let t = 0;
  let i = 0;
  while (e.state.status === 'running') {
    e.advance(t);
    const tg = e.state.current;
    if (!tg) { t += 1; continue; }
    i++;
    if (i % 4 === 0) { t = tg.expireAt; e.advance(t); } // 일부 놓침 → -1
    else { t = tg.spawnT + 400; headShot(e, t); }
    t += SPAWN_GAP_MS;
  }
  const st = e.state;
  assert.equal(st.score, 20);
  assert.equal(st.headKills - st.timeouts, 20);
  assert.equal(st.endTime, st.targets.at(-1).resolvedT);
  assert.equal(st.targets.at(-1).outcome, 'head');
  e.advance(st.endTime + 10000);
  assert.equal(st.targets.length, st.headKills + st.timeouts);
});

test('모든 모드: 시드가 다르면 표적 위치·순서가 달라지고, 같은 시드는 그대로 재현 (서버 검증용)', () => {
  const seq = (mode, option, seed) => {
    const e = createEngine(buildGameConfig(mode, option, seed));
    e.start();
    e.advance(100000);
    return e.state.targets.map((t) => [t.x0, t.y0]);
  };
  for (const [mode, option] of [['basic', 'normal'], ['moving', 'easy'], ['analysis', 'static'], ['rank', null]]) {
    assert.notDeepEqual(seq(mode, option, 1), seq(mode, option, 2), `${mode}: 판마다 다른 위치·순서`);
    assert.deepEqual(seq(mode, option, 7), seq(mode, option, 7), `${mode}: 같은 시드는 재현 가능`);
  }
});

test('표적 위치가 게임 영역 전체에 고르게 무작위로 분포', () => {
  const e = createEngine(buildGameConfig('rank', null, 2026));
  e.start();
  e.advance(1e7);
  const xs = e.state.targets.map((t) => t.x0);
  const ys = e.state.targets.map((t) => t.y0);
  const { minX, maxX, minY, maxY } = e.range;
  // 영역을 4×2 칸으로 나눴을 때 모든 칸에 표적이 등장
  const cells = new Set(e.state.targets.map((t) => `${Math.min(3, Math.floor(((t.x0 - minX) / (maxX - minX)) * 4))},${Math.min(1, Math.floor(((t.y0 - minY) / (maxY - minY)) * 2))}`));
  assert.equal(cells.size, 8);
  assert.ok(Math.max(...ys) - Math.min(...ys) > (maxY - minY) * 0.8);
});

test('advance 호출 빈도와 무관하게 결과가 같음 (서버 재현 가능)', () => {
  const run = (step) => {
    const e = make('moving', 'hard', 77);
    e.start();
    const shotsAt = [130, 900, 2100, 2600, 4000, 5555];
    let si = 0;
    for (let t = 0; t <= 8000; t += step) {
      while (si < shotsAt.length && shotsAt[si] <= t) { e.shoot(shotsAt[si], 500, 300); si++; }
      e.advance(t);
    }
    return JSON.stringify(e.state.targets.map((t) => [t.outcome, t.resolvedT, t.shots.length]));
  };
  assert.equal(run(1), run(16));
  assert.equal(run(1), run(1000));
});

test('중도 종료: 상태가 aborted이고 처리 수가 30 미만', () => {
  const e = make('analysis', 'static');
  e.start();
  e.advance(5000);
  e.abort(5000);
  assert.equal(e.state.status, 'aborted');
  assert.ok(e.state.processed < 30);
  assert.equal(e.shoot(5100, 1, 1).counted, false);
  e.advance(1e7);
  assert.ok(e.state.processed < 30, '중도 종료 후 진행되지 않음');
});

test('새 엔진은 이전 게임의 기록·타이머를 공유하지 않음', () => {
  const a = make('basic', 'easy', 5);
  a.start();
  a.advance(1e6);
  const b = make('basic', 'easy', 5);
  assert.equal(b.state.targets.length, 0);
  assert.equal(b.state.score, 0);
  assert.equal(b.state.processed, 0);
  assert.equal(b.elapsed(500), 0, '시작 전 경과 시간 0');
  b.start();
  assert.equal(b.state.targets.length, 1);
});
