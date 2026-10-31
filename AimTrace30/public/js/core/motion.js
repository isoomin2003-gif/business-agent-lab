// 움직이는 표적의 좌우 스트레이프(지그재그) 경로.
// 참고 영상처럼 짧은 간격(구간 길이 무작위)마다 방향을 바꾸고, 방향 전환은 순간이 아니라 짧게 감속→가속하며 부드럽게 이어집니다.
// 표적이 등장할 때 시드 난수로 노출 시간 전체의 경로를 1ms 단위로 미리 계산하므로
// 화면 그리기·명중 판정·분석이 모두 같은 위치를 사용하고, 같은 시드면 항상 같은 경로가 나옵니다.

/**
 * @param {() => number} rng 시드 난수
 * @param {number} x0 시작 x (머리 중심)
 * @param {number} dir 시작 방향 (+1 오른쪽, -1 왼쪽)
 * @param {object} o { speed(px/s), minX, maxX, durationMs, segMinMs, segMaxMs, turnMs, flipChance }
 */
export function buildStrafeTrack(rng, x0, dir, o) {
  const n = Math.ceil(o.durationMs) + 2;
  const xs = new Float64Array(n);
  const vs = new Float64Array(n);
  const accel = (2 * o.speed) / o.turnMs; // px/s 를 ms마다 바꾸는 양 (turnMs 동안 +speed → -speed)
  const nextSegment = () => o.segMinMs + rng() * (o.segMaxMs - o.segMinMs);
  let x = x0;
  let v = dir * o.speed;
  let want = dir;
  let changeAt = nextSegment();
  for (let i = 0; i < n; i++) {
    xs[i] = x;
    vs[i] = v;
    if (i >= changeAt) {
      if (rng() < o.flipChance) want = -want;
      changeAt = i + nextSegment();
    }
    // 벽 앞에서 멈출 수 있도록 미리 방향 전환 (정지 거리 = v² / 2a)
    const stopDist = (v * v) / (2 * accel * 1000) + 1;
    if (want > 0 && v > 0 && o.maxX - x <= stopDist) want = -1;
    if (want < 0 && v < 0 && x - o.minX <= stopDist) want = 1;
    const target = want * o.speed;
    v = v < target ? Math.min(target, v + accel) : Math.max(target, v - accel);
    x += v / 1000;
    if (x > o.maxX) { x = o.maxX; v = 0; want = -1; }
    if (x < o.minX) { x = o.minX; v = 0; want = 1; }
  }
  return { xs, vs };
}

/** 경로에서 등장 후 elapsedMs 시점의 위치와 이동 방향 (1ms 샘플 사이는 선형 보간) */
export function trackPose(track, elapsedMs, fallbackDir) {
  const last = track.xs.length - 1;
  const e = Math.min(Math.max(elapsedMs, 0), last);
  const i = Math.min(Math.floor(e), last - 1);
  const f = e - i;
  const x = track.xs[i] + (track.xs[i + 1] - track.xs[i]) * f;
  const v = track.vs[i] + (track.vs[i + 1] - track.vs[i]) * f;
  return { x, dir: v > 0 ? 1 : v < 0 ? -1 : fallbackDir };
}
