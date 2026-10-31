// 결과 화면용 SVG 그래프. 막대 두께 24px 이하·끝 4px 둥글게·기준선은 직각, 2px 간격, 가는 격자선,
// 값 표시는 막대 끝(글자 색은 텍스트 색), 막대마다 마우스를 올리면 값 표시(<title>).
import { esc } from './ui.js';

const TEXT = '#e6ebf5';
const MUTED = '#8d97ab';
const GRID = '#273044';

function topRounded(x, y, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * 같은 축(0~100%)의 세로 막대그래프.
 * groups: [{ label, sub, values: [number|null] }]  null이면 막대 없이 '미진행' 표시
 * series: [{ name, color }]  2개 이상이면 범례 표시
 */
export function percentColumns({ groups, series, width = 560, height = 240, emptyLabel = '미진행' }) {
  const pad = { l: 44, r: 12, t: 22, b: 46 };
  const ih = height - pad.t - pad.b;
  const iw = width - pad.l - pad.r;
  const bw = Math.min(24, (iw / groups.length - 16) / series.length);
  const y = (v) => pad.t + ih * (1 - v / 100);
  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="구간별 비교 막대그래프">`;
  for (const v of [0, 25, 50, 75, 100]) {
    svg += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}" stroke-width="1"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" fill="${MUTED}" font-size="12" text-anchor="end">${v}%</text>`;
  }
  groups.forEach((g, gi) => {
    const cx = pad.l + (iw / groups.length) * (gi + 0.5);
    const total = series.length * bw + (series.length - 1) * 2;
    g.values.forEach((v, si) => {
      const x = cx - total / 2 + si * (bw + 2);
      if (v == null) return;
      const top = y(Math.max(0, Math.min(100, v)));
      svg += `<path d="${topRounded(x, top, bw, pad.t + ih - top, 4)}" fill="${series[si].color}"><title>${esc(`${g.label} · ${series[si].name}: ${v.toFixed(1)}%`)}</title></path>`;
      svg += `<text x="${x + bw / 2}" y="${top - 6}" fill="${TEXT}" font-size="12" font-weight="600" text-anchor="middle">${Math.round(v)}%</text>`;
    });
    if (g.values.every((v) => v == null)) {
      svg += `<text x="${cx}" y="${pad.t + ih - 10}" fill="${MUTED}" font-size="13" text-anchor="middle">${esc(emptyLabel)}</text>`;
    }
    svg += `<text x="${cx}" y="${height - pad.b + 18}" fill="${TEXT}" font-size="13" text-anchor="middle">${esc(g.label)}</text>`;
    if (g.sub) svg += `<text x="${cx}" y="${height - pad.b + 34}" fill="${MUTED}" font-size="11.5" text-anchor="middle">${esc(g.sub)}</text>`;
  });
  svg += '</svg>';
  const legend = series.length > 1
    ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`
    : '';
  return svg + legend;
}

/**
 * 100% 가로 누적 막대 (부위별 비율). parts: [{ name, value(횟수), color }]
 * 칸 사이 2px 간격, 칸 안 글자는 충분히 넓을 때만.
 */
export function stackedShare(parts, { width = 560, height = 28 } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return '<p class="muted">발사 기록이 없어 비율을 표시할 수 없습니다.</p>';
  const visible = parts.filter((p) => p.value > 0);
  const gaps = (visible.length - 1) * 2;
  let x = 0;
  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="부위별 클릭 비율">`;
  visible.forEach((p, i) => {
    const w = ((width - gaps) * p.value) / total;
    const pct = (p.value / total) * 100;
    const r = 4;
    const first = i === 0;
    const last = i === visible.length - 1;
    const d = `M${x + (first ? r : 0)},0H${x + w - (last ? r : 0)}${last ? `Q${x + w},0 ${x + w},${r}V${height - r}Q${x + w},${height} ${x + w - r},${height}` : `V${height}`}H${x + (first ? r : 0)}${first ? `Q${x},${height} ${x},${height - r}V${r}Q${x},0 ${x + r},0` : `V0`}Z`;
    svg += `<path d="${d}" fill="${p.color}"><title>${esc(`${p.name}: ${p.value}회 (${pct.toFixed(1)}%)`)}</title></path>`;
    const label = `${p.name} ${Math.round(pct)}%`;
    if (w > label.length * 7.5 + 12) svg += `<text x="${x + w / 2}" y="${height / 2 + 4.5}" fill="#ffffff" font-size="12.5" font-weight="600" text-anchor="middle">${esc(label)}</text>`;
    x += w + 2;
  });
  svg += '</svg>';
  return svg + `<div class="legend">${parts.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.name)} ${p.value}회</span>`).join('')}</div>`;
}
