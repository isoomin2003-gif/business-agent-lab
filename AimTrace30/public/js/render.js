// 캔버스 그리기. 표적은 판정과 같은 TARGET_SHAPE 다각형/타원으로 그리고,
// 모든 장식(장갑·무릎 보호대·외곽 하이라이트)은 각 부위 모양으로 잘라낸(clip) 안쪽에만 그려
// 보이는 모양이 판정 영역을 벗어나지 않게 합니다.

// 분석 화면의 부위별 색 (분포도 점·범례)
// 색각 이상 시뮬레이션·대비 검증을 통과한 조합 (어두운 표면 기준). 표적 밖은 회색 + 마름모 모양으로 구분
export const COLORS = {
  head: '#d95926',
  body: '#3987e5',
  feet: '#199e70',
  miss: '#8d95a3',
  bg: '#0d121b',
  accent: '#42f5b0',
};

import { TARGET_SKIN } from './config.js';

// 표적 도색. 두 가지 모두 몸 전체 외곽에 형광 노랑 테두리(적 강조선)가 있습니다.
//  standard: 근접 참고 이미지 — 짙은 건메탈 회색 장갑, 밝은 가슴판, 은백색 해골형 머리
//  armored : 플레이 영상 화면 — 보라색 몸통, 형광 노랑 어깨·팔 장갑, 밝은 라벤더 머리
const SKINS = {
  standard: {
    headLight: '#f6f8f8', headEdge: '#a4acb2', headDetail: 'skull',
    bodyTop: '#4c5259', bodyBottom: '#2b2f34',
    chest: '#9ba3ab', chestGlow: 'rgba(220, 240, 255, 0.85)',
    shoulder: '#40454c', shoulderLine: '#717a83', bracer: '#596067',
    belt: '#1c1f23',
    leg: '#2b2f34', legPlate: '#4d535a', boot: '#17191c',
    rim: '#e4ff3a',
  },
  armored: {
    headLight: '#f7f2ff', headEdge: '#c3b1f2', headDetail: 'visor',
    bodyTop: '#4a36a0', bodyBottom: '#2a1f66',
    chest: '#17132e', chestGlow: null,
    shoulder: '#d9f23c', shoulderLine: '#8ea318', bracer: '#d9f23c',
    belt: '#17132e',
    leg: '#18161f', legPlate: '#2c2938', boot: '#0c0b10',
    rim: '#e4ff3a',
  },
};

function polyPath(ctx, polys, scale = 1) {
  ctx.beginPath();
  addPolys(ctx, polys, scale);
}
function addPolys(ctx, polys, scale = 1) {
  for (const poly of polys) {
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
    ctx.closePath();
  }
}
function headPath(ctx, head) {
  ctx.beginPath();
  ctx.ellipse(0, 0, head.rx, head.ry, 0, 0, Math.PI * 2);
}
/** 머리 + 몸통 + 다리 전체 모양 (판정 영역 전체와 같음) */
function wholePath(ctx, shape) {
  headPath(ctx, shape.head);
  addPolys(ctx, shape.body.polys);
  addPolys(ctx, shape.feet.polys);
}

/** 부위 모양으로 잘라낸 뒤 draw() 실행. 바깥으로는 아무것도 그려지지 않음 */
function clipped(ctx, pathFn, draw) {
  ctx.save();
  pathFn();
  ctx.clip();
  draw();
  ctx.restore();
}

export function setupCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * 사격장 봇 표적. (x, y) = 머리 중심.
 * flash: { part, k(0~1) } 피격 부위 안쪽 테두리 강조 (표적을 가리지 않음)
 * materialize: 0~1 등장 직후 청록색 빛의 세기 (표적 모양 안쪽에만 그려짐)
 * skin: 'standard' | 'armored' (config.js의 TARGET_SKIN)
 */
