import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGameConfig, TRACKING, MOVE_SPEED, FIXED_BACKGROUND, RANK, DEFAULT_BACKGROUND } from '../public/js/config.js';
import { createTrackingEngine } from '../public/js/core/tracking.js';
import { pickBackground, RANDOM_BACKGROUND_POOL, BACKGROUNDS } from '../public/js/backgrounds.js';

const make = (option, seed = 7) => createTrackingEngine(buildGameConfig('tracking', option, seed));

/** 공을 완벽히 따라가는 커서를 주어진 주사율(프레임 간격)로 흉내: 매 프레임 마우스 이동 이벤트 + advance */
function playFollowing(e, frameMs, { offsetPx = 0, until = TRACKING.durationMs } = {}) {
  e.start();
  for (let t = 0; t <= until; t += frameMs) {
    const b = e.ballAt(t);
    e.setCursor(t, b.x + offsetPx, b.y);
    e.advance(t);
  }
  e.advance(until);
}

test('난이도별 공 크기는 동일, 속도는 쉬움 < 보통 < 어려움, 움직임 모드 속도와 별개', () => {
  const radii = ['easy', 'normal', 'hard'].map((o) => buildGameConfig('tracking', o, 1).radius);
  assert.deepEqual(radii, [TRACKING.ballRadius, TRACKING.ballRadius, TRACKING.ballRadius]);
  const d = TRACKING.difficulties;
  assert.ok(d.easy.speed < d.normal.speed && d.normal.speed < d.hard.speed);
  assert.equal(d.easy.pattern, 'horizontal');
  assert.ok(d.hard.changeMaxMs < d.normal.changeMinMs, '어려움이 더 잦은 방향 전환');
  assert.ok(d.hard.maxTurnDegPerSec > d.normal.maxTurnDegPerSec);
  assert.equal(MOVE_SPEED, 168, '움직임 모드 속도만 70%로 변경');
});

test('공은 30초 동안 연속으로 움직이고(순간이동 없음) 영역 밖·점수판 쪽으로 나가지 않음', () => {
  for (const o of ['easy', 'normal', 'hard']) {
    for (const seed of [1, 2, 3]) {
      const e = make(o, seed);
      const { area } = e.cfg;
      let prev = e.ballAt(0);
      for (let t = 1; t <= TRACKING.durationMs; t += 1) {
        const b = e.ballAt(t);
        assert.ok(b.x >= area.x0 - 1e-9 && b.x <= area.x1 + 1e-9 && b.y >= area.y0 - 1e-9 && b.y <= area.y1 + 1e-9, `${o} 영역 안`);
        const step = Math.hypot(b.x - prev.x, b.y - prev.y);
        assert.ok(step <= TRACKING.difficulties[o].speed / 1000 + 1e-6, `${o} 1ms 이동량이 속도 이하`);
        prev = b;
      }
      // 공 전체가 화면 안
      assert.ok(area.x0 - e.cfg.radius >= 0 && area.x1 + e.cfg.radius <= 1040);
      assert.ok(area.y0 - e.cfg.radius >= 150, '천장 점수판(y 150까지) 아래');
      assert.ok(area.y1 + e.cfg.radius <= 600);
    }
  }
  // 쉬움은 좌우로만
  const easy = make('easy', 4);
  assert.equal(easy.ballAt(0).y, easy.ballAt(20000).y);
  assert.notEqual(easy.ballAt(0).x, easy.ballAt(5000).x);
});

test('추적 시간은 실제 경과 시간 기준: 주사율(60/144/240Hz)과 무관하게 같은 결과', () => {
  const results = [1000 / 60, 1000 / 144, 1000 / 240].map((f) => {
    const e = make('normal', 11);
    playFollowing(e, f);
    return e.summary();
  });
  for (const r of results) {
    assert.equal(r.status, 'finished');
    assert.equal(r.playedMs, TRACKING.durationMs);
    assert.ok(r.rate > 99, `거의 완벽 추적 ${r.rate}`);
  }
  // 프레임 간격이 달라도 차이는 1프레임(공 이동) 정도 이내
  const spread = Math.max(...results.map((r) => r.insideMs)) - Math.min(...results.map((r) => r.insideMs));
  assert.ok(spread < 50, `주사율 간 차이 ${spread}ms`);
});

