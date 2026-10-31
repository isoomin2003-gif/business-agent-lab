// 이 브라우저의 플레이 기록 (정상 완료한 판만). 결과 화면에서 '같은 조건의 직전 기록'과 비교할 때만 씁니다.
// 각 기록에는 사용한 배경 ID가 함께 저장됩니다. 전체 사용자 순위는 서버(랭크 모드)에서만 다룹니다.
const KEY = 'aimTrainer.history.v1';
const MAX = 200;

function readAll() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {{mode, option, backgroundId, metrics}} rec */
export function saveRecord(rec) {
  const list = readAll();
  list.push({ ...rec, at: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* 저장 불가 환경 */ }
}

/** 같은 모드·옵션의 가장 최근 기록 (이번 판 저장 전에 조회) */
export function lastRecord(mode, option) {
  const list = readAll();
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].mode === mode && list[i].option === option) return list[i];
  }
  return null;
}
