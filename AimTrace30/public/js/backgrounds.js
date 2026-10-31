// 게임 배경. 배경은 화면 표시 전용이며 표적 크기·이동 속도·판정 영역·등장 범위·노출 시간에는 영향을 주지 않습니다.
// 모든 배경은 바닥 지평선을 FLOOR.horizonY에 맞춰 그려 표적이 같은 위치의 바닥 위에 서도록 합니다.
import { ARENA, FLOOR, DEFAULT_BACKGROUND, FIXED_BACKGROUND } from './config.js';

function paintRange(ctx, w, h, floor) {
  const H = floor.horizonY;
  // 벽
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#3e352b');
  wall.addColorStop(0.35, '#64584a');
  wall.addColorStop(1, '#5a4f42');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, H);

  // 창문 (아치형, 어두운 유리)
  const windows = [[48, 150], [118, 150], [600, 132], [640, 132]];
  for (const [wx, wy] of windows) {
    ctx.fillStyle = '#4d4336';
    ctx.beginPath();
    ctx.moveTo(wx - 4, wy + 78); ctx.lineTo(wx - 4, wy + 16); ctx.arc(wx + 15, wy + 16, 19, Math.PI, 0); ctx.lineTo(wx + 34, wy + 78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b3240';
    ctx.beginPath();
    ctx.moveTo(wx, wy + 74); ctx.lineTo(wx, wy + 16); ctx.arc(wx + 15, wy + 16, 15, Math.PI, 0); ctx.lineTo(wx + 30, wy + 74);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4d4336';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx + 15, wy + 2); ctx.lineTo(wx + 15, wy + 74);
    ctx.moveTo(wx, wy + 40); ctx.lineTo(wx + 30, wy + 40);
    ctx.stroke();
  }
  // 판자로 덧댄 벽면
  for (const [bx, by, bw, bh] of [[392, 168, 70, 64], [770, 160, 96, 58]]) {
    ctx.fillStyle = '#7b6a52';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(40,30,20,0.35)';
    ctx.lineWidth = 1;
    for (let yy = by + 9; yy < by + bh; yy += 9) { ctx.beginPath(); ctx.moveTo(bx, yy + 0.5); ctx.lineTo(bx + bw, yy + 0.5); ctx.stroke(); }
    ctx.fillStyle = '#4f3f2c';
    ctx.fillRect(bx - 6, by - 6, bw + 12, 6);
  }
  // 나무 기둥
  for (const px of [300, 500, 740, 960]) {
    ctx.fillStyle = '#4e3b28';
    ctx.fillRect(px - 11, 70, 22, H - 70);
    ctx.fillStyle = 'rgba(255,220,170,0.08)';
    ctx.fillRect(px - 11, 70, 5, H - 70);
    ctx.fillStyle = '#3a3027';
    ctx.fillRect(px - 15, H - 26, 30, 26);
  }
  // 왼쪽 벽 아래 나무 상자 더미
  for (const [cx, cy, cs] of [[14, 262, 54], [70, 272, 44], [118, 262, 54], [40, 218, 44], [190, 284, 34]]) {
    ctx.fillStyle = '#6b5539';
    ctx.fillRect(cx, cy, cs, cs);
    ctx.strokeStyle = '#4a3a27';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx + 1.5, cy + 1.5, cs - 3, cs - 3);
    ctx.beginPath(); ctx.moveTo(cx + 3, cy + 3); ctx.lineTo(cx + cs - 3, cy + cs - 3); ctx.stroke();
  }
  // 천장 트러스
  ctx.fillStyle = '#2c241c';
  ctx.fillRect(0, 0, w, 58);
  ctx.strokeStyle = '#5a4430';
  ctx.lineCap = 'butt';
  ctx.lineWidth = 9;
  ctx.beginPath();
  for (let x = -160; x < w + 160; x += 260) {
    ctx.moveTo(x, 0); ctx.lineTo(x + 130, 64);
    ctx.moveTo(x + 260, 0); ctx.lineTo(x + 130, 64);
  }
  ctx.stroke();
  ctx.fillStyle = '#5f4832';
  ctx.fillRect(0, 58, w, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 72, w, 6);
  // 걸레받이
  ctx.fillStyle = '#3d342a';
  ctx.fillRect(0, H - 6, w, 8);

  // 바닥
  const fl = ctx.createLinearGradient(0, H, 0, h);
  fl.addColorStop(0, '#5f564a');
  fl.addColorStop(1, '#7e735f');
  ctx.fillStyle = fl;
  ctx.fillRect(0, H + 2, w, h - H - 2);
  // 원근 이음매
  ctx.strokeStyle = 'rgba(30,24,18,0.16)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 9; i++) {
    const yy = H + (h - H) * (i / 9) ** 1.6;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
  }
  // 레인 선 (소실점으로 모임)
  const vx = w / 2;
  const vy = H - 120;
  ctx.strokeStyle = 'rgba(176, 118, 58, 0.75)';
  for (const bx of [-260, 250, 790, 1300]) {
    const t = (H + 2 - vy) / (h - vy);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(vx + (bx - vx) * t, H + 2);
    ctx.lineTo(bx, h);
    ctx.stroke();
  }
  // 가장자리 어둡게
  const vg = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, w * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// 결정적 의사 난수 (배경 장식 배치가 매번 같도록)
function decoRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 원근 바닥 타일: 소실점으로 모이는 세로선 + 멀수록 촘촘한 가로선 */
function perspectiveTiles(ctx, w, h, H, color, cols = 12, rows = 9) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const vx = w / 2;
  const vy = H - 160;
  for (let i = -cols; i <= cols; i++) {
    const bx = vx + i * (w / cols) * 1.1;
    const t = (H - vy) / (h - vy);
    ctx.beginPath();
    ctx.moveTo(vx + (bx - vx) * t, H);
    ctx.lineTo(bx, h);
    ctx.stroke();
  }
  for (let i = 1; i < rows; i++) {
    const yy = H + (h - H) * (i / rows) ** 1.7;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
  }
}

function vignette(ctx, w, h, strength) {
  const vg = ctx.createRadialGradient(w / 2, h * 0.58, h * 0.28, w / 2, h * 0.58, w * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/**
 * 등불 도장: 따뜻한 나무 실내, 천장 들보에 매달린 붉은 등, 안쪽의 단상과 붉은 줄, 바닥에 비치는 빛.
 * (첨부 이미지 ‘등불 도장’의 공간 구성·분위기를 참고해 새로 그림. 원본 이미지는 사용하지 않음)
 */
function paintDojo(ctx, w, h, floor) {
  const H = floor.horizonY;
  const r = decoRng(11);
  // 안쪽 벽 (어두운 나무)
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#1c120c');
  wall.addColorStop(0.5, '#3a2416');
  wall.addColorStop(1, '#4a2e1a');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, H);
  // 안쪽 단상과 붉은 줄 (가운데 뒤)
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(300, 196, 440, 122);
  ctx.fillStyle = '#5a3820';
  ctx.fillRect(290, 292, 460, 26);
  ctx.strokeStyle = 'rgba(200, 50, 40, 0.75)';
  ctx.lineWidth = 3;
  for (const yy of [232, 252, 272]) { ctx.beginPath(); ctx.moveTo(320, yy); ctx.lineTo(720, yy); ctx.stroke(); }
  ctx.fillStyle = '#9b2a20';
  for (const px of [318, 518, 718]) ctx.fillRect(px - 4, 220, 8, 72);
  // 현판 (자체 문양)
  ctx.fillStyle = '#2b1b10';
  ctx.fillRect(440, 120, 160, 50);
  ctx.strokeStyle = '#b8873c';
  ctx.lineWidth = 2;
  ctx.strokeRect(444, 124, 152, 42);
  ctx.beginPath(); ctx.arc(520, 145, 13, 0, Math.PI * 2); ctx.moveTo(500, 145); ctx.lineTo(540, 145); ctx.moveTo(520, 125); ctx.lineTo(520, 165); ctx.stroke();
  // 좌우 나무 기둥과 격자 창
  for (const [px, pw] of [[0, 70], [230, 34], [776, 34], [970, 70]]) {
    ctx.fillStyle = '#2c1a0e';
    ctx.fillRect(px, 40, pw, H - 40);
    ctx.fillStyle = 'rgba(255, 190, 120, 0.06)';
    ctx.fillRect(px + pw - 6, 40, 6, H - 40);
  }
  ctx.strokeStyle = 'rgba(255, 196, 120, 0.25)';
  ctx.lineWidth = 2;
  for (const [gx, gy] of [[100, 150], [850, 150]]) {
    ctx.fillStyle = 'rgba(255, 180, 100, 0.12)';
    ctx.fillRect(gx, gy, 90, 110);
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(gx + i * 22.5, gy); ctx.lineTo(gx + i * 22.5, gy + 110); ctx.stroke(); }
    for (let i = 0; i <= 5; i++) { ctx.beginPath(); ctx.moveTo(gx, gy + i * 22); ctx.lineTo(gx + 90, gy + i * 22); ctx.stroke(); }
  }
  // 세로 현수막
  for (const bx of [196, 812]) {
    ctx.fillStyle = '#efe2c4';
    ctx.globalAlpha = 0.55;
    ctx.fillRect(bx, 70, 22, 150);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(60, 30, 20, 0.6)';
    for (let i = 0; i < 5; i++) ctx.fillRect(bx + 7, 84 + i * 26, 8, 12);
  }
  // 천장 들보
  ctx.fillStyle = '#150d08';
  ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(0, 34, w, 14);
  ctx.fillRect(0, 90, w, 8);
  // 붉은 등 (빛 번짐 + 몸체 + 끈)
  const lanterns = [[60, 70], [170, 110], [300, 64], [410, 96], [640, 96], [750, 64], [880, 110], [985, 70]];
  for (const [lx, ly] of lanterns) {
    const glow = ctx.createRadialGradient(lx, ly, 4, lx, ly, 70);
    glow.addColorStop(0, 'rgba(255, 120, 60, 0.35)');
    glow.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(lx - 70, ly - 70, 140, 140);
    ctx.strokeStyle = '#1a0f08';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx, 48); ctx.lineTo(lx, ly - 20); ctx.stroke();
    const body = ctx.createLinearGradient(lx - 16, 0, lx + 16, 0);
    body.addColorStop(0, '#7a1c14');
    body.addColorStop(0.5, '#d8402a');
    body.addColorStop(1, '#7a1c14');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(lx, ly, 16, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a140c';
    ctx.fillRect(lx - 9, ly - 23, 18, 5);
    ctx.fillRect(lx - 9, ly + 18, 18, 5);
    ctx.strokeStyle = 'rgba(40, 10, 5, 0.5)';
    ctx.lineWidth = 1;
    for (const k of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.ellipse(lx, ly, 16 * Math.abs(k || 0.001), 21, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
  }
  // 걸레받이
  ctx.fillStyle = '#1e130b';
  ctx.fillRect(0, H - 6, w, 8);
  // 바닥: 따뜻한 석재 타일
  const fl = ctx.createLinearGradient(0, H, 0, h);
  fl.addColorStop(0, '#4a3324');
  fl.addColorStop(1, '#6e4d33');
  ctx.fillStyle = fl;
  ctx.fillRect(0, H + 2, w, h - H - 2);
  perspectiveTiles(ctx, w, h, H + 2, 'rgba(20, 10, 4, 0.35)', 10, 8);
  // 창으로 들어온 빛이 바닥에 비친 자국 (낮은 밝기)
  ctx.fillStyle = 'rgba(255, 196, 120, 0.10)';
  for (let i = 0; i < 5; i++) {
    const x0 = 80 + i * 200 + r() * 40;
    ctx.beginPath();
    ctx.moveTo(x0, 360); ctx.lineTo(x0 + 120, 360); ctx.lineTo(x0 + 170, 560); ctx.lineTo(x0 + 20, 560);
    ctx.closePath();
    ctx.fill();
  }
  vignette(ctx, w, h, 0.5);
}

/**
 * 산사 마당: 파란 하늘과 구름, 겹겹이 산, 정자, 바위와 나무, 붉은 난간, 나무 그림자가 진 밝은 돌바닥.
 * (첨부 이미지 ‘산사 마당’의 공간 구성·분위기를 참고해 새로 그림. 원본 이미지는 사용하지 않음)
 */
function paintCourtyard(ctx, w, h, floor) {
  const H = floor.horizonY;
  const r = decoRng(12);
  // 하늘
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#16305a');
  sky.addColorStop(0.6, '#3d6a9c');
  sky.addColorStop(1, '#6f94b8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, H);
  // 구름
  ctx.fillStyle = 'rgba(235, 240, 250, 0.55)';
  for (const [cx, cy, s] of [[640, 70, 1.2], [780, 110, 0.9], [300, 60, 0.8], [880, 50, 0.7]]) {
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + (i - 2.5) * 26 * s, cy + Math.sin(i * 1.7) * 8 * s, 30 * s, 20 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 먼 산 → 가까운 산
  const ridge = (base, amp, color, seed) => {
    const rr = decoRng(seed);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= w; x += 40) ctx.lineTo(x, base - amp * (0.4 + 0.6 * Math.abs(Math.sin(x / 170 + rr() * 0.6))));
    ctx.lineTo(w, H);
    ctx.closePath();
    ctx.fill();
  };
  ridge(230, 90, '#5c7c99', 3);
  ridge(262, 70, '#3f5f70', 4);
  // 정자 (가운데 먼 곳)
  ctx.fillStyle = '#3a2a24';
  ctx.beginPath(); ctx.moveTo(560, 210); ctx.lineTo(610, 210); ctx.lineTo(585, 192); ctx.closePath(); ctx.fill();
  ctx.fillRect(568, 210, 4, 22); ctx.fillRect(598, 210, 4, 22);
  // 바위와 수풀
  ctx.fillStyle = '#5d6662';
  ctx.beginPath(); ctx.ellipse(470, 292, 220, 34, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#8f9894';
  ctx.beginPath(); ctx.ellipse(430, 284, 120, 18, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#2f4a38';
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    ctx.ellipse(180 + i * 55 + r() * 20, 286 - r() * 14, 34, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(170, 100, 160, 0.55)';
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(150 + i * 26, 274 + r() * 8, 12, 8, 0, 0, Math.PI * 2); ctx.fill(); }
  // 양옆 큰 나무
  for (const [tx, flip] of [[0, 1], [w, -1]]) {
    ctx.fillStyle = '#142419';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.ellipse(tx + flip * (30 + r() * 90), 40 + i * 30, 70, 46, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#20140e';
    ctx.fillRect(tx + flip * 40 - 9, 120, 18, H - 120);
  }
  // 붉은 난간 (지평선)
  ctx.fillStyle = '#6a3424';
  ctx.fillRect(0, H - 28, w, 6);
  ctx.fillRect(0, H - 12, w, 6);
  for (let x = 12; x < w; x += 52) {
    ctx.fillStyle = '#7d3c28';
    ctx.fillRect(x, H - 36, 9, 36);
    ctx.fillStyle = '#a8563a';
    ctx.fillRect(x, H - 36, 9, 4);
  }
  // 바닥: 밝은 돌판 (밝기를 낮춤)
  const fl = ctx.createLinearGradient(0, H, 0, h);
  fl.addColorStop(0, '#7f7a70');
  fl.addColorStop(1, '#a29a8b');
  ctx.fillStyle = fl;
  ctx.fillRect(0, H, w, h - H);
  perspectiveTiles(ctx, w, h, H, 'rgba(60, 50, 40, 0.28)', 6, 5);
  // 나무 그림자
  ctx.fillStyle = 'rgba(30, 35, 45, 0.28)';
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side > 0 ? w - r() * 260 : r() * 260;
    ctx.beginPath();
    ctx.ellipse(x, H + 30 + r() * 240, 40 + r() * 50, 12 + r() * 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 밝은 바닥에서도 표적·공이 잘 보이도록 전체를 한 단계 어둡게
  ctx.fillStyle = 'rgba(8, 12, 22, 0.30)';
  ctx.fillRect(0, 0, w, h);
  vignette(ctx, w, h, 0.45);
}

/** 이미지 배경: 비율을 유지한 채 영역을 덮고(cover), 밝기를 낮추는 오버레이를 덧씌움 */
function paintImage(ctx, w, h, img, def) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  const fx = def.focusX ?? 0.5;
  const fy = def.focusY ?? 0.6;
  ctx.drawImage(img, (w - dw) * fx, (h - dh) * fy, dw, dh);
  ctx.fillStyle = `rgba(6, 8, 14, ${def.dim ?? 0.45})`;
  ctx.fillRect(0, 0, w, h);
  vignette(ctx, w, h, 0.45);
}

export const BACKGROUNDS = Object.freeze({
  range: { id: 'range', label: '창고 사격장', kind: 'painted', paint: paintRange, credit: '자체 제작 (캔버스 그리기)' },
  dojo: { id: 'dojo', label: '등불 도장', kind: 'painted', paint: paintDojo, credit: '자체 제작 — 사용자 첨부 이미지의 분위기·구성만 참고' },
  courtyard: { id: 'courtyard', label: '산사 마당', kind: 'painted', paint: paintCourtyard, credit: '자체 제작 — 사용자 첨부 이미지의 분위기·구성만 참고' },
  // 사용 권리가 확인된 이미지를 배경으로 쓰려면 public/backgrounds/ 에 파일을 두고 아래처럼 추가합니다.
  // photo1: { id: 'photo1', label: '이름', kind: 'image', src: 'backgrounds/photo1.jpg', focusY: 0.7, dim: 0.45, credit: '출처 · 라이선스' },
});

/** 기본·움직임·트래킹 모드가 무작위로 고르는 배경 목록 */
export const RANDOM_BACKGROUND_POOL = Object.freeze(Object.keys(BACKGROUNDS));

/**
 * 이번 판에 쓸 배경 ID.
 * 분석·랭크는 고정 배경, 나머지는 무작위(가능하면 직전 배경 제외).
 */
export function pickBackground(mode, lastId, rnd = Math.random) {
  if (FIXED_BACKGROUND[mode]) return FIXED_BACKGROUND[mode];
  const pool = RANDOM_BACKGROUND_POOL.filter((id) => id !== lastId);
  const list = pool.length ? pool : RANDOM_BACKGROUND_POOL;
  return list[Math.floor(rnd() * list.length) % list.length];
}

const prepared = new Map();

function makeCanvas(w, h) {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, ctx, dpr };
}

function loadImage(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('load error')); };
    img.src = src;
  });
}

/**
 * 배경을 미리 그려 둡니다(카운트다운 전에 호출). 실패하면 기본 배경으로 대체합니다.
 * @param {string|object} idOrDef 배경 ID 또는 배경 정의
 * @returns {Promise<{ id, label, canvas, fallback: boolean, requestedId }>}
 */
export async function prepareBackground(idOrDef, { timeoutMs = 4000 } = {}) {
  const def = typeof idOrDef === 'string' ? BACKGROUNDS[idOrDef] : idOrDef;
  const { width: w, height: h } = ARENA;
  const dpr = window.devicePixelRatio || 1;
  const key = def ? `${def.id}@${dpr}` : null;
  if (key && prepared.has(key)) return prepared.get(key);
  try {
    if (!def) throw new Error('unknown background');
    const { c, ctx } = makeCanvas(w, h);
    if (def.kind === 'image') {
      const img = await loadImage(def.src, timeoutMs);
      paintImage(ctx, w, h, img, def);
    } else {
      def.paint(ctx, w, h, FLOOR);
    }
    const out = { id: def.id, label: def.label, canvas: c, fallback: false, requestedId: def.id };
    prepared.set(key, out);
    return out;
  } catch {
    const base = await prepareBackground(DEFAULT_BACKGROUND);
    return { ...base, fallback: true, requestedId: def?.id ?? String(idOrDef) };
  }
}

export function drawPreparedBackground(ctx, bg) {
  ctx.drawImage(bg.canvas, 0, 0, ARENA.width, ARENA.height);
}

export function backgroundLabel(id) {
  return BACKGROUNDS[id]?.label ?? id;
}