test('조준점이 공 밖이면 0%, 반만 따라가면 절반, 최장 연속 추적 시간 계산', () => {
  const out = make('easy', 3);
  playFollowing(out, 16, { offsetPx: TRACKING.ballRadius + 5 });
  assert.equal(out.summary().insideMs, 0);
  assert.equal(out.summary().rate, 0);
  assert.equal(out.summary().bestStreakMs, 0);

  const half = make('easy', 3);
  half.start();
  for (let t = 0; t <= TRACKING.durationMs; t += 10) {
    const b = half.ballAt(t);
    const inside = Math.floor(t / 5000) % 2 === 0; // 5초씩 번갈아
    half.setCursor(t, b.x + (inside ? 0 : 200), b.y);
  }
  half.advance(TRACKING.durationMs);
  const s = half.summary();
  assert.ok(Math.abs(s.rate - 50) < 1, `약 50% (${s.rate})`);
  assert.ok(Math.abs(s.bestStreakMs - 5000) < 30, `최장 연속 약 5초 (${s.bestStreakMs})`);
  assert.equal(s.segments.length, 3);
  // 0~5 안, 5~10 밖 → 초반 50%, 10~15 안 15~20 밖 → 중반 50%, 20~25 안 25~30 밖 → 후반 50%
  for (const seg of s.segments) assert.ok(Math.abs(seg.rate - 50) < 1.5, `구간 ${seg.index} ${seg.rate}`);
});

test('클릭·마우스 버튼은 판정에 영향이 없음 (엔진에 발사 개념이 없음)', () => {
  const e = make('normal', 5);
  assert.equal(typeof e.shoot, 'undefined');
  const a = make('normal', 5);
  const b = make('normal', 5);
  playFollowing(a, 16);
  playFollowing(b, 16);
  assert.deepEqual(a.summary(), b.summary());
});

test('중도 종료: 실제 진행 시간으로 계산하고, 진행하지 않은 구간은 미진행(null)', () => {
  const e = make('hard', 8);
  playFollowing(e, 16, { until: 13500 });
  e.abort(13500);
  const s = e.summary();
  assert.equal(s.status, 'aborted');
  assert.equal(s.playedMs, 13500);
  assert.ok(s.rate > 99);
  assert.equal(s.segments[0].status, 'full');
  assert.equal(s.segments[1].status, 'partial');
  assert.equal(s.segments[1].playedMs, 3500);
  assert.equal(s.segments[2].status, 'unplayed');
  assert.equal(s.segments[2].rate, null, '0%가 아니라 미진행');
  // 시작 직후 중단: 전부 미진행, 성공률 측정 불가
  const z = make('easy', 1);
  z.start();
  z.abort(0);
  assert.equal(z.summary().rate, null);
  assert.ok(z.summary().segments.every((x) => x.status === 'unplayed'));
});

test('일시정지 시간 제외: 시계를 멈춘 동안은 적분하지 않음', () => {
  // 앱은 일시정지 동안 엔진 시각을 멈추므로, 엔진은 같은 시각으로 여러 번 호출돼도 시간을 더하지 않아야 함
  const e = make('easy', 2);
  e.start();
  const b = e.ballAt(5000);
  e.advance(5000);
  e.setCursor(5000, b.x, b.y);
  e.advance(5000);
  e.advance(5000);
  assert.equal(e.state.t, 5000);
  assert.equal(e.summary().insideMs, 0);
});

test('30초가 되면 정확히 종료되고 이후 시간은 더하지 않음', () => {
  const e = make('normal', 9);
  playFollowing(e, 16);
  e.advance(60000);
  assert.equal(e.summary().playedMs, TRACKING.durationMs);
  assert.ok(e.summary().insideMs <= TRACKING.durationMs);
});

test('배경 선택: 분석·랭크는 고정, 나머지는 무작위이며 직전 배경을 연속으로 고르지 않음', () => {
  assert.equal(pickBackground('analysis', 'dojo'), FIXED_BACKGROUND.analysis);
  assert.equal(pickBackground('rank', 'courtyard'), FIXED_BACKGROUND.rank);
  assert.equal(FIXED_BACKGROUND.rank, RANK.backgroundId);
  assert.ok(BACKGROUNDS[DEFAULT_BACKGROUND]);
  assert.ok(RANDOM_BACKGROUND_POOL.length >= 3);
  for (const mode of ['basic', 'moving', 'tracking']) {
    const seen = new Set();
    let last = null;
    for (let i = 0; i < 300; i++) {
      const id = pickBackground(mode, last);
      assert.notEqual(id, last, '직전 배경 연속 금지');
      assert.ok(RANDOM_BACKGROUND_POOL.includes(id));
      seen.add(id);
      last = id;
    }
    assert.equal(seen.size, RANDOM_BACKGROUND_POOL.length, '모든 배경이 고르게 선택됨');
  }
});
