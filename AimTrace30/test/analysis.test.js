import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGameConfig, TARGET_SHAPE, SPAWN_GAP_MS } from '../public/js/config.js';
import { createEngine } from '../public/js/core/engine.js';
import { analyzeGame, detectOvershoot, ANALYSIS_RULES } from '../public/js/analysis.js';

const make = (option, seed = 321) => createEngine(buildGameConfig('analysis', option, seed));

/** 각 표적마다 plan(target, engine) 실행 후 만료까지 진행 */
function play(e, plan) {
  e.start();
  while (e.state.status === 'running') {
    const tg = e.state.current;
    if (tg) {
      plan(tg, e);
      if (e.state.current === tg) e.advance(tg.expireAt);
      else e.advance(tg.resolvedT);
    }
    if (e.state.status === 'running') e.advance(e.state.nextSpawnAt ?? e.state.lastT);
  }
}

test('발사 0회, 성공 0개여도 계산 오류 없이 측정 불가(null) 처리', () => {
  const e = make('static');
  play(e, () => {});
  const a = analyzeGame(e);
  assert.equal(a.metrics.shots, 0);
  assert.equal(a.metrics.headHitRate, null);
  assert.equal(a.metrics.avgKillMs, null);
  assert.equal(a.metrics.removalRate, 0);
  assert.equal(a.metrics.firstShotHeadRate, 0);
  for (const v of Object.values(a.metrics.partRates)) assert.equal(v, null);
  for (const s of a.segments) { assert.equal(s.headHitRate, null); assert.equal(s.avgKillMs, null); }
  assert.ok(a.feedback.some((f) => f.kind === 'data'));
  assert.ok(!a.feedback.some((f) => f.kind === 'suggest'), '데이터 없으면 제안 없음');
  assert.ok(!JSON.stringify(a.metrics).includes('NaN'));
});

test('발사 수와 표적 수를 구분: 몸통 2회 후 머리 → 몸통 2, 머리 1, 제거 1', () => {
  const e = make('static');
  let first = true;
  play(e, (tg, eng) => {
    if (!first) return;
    first = false;
    const p = eng.targetPose(tg, 100);
    eng.shoot(100, p.x, p.y + 40);
    eng.shoot(200, p.x, p.y + 42);
    eng.shoot(300, p.x, p.y);
  });
  const a = analyzeGame(e);
  assert.equal(a.metrics.partCounts.body, 2);
  assert.equal(a.metrics.partCounts.head, 1);
  assert.equal(a.metrics.kills, 1);
  assert.equal(a.metrics.shots, 3);
  assert.equal(a.metrics.firstShotHeadCount, 0, '첫 발은 몸통이었으므로 첫발 헤드 아님');
  assert.ok(Math.abs(a.metrics.headHitRate - 100 / 3) < 1e-9);
  assert.ok(Math.abs(a.metrics.removalRate - 100 / 30) < 1e-9);
  assert.equal(a.metrics.avgKillMs, 300);
  assert.equal(a.metrics.timeouts, 29);
});

test('한 발도 쏘지 않은 표적은 첫발 헤드 성공으로 계산하지 않음, 첫 클릭 비교에서 제외하고 개수 표시', () => {
  const e = make('static');
  let i = 0;
  play(e, (tg, eng) => {
    i++;
    if (i % 2 === 0) return; // 절반은 발사 없음
    const p = eng.targetPose(tg, tg.spawnT + 300);
    eng.shoot(tg.spawnT + 300, p.x, p.y);
  });
  const a = analyzeGame(e);
  assert.equal(a.metrics.firstShotHeadCount, 15);
  assert.equal(a.metrics.firstShotHeadRate, 50);
  assert.equal(a.metrics.noShotTargets, 15);
  assert.ok(a.segments.every((s) => s.firstShotCount === 5));
  assert.ok(a.feedback.some((f) => /첫 클릭 15개 기준, 발사가 없던 표적 15개 제외/.test(f.text)));
});

test('후반 첫 클릭이 아래쪽으로 분포한 경우에만 그 관찰을 보고 (개수 포함)', () => {
  const e = make('static');
  play(e, (tg, eng) => {
    const t = tg.spawnT + 300;
    const p = eng.targetPose(tg, t);
    const dy = tg.index > 20 ? 30 : -2; // 후반: 머리 아래(몸통)
    eng.shoot(t, p.x, p.y + dy);
    if (eng.state.current === tg) eng.shoot(t + 100, p.x, p.y);
  });
  const a = analyzeGame(e);
  const msg = a.feedback.find((f) => f.text.startsWith('후반 10개 표적에서 첫 클릭이'));
  assert.ok(msg, JSON.stringify(a.feedback, null, 1));
  assert.match(msg.text, /아래쪽/);
  assert.match(msg.text, /초반 10개, 후반 10개/);
  assert.match(msg.text, /단정할 수는 없습니다/);
});

test('구간 차이가 없으면 아래쪽 이동 문구를 만들지 않음 (몸통 명중이 있었다는 이유만으로 단정하지 않음)', () => {
  const e = make('static');
  play(e, (tg, eng) => {
    const t = tg.spawnT + 300;
    const p = eng.targetPose(tg, t);
    if (tg.index === 25) eng.shoot(t - 100, p.x, p.y + 40); // 후반에 몸통 1회
    else eng.shoot(t, p.x + (tg.index % 2 ? 2 : -2), p.y + (tg.index % 2 ? 3 : -3));
    if (eng.state.current === tg) eng.shoot(t + 50, p.x, p.y);
  });
  const a = analyzeGame(e);
  assert.ok(!a.feedback.some((f) => f.text.startsWith('후반 10개 표적에서 첫 클릭이')));
});

