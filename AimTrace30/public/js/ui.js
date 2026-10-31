// 화면 공통 유틸
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtSec = (ms) => (ms == null ? '측정 불가' : `${(ms / 1000).toFixed(2)}초`);
export const fmtPct = (v) => (v == null ? '측정 불가' : `${v.toFixed(1)}%`);
export const fmtDate = (ms) => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