export function drawSilhouette(ctx, shape, x, y, { scale = 1, alpha = 1, flash = null, shadow = true, materialize = 0, skin = TARGET_SKIN } = {}) {
  const { head, body, feet } = shape;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  // 바닥 그림자 (발 아래 바닥 위. 판정과 무관한 배경 요소)
  if (shadow) {
    const g = ctx.createRadialGradient(0, 101, 1, 0, 101, 20);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 101, 20, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const P = SKINS[skin] || SKINS.standard;

  // 다리 + 발
  const legs = () => polyPath(ctx, feet.polys);
  clipped(ctx, legs, () => {
    ctx.fillStyle = P.leg;
    ctx.fillRect(-30, 40, 60, 70);
    ctx.fillStyle = P.legPlate;
    ctx.fillRect(-30, 52, 60, 10); // 허벅지 장갑
    ctx.fillRect(-30, 67, 60, 8); // 무릎 보호대
    ctx.fillRect(-30, 79, 60, 3); // 정강이 장갑 이음매
    ctx.fillStyle = P.boot;
    ctx.fillRect(-30, 88, 60, 14); // 부츠
  });

  // 몸통 + 양팔 (팔꿈치를 옆으로 벌리고 주먹을 가슴 앞에 모은 자세)
  const torso = () => polyPath(ctx, body.polys);
  clipped(ctx, torso, () => {
    const g = ctx.createLinearGradient(0, 10, 0, 45);
    g.addColorStop(0, P.bodyTop);
    g.addColorStop(1, P.bodyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(-25, 8, 50, 40);
    // 가슴판
    ctx.fillStyle = P.chest;
    ctx.beginPath();
    ctx.moveTo(-6, 12); ctx.lineTo(6, 12); ctx.lineTo(4, 30); ctx.lineTo(-4, 30);
    ctx.closePath();
    ctx.fill();
    if (P.chestGlow) {
      ctx.fillStyle = P.chestGlow;
      ctx.beginPath();
      ctx.ellipse(0, 18, 2.2, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of [-1, 1]) {
      // 어깨 장갑
      ctx.fillStyle = P.shoulder;
      ctx.beginPath();
      ctx.moveTo(s * 9, 9); ctx.lineTo(s * 22, 9); ctx.lineTo(s * 22, 27); ctx.lineTo(s * 13, 22); ctx.lineTo(s * 9, 15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = P.shoulderLine;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s * 14, 13); ctx.lineTo(s * 19, 22);
      ctx.stroke();
      // 가슴 앞으로 모은 팔뚝 보호대와 주먹
      ctx.fillStyle = P.bracer;
      ctx.beginPath();
      ctx.moveTo(s * 20, 26); ctx.lineTo(s * 18, 33); ctx.lineTo(s * 9, 34); ctx.lineTo(s * 10, 29);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = P.belt;
    ctx.fillRect(-12, 40, 24, 5);
  });

  // 머리
  const headFn = () => headPath(ctx, head);
  clipped(ctx, headFn, () => {
    const g = ctx.createRadialGradient(-1.5, -2.5, 0.5, 0, 0, head.ry);
    g.addColorStop(0, P.headLight);
    g.addColorStop(1, P.headEdge);
    ctx.fillStyle = g;
    ctx.fillRect(-head.rx, -head.ry, head.rx * 2, head.ry * 2);
    if (P.headDetail === 'skull') {
      // 해골형: 어두운 눈자리와 턱선
      ctx.fillStyle = 'rgba(45, 50, 56, 0.6)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * 2.6, 0.5, 1.5, 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(-2.5, 4.5, 5, 0.9);
    } else {
      ctx.fillStyle = 'rgba(92, 70, 170, 0.55)';
      ctx.fillRect(-head.rx, -0.5, head.rx * 2, 2.5);
    }
  });

  // 몸 전체 외곽의 형광 노랑 테두리 (clip 안쪽 절반만 보이므로 판정 영역 밖으로 나가지 않음)
  const all = () => wholePath(ctx, shape);
  clipped(ctx, all, () => {
    all();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = P.rim;
    ctx.stroke();
  });

  // 등장 직후 청록색 빛: 몸은 어두운 청록으로, 외곽은 밝은 청록으로 빛남
  if (materialize > 0) {
    clipped(ctx, all, () => {
      ctx.globalAlpha = alpha * Math.min(1, materialize);
      ctx.fillStyle = 'rgba(8, 72, 80, 0.8)';
      ctx.fillRect(-30, -10, 60, 115);
      headFn();
      ctx.fillStyle = 'rgba(205, 255, 255, 0.9)';
      ctx.fill();
      all();
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#5ff6ff';
      ctx.stroke();
    });
  }

  if (flash && flash.k > 0) {
    const pathFn = flash.part === 'body' ? torso : legs;
    clipped(ctx, pathFn, () => {
      ctx.globalAlpha = alpha * flash.k;
      pathFn();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });
  }
  ctx.restore();
}

/** 천장에 매달린 점수판. items: [{label, value}, {label, value}] */
export function drawScoreBoard(ctx, w, items) {
  const bw = 300;
  const bh = 66;
  const x = (w - bw) / 2;
  const y = 84;
  ctx.save();
  ctx.strokeStyle = '#1d1a17';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 40, 66); ctx.lineTo(x + 40, y);
  ctx.moveTo(x + bw - 40, 66); ctx.lineTo(x + bw - 40, y);
  ctx.stroke();
  ctx.fillStyle = 'rgba(18, 26, 36, 0.94)';
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = '#6fd6ff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, bw - 1.5, bh - 1.5);
  ctx.fillStyle = '#6fd6ff';
  ctx.fillRect(x - 3, y + 10, 3, bh - 20);
  ctx.fillRect(x + bw, y + 10, 3, bh - 20);
  items.forEach((it, i) => {
    const cx = x + (i === 0 ? 24 : bw - 24);
    ctx.textAlign = i === 0 ? 'left' : 'right';
    ctx.fillStyle = 'rgba(200, 225, 240, 0.7)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(it.label, cx, y + 20);
    ctx.fillStyle = '#e8f6ff';
    ctx.font = '700 32px ui-monospace, "SF Mono", Consolas, monospace';
    ctx.fillText(it.value, cx, y + 54);
  });
  ctx.restore();
}

/** 남은 노출 시간 막대 (발 아래 바닥, 표적을 가리지 않음) */
export function drawTimerBar(ctx, shape, x, y, frac) {
  const w = 34;
  const top = y + 107;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - w / 2, top, w, 3);
  ctx.fillStyle = frac > 0.3 ? COLORS.accent : '#ffb547';
  ctx.fillRect(x - w / 2, top, w * Math.max(0, Math.min(1, frac)), 3);
}

/** 머리 명중 제거 연출 데이터: 몸 모양 섬광 → 반투명 외곽선으로 흩어짐 + 약간의 불꽃 */
export function makeKillBurst(shape, x, y, now, fx) {
  const embers = [];
  for (let i = 0; i < fx.emberCount; i++) {
    embers.push({
      ox: (Math.random() - 0.5) * 20,
      oy: Math.random() * 50 - 4,
      vx: (Math.random() - 0.5) * 140,
      vy: -30 - Math.random() * 110,
      size: 1 + Math.random() * 1.4,
    });
  }
  const end = fx.killFlashMs + fx.killDissolveMs;
  return {
    kind: 'burst', layer: 'under', shape, x, y, t0: now,
    dur: Math.max(end, fx.emberMs), flashMs: fx.killFlashMs, dissolveMs: fx.killDissolveMs, embers,
  };
}

/** 머리 위 별 모양 불꽃 왕관 */
function drawCrown(ctx, head, alpha, grow) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (const deg of [-70, -42, -14, 14, 42, 70]) {
    const a = (deg * Math.PI) / 180;
    const len = (Math.abs(deg) < 30 ? 15 : 11) * (0.8 + 0.4 * grow);
    const bx = Math.sin(a) * (head.rx - 1);
    const by = -Math.cos(a) * (head.ry - 1);
    const tx = bx + Math.sin(a) * len;
    const ty = by - Math.cos(a) * len;
    const nx = Math.cos(a) * 1.8;
    const ny = Math.sin(a) * 1.8;
    const g = ctx.createLinearGradient(bx, by, tx, ty);
    g.addColorStop(0, '#fff8d8');
    g.addColorStop(1, 'rgba(255, 170, 50, 0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx - nx, by - ny); ctx.lineTo(tx, ty); ctx.lineTo(bx + nx, by + ny);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 연출 그리기. 'under' 효과(제거 섬광·불꽃·탄흔)는 표적 아래에, 'hit' 링은 표적 위에 작게 그려 표적을 가리지 않습니다.
 * 반환값: 아직 진행 중이면 true
 */
export function drawEffect(ctx, e, now) {
  const age = now - e.t0;
  const k = 1 - age / e.dur;
  if (k <= 0) return false;
  ctx.save();
  ctx.globalAlpha = k;
  if (e.kind === 'burst') {
    ctx.globalAlpha = 1;
    const sh = e.shape;
    if (age < e.flashMs + e.dissolveMs) {
      ctx.save();
      ctx.translate(e.x, e.y);
      if (age < e.flashMs) {
        // 1단계: 몸 전체가 불투명한 노랑·주황·흰색 섬광
        const g = ctx.createRadialGradient(0, 22, 2, 0, 40, 72);
        g.addColorStop(0, '#fffdf0');
        g.addColorStop(0.4, '#ffd84a');
        g.addColorStop(1, '#ff7a1a');
        ctx.fillStyle = g;
        wholePath(ctx, sh);
        ctx.fill();
        drawCrown(ctx, sh.head, 1, age / e.flashMs);
      } else {
        // 2단계: 반투명 주황 외곽선으로 흩어지며 사라짐
        const f = 1 - (age - e.flashMs) / e.dissolveMs;
        ctx.globalAlpha = 0.3 * f;
        ctx.fillStyle = '#ff9a3c';
        wholePath(ctx, sh);
        ctx.fill();
        ctx.globalAlpha = f;
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = '#ffb04a';
        ctx.stroke();
        drawCrown(ctx, sh.head, f, 1);
      }
      ctx.restore();
    }
    const t = age / 1000;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = '#ffa53a';
    for (const p of e.embers) {
      const px = e.x + p.ox + p.vx * t;
      const py = e.y + p.oy + p.vy * t + 0.5 * 520 * t * t;
      ctx.fillRect(px - p.size / 2, py - p.size / 2, p.size, p.size);
    }
  } else if (e.kind === 'vanish') {
    // 시간 초과로 사라질 때: 몸 전체가 불투명한 밝은 청록색으로 번쩍 (불꽃·잔해 없음)
    ctx.globalAlpha = 1;
    ctx.translate(e.x, e.y);
    const g = ctx.createLinearGradient(0, -8, 0, 100);
    g.addColorStop(0, '#a8fcff');
    g.addColorStop(0.3, '#3ff0ff');
    g.addColorStop(1, '#1ed6ec');
    ctx.fillStyle = g;
    wholePath(ctx, e.shape);
    ctx.fill();
    clipped(ctx, () => wholePath(ctx, e.shape), () => {
      wholePath(ctx, e.shape);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#c8ffff';
      ctx.stroke();
    });
  } else if (e.kind === 'hole') {
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.fillStyle = 'rgba(22, 18, 14, 0.9)';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 215, 190, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (e.kind === 'hit') {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2 + (1 - k) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return true;
}

/**
 * 분석 분포도: 머리 중심 기준으로 정렬한 클릭 위치를 표적 위에 표시.
 * points: [{dx, dy, part, first}]  그림 범위 밖 점은 가장자리에 네모로 표시
 */
export function drawDistribution(canvas, shape, points, { width = 440, height = 480, scale = 2.6, mirrorDir = false } = {}) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = 96; // 머리 중심 화면 위치
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, 0); ctx.lineTo(cx + 0.5, height);
  ctx.moveTo(0, cy + 0.5); ctx.lineTo(width, cy + 0.5);
  ctx.stroke();
  drawSilhouette(ctx, shape, cx, cy, { scale, alpha: 0.4, shadow: false });
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('머리 중심', cx + shape.head.rx * scale + 6, cy - 6);
  if (mirrorDir) {
    ctx.fillStyle = COLORS.accent;
    ctx.fillText('이동 방향 →', width - 84, 18);
  }

  const pad = 6;
  for (const p of points) {
    const dx = mirrorDir && p.moveDir ? p.dx * p.moveDir : p.dx;
    let x = cx + dx * scale;
    let y = cy + p.dy * scale;
    const out = x < pad || x > width - pad || y < pad || y > height - pad;
    x = Math.min(Math.max(x, pad), width - pad);
    y = Math.min(Math.max(y, pad), height - pad);
    const rad = p.first ? 5 : 4; // 표식 지름 8px 이상
    ctx.beginPath();
    if (out) {
      ctx.rect(x - rad, y - rad, rad * 2, rad * 2); // 그림 범위 밖: 가장자리의 속 빈 네모
    } else if (p.part === 'miss') {
      ctx.moveTo(x, y - rad - 1); ctx.lineTo(x + rad + 1, y); ctx.lineTo(x, y + rad + 1); ctx.lineTo(x - rad - 1, y); ctx.closePath(); // 표적 밖: 마름모
    } else {
      ctx.arc(x, y, rad, 0, Math.PI * 2);
    }
    if (!out) {
      ctx.fillStyle = COLORS[p.part];
      ctx.fill();
    }
    ctx.lineWidth = out ? 1.5 : 2;
    ctx.strokeStyle = out ? COLORS[p.part] : p.first ? '#ffffff' : COLORS.bg; // 겹친 점은 표면색 테두리로 구분, 첫 클릭은 흰 테두리
    ctx.stroke();
  }
}

/**
 * 트래킹 공. 크기는 항상 radius 그대로이며, 추적 성공 여부는 공 안쪽 테두리 색으로만 표시합니다.
 * (모든 장식은 공 반지름 안쪽에만 그려 보이는 크기와 판정 크기가 같음)
 */
export function drawBall(ctx, x, y, radius, tracking) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.1, 0, 0, radius);
  g.addColorStop(0, '#ffc2e2');
  g.addColorStop(0.45, '#ff4fa8');
  g.addColorStop(1, '#c8126a');
  ctx.fillStyle = g;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  // 어둡거나 밝은 배경 모두에서 경계가 보이도록 가장자리 안쪽에 얇은 어두운 선
  ctx.beginPath();
  ctx.arc(0, 0, radius - 0.75, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(20, 4, 14, 0.75)';
  ctx.stroke();
  // 추적 상태 테두리 (안쪽)
  ctx.beginPath();
  ctx.arc(0, 0, radius - 4, 0, Math.PI * 2);
  if (tracking) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#4dff8f';
  } else {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  }
  ctx.stroke();
  ctx.restore();
}