/** 커서 경로를 합성: 표적 등장 시 커서는 (sx, sy), 머리 방향으로 이동 */
function pathPlay(e, mover) {
  e.start();
  while (e.state.status === 'running') {
    const tg = e.state.current;
    if (tg) {
      mover(tg, e);
      if (e.state.current === tg) e.advance(tg.expireAt);
    }
    if (e.state.status === 'running') {
      const next = e.state.nextSpawnAt;
      // 등장 간격 동안 커서를 다음 시작 위치로 (표적에서 먼 곳)
      e.trackCursor(next - 50, 40, 40);
      e.advance(next);
    }
  }
}

test('지나쳤다가 되돌아오는 경로가 반복되면 감도 제안 (단정하지 않는 문구)', () => {
  const e = make('static', 9);
  e.trackCursor(-1, 40, 40); // 시작 전 커서 위치
  pathPlay(e, (tg, eng) => {
    const hx = tg.x0; const hy = tg.y0;
    const sx = 40; const sy = 40;
    const D = Math.hypot(hx - sx, hy - sy);
    const ux = (hx - sx) / D; const uy = (hy - sy) / D;
    const t0 = tg.spawnT;
    // 머리를 25px 지나쳤다가 되돌아옴
    const pts = [0.3, 0.7, 1.0, 1.0 + 25 / D, 1.0 + 25 / D, 1.0];
    pts.forEach((k, i) => eng.trackCursor(t0 + 40 + i * 40, sx + (hx - sx) * k, sy + (hy - sy) * k));
    eng.shoot(t0 + 300, hx, hy);
    void ux; void uy;
  });
  const a = analyzeGame(e);
  const s = a.feedback.find((f) => f.kind === 'suggest');
  assert.ok(s, JSON.stringify(a.feedback, null, 1));
  assert.match(s.text, /지나쳐 되돌아오는 움직임이 반복됐습니다/);
  assert.match(s.text, /비교해 보세요/);
  assert.ok(!/너무 높습니다/.test(s.text));
  assert.ok(a.overshootInfo.measurable >= ANALYSIS_RULES.overshoot.minMeasurable);
});

test('클릭이 표적 오른쪽에 있다는 것만으로 지나쳤다고 판단하지 않음 (경로 없으면 판별 불가)', () => {
  const e = make('static', 9);
  play(e, (tg, eng) => {
    const t = tg.spawnT + 300;
    const p = eng.targetPose(tg, t);
    eng.shoot(t, p.x + 20, p.y); // 오른쪽 클릭, 커서 경로 없음
  });
  const a = analyzeGame(e);
  assert.equal(a.overshootInfo.measurable, 0);
  assert.ok(!a.feedback.some((f) => f.kind === 'suggest'));
  assert.ok(a.feedback.some((f) => /지나침 분석을 하지 않았습니다/.test(f.text)));
});

test('곧바로 접근한 경로는 지나침으로 판별하지 않음', () => {
  const e = make('static', 9);
  e.trackCursor(-1, 40, 40);
  pathPlay(e, (tg, eng) => {
    const t0 = tg.spawnT;
    [0.3, 0.6, 0.9, 1.0].forEach((k, i) => eng.trackCursor(t0 + 40 + i * 40, 40 + (tg.x0 - 40) * k, 40 + (tg.y0 - 40) * k));
    eng.shoot(t0 + 250, tg.x0, tg.y0);
  });
  const a = analyzeGame(e);
  assert.ok(a.overshootInfo.measurable >= 8);
  assert.equal(a.overshootInfo.overshoots, 0);
  assert.ok(!a.feedback.some((f) => f.kind === 'suggest'));
});

test('이동형: 이동 방향 기준 뒤쪽에 몰린 클릭을 분석', () => {
  const e = make('moving', 55);
  play(e, (tg, eng) => {
    const t = tg.spawnT + 400;
    const p = eng.targetPose(tg, t);
    eng.shoot(t, p.x - p.dir * 5, p.y); // 이동 방향 반대쪽(뒤) 5px — 머리 안
    void SPAWN_GAP_MS;
  });
  const a = analyzeGame(e);
  assert.equal(a.leadInfo.behind, 30);
  assert.ok(a.feedback.some((f) => /머리 뒤쪽에 몰렸습니다/.test(f.text)));
});

test('이동형: 클릭 순간 위치 기준 머리 중심 상대 좌표가 정확', () => {
  const e = make('moving', 56);
  play(e, (tg, eng) => {
    const t = tg.spawnT + 777;
    const p = eng.targetPose(tg, t);
    eng.shoot(t, p.x + 3, p.y - 4);
  });
  for (const s of e.state.shots) {
    assert.ok(Math.abs(s.dx - 3) < 1e-9 && Math.abs(s.dy + 4) < 1e-9);
    assert.equal(s.part, 'head');
  }
});

test('완료되지 않은(중도 종료) 기록은 분석하지 않음', () => {
  const e = make('static');
  e.start();
  e.advance(3000);
  e.abort(3000);
  assert.throws(() => analyzeGame(e));
});

test('detectOvershoot: 등장 당시 커서가 머리 근처면 판별 대상 아님', () => {
  const e = make('static');
  e.start();
  const tg = e.state.current;
  tg.cursorAtSpawn = { x: tg.x0 + 10, y: tg.y0 };
  tg.path = [0, 20, 40, 60].map((t) => ({ t, x: tg.x0 + 10 - t / 10, y: tg.y0 }));
  e.shoot(80, tg.x0, tg.y0);
  assert.equal(detectOvershoot(tg, e.targetPose).measurable, false);
  void TARGET_SHAPE;
});
