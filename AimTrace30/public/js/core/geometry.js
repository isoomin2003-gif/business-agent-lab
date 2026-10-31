// 표적의 판정 형상. 화면 그리기와 명중 판정이 같은 다각형/타원을 사용합니다.

/** 머리 중심 기준 표적의 외곽 경계 */
export function shapeBounds(shape) {
  let minX = -shape.head.rx;
  let maxX = shape.head.rx;
  let maxY = shape.head.ry;
  for (const poly of [...shape.body.polys, ...shape.feet.polys]) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY: -shape.head.ry, maxY };
}

/** 점이 다각형 내부인지 (짝수-홀수 규칙, 캔버스 fill의 'evenodd'와 같은 결과) */
export function inPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inHead(dx, dy, head) {
  const nx = dx / head.rx;
  const ny = dy / head.ry;
  return nx * nx + ny * ny <= 1;
}

/**
 * 머리 중심 기준 상대 좌표(dx, dy)가 어느 부위인지 판정합니다.
 * 머리 → 몸통 → 발 순서로 검사하며, 어디에도 속하지 않으면 'miss'.
 */
export function classifyHit(dx, dy, shape) {
  if (inHead(dx, dy, shape.head)) return 'head';
  if (shape.body.polys.some((p) => inPolygon(dx, dy, p))) return 'body';
  if (shape.feet.polys.some((p) => inPolygon(dx, dy, p))) return 'feet';
  return 'miss';
}

/**
 * 표적의 머리 중심이 놓일 수 있는 범위.
 * 좌우는 표적 전체가 게임 영역 안에 있도록, 위아래는 발끝이 바닥 영역(floor) 위에 오도록 정합니다.
 */
export function headRange(arena, shape, floor) {
  const b = shapeBounds(shape);
  const minY = arena.margin - b.minY;
  const maxY = arena.height - arena.margin - b.maxY;
  return {
    minX: arena.margin - b.minX,
    maxX: arena.width - arena.margin - b.maxX,
    minY: floor ? Math.max(minY, floor.feetMinY - b.maxY) : minY,
    maxY: floor ? Math.min(maxY, floor.feetMaxY - b.maxY) : maxY,
  };
}
