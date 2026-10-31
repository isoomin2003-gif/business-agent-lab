// 게임 전체 설정. 노출 시간·이동 속도·표적 크기·등장 간격·표적 수·랭크 목표 점수는 모두 여기서만 수정합니다.
// 이 파일은 브라우저와 서버(랭크 검증)가 함께 사용합니다.

export const ARENA = Object.freeze({
  width: 1040, // 게임 영역 가로(CSS px). 랭크 비교 조건 고정을 위해 화면 크기와 무관하게 고정
  height: 600,
  margin: 12, // 표적이 경계에서 떨어져야 하는 최소 거리
});

// 표적 형상. 모든 좌표는 '머리 중심'을 원점(0,0)으로 한 상대 좌표이며 y는 아래쪽이 +.
// 참고 화면의 사격장 봇처럼: 작은 타원형 머리, 어깨 장갑이 있는 넓은 어깨, 가슴 앞으로 팔을 든 자세,
// 가는 허리, 몸 길이의 절반 이상인 긴 다리를 벌리고 선 모습.
// 팔은 몸통 영역, 다리는 발 영역에 포함됩니다. 화면 그리기와 명중 판정이 이 다각형/타원을 그대로 함께 사용하므로
// 보이는 모양과 판정 영역이 항상 일치합니다. (장식은 각 부위 안쪽에만 그려짐)
// 오른쪽 절반 외곽선을 좌우 대칭으로 이어 하나의 다각형으로 만듭니다.
function mirrored(rightHalf) {
  const left = rightHalf.slice().reverse().map(([x, y]) => [-x, y]);
  return Object.freeze([...rightHalf, ...left].map((p) => Object.freeze(p)));
}
const LEG_RIGHT = [
  [1.5, 45], [11, 45], [12.5, 58], [13.5, 72], [14, 86], [15.5, 94], [17, 100],
  [6, 100], [5.5, 94], [4.5, 82], [3.5, 70], [2, 57],
];
export const TARGET_SHAPE = Object.freeze({
  height: 108, // 머리 꼭대기(-8)부터 발끝(100)까지. 참고 화면처럼 게임 영역 높이의 약 18%
  head: Object.freeze({ rx: 7, ry: 8 }), // 타원 (목 틈 y 8~10은 표적 밖)
  body: Object.freeze({ // 어깨·몸통·양팔 (y 10~45)
    polys: Object.freeze([mirrored([
      [0, 10], [7, 10], [13, 11], [17.5, 13], [19.5, 18], [19, 25], [17, 31],
      [10, 33.5], [8, 36], [10.5, 41], [11, 45], [0, 45],
    ])]),
  }),
  feet: Object.freeze({ // 다리 + 발 (y 45~100). 다리 사이 틈은 표적 밖
    polys: Object.freeze([
      Object.freeze(LEG_RIGHT.map((p) => Object.freeze(p))),
      Object.freeze(LEG_RIGHT.slice().reverse().map(([x, y]) => Object.freeze([-x, y]))),
    ]),
  }),
});

// 표적이 서는 바닥 영역: 참고 화면처럼 표적은 항상 사격장 바닥 위에 서 있습니다. (발끝 y 범위)
export const FLOOR = Object.freeze({
  horizonY: 318, // 벽과 바닥이 만나는 선
  feetMinY: 350,
  feetMaxY: 588,
});

// 표적 도색: 'standard'(회색 장갑 + 노랑 외곽선, 근접 참고 이미지) | 'armored'(보라 몸통 + 노랑 어깨 장갑, 플레이 영상)
// 도색은 화면 표시 전용이며 판정 영역은 같습니다.
export const TARGET_SKIN = 'standard';

// 등장·제거 연출 (화면 표시 전용. 판정·노출 시간·랭크 검증과 무관)
// 참고 영상 60fps 프레임에서 잰 시간에 맞춤
export const VISUAL_FX = Object.freeze({
  spawnShimmerMs: 70, // 등장 후 짧게 청록색으로 빛남 (약 35ms에 가장 밝고 70ms에 원래 색)
  killFlashMs: 110, // 머리 명중: 몸 모양 그대로 불투명한 노랑·주황 섬광 + 머리 위 불꽃 왕관
  killDissolveMs: 60, // 이어서 반투명 주황 외곽선으로 흩어짐 (총 0.17초, 다음 표적 등장 0.5초 전에 끝남)
  emberMs: 260, // 제거된 자리에 잠깐 흩어지는 불꽃
  emberCount: 6,
  timeoutFlashMs: 40, // 시간 초과: 판정상 사라진 순간 몸 전체가 밝은 청록색으로 한 번 번쩍인 뒤 없어짐
  bulletHoleMs: 900, // 빗나간 발사 자리의 탄흔
});

// 배경 (화면 표시 전용, 목록은 backgrounds.js). 기본·움직임·트래킹은 무작위, 분석·랭크는 기록 비교를 위해 고정
export const DEFAULT_BACKGROUND = 'range'; // 로딩 실패 시 대체 배경
export const FIXED_BACKGROUND = Object.freeze({ analysis: 'range', rank: 'range' });

export const SPAWN_GAP_MS = 500; // 표적이 사라진 뒤 다음 표적이 나오기까지의 고정 간격
export const COUNTDOWN_SECONDS = 3; // 시작 전 3·2·1 (기록에서 제외)
export const MIN_SPAWN_DISTANCE = 160; // 직전 표적과의 최소 거리(px) — 같은 자리에 연속 등장 방지
// 움직임 모드·분석 이동형 표적의 좌우 이동 속도(px/s). 모든 난이도 동일. (트래킹 공 속도는 TRACKING에서 따로 관리)
// 플레이 후 조정할 때는 MOVE_SPEED_BASE 또는 MOVE_SPEED_SCALE만 바꾸면 됩니다.
export const MOVE_SPEED_BASE = 240; // 이전 기준 속도
export const MOVE_SPEED_SCALE = 0.7; // 직접 플레이 후 따라가기 어려워 70%로 낮춤
export const MOVE_SPEED = MOVE_SPEED_BASE * MOVE_SPEED_SCALE; // = 168px/s
// 움직임 패턴: 참고 영상의 스트레이프처럼 짧은 간격마다 좌우 방향을 바꾸는 지그재그 (모든 난이도 동일)
export const MOVE_PATTERN = Object.freeze({
  segMinMs: 250, // 한 방향으로 움직이는 구간 길이 (이 범위에서 무작위)
  segMaxMs: 550,
  flipChance: 0.8, // 구간이 끝날 때 방향을 바꿀 확률 (나머지는 같은 방향 유지 → 예측하기 어렵게)
  turnMs: 120, // 방향 전환에 걸리는 시간: +속도에서 -속도까지 부드럽게 감속·가속
});

// 트래킹 모드: 공 하나를 30초 동안 따라가기. 공 크기는 난이도 간 동일하고, 속도·방향 전환 조건으로만 난이도를 나눕니다.
// (움직임 모드의 MOVE_SPEED와는 별개)
export const TRACKING = Object.freeze({
  durationMs: 30000, // 공이 움직이기 시작한 순간부터 30초 (일시정지 시간 제외)
  segmentMs: 10000, // 초반·중반·후반 각 10초
  ballRadius: 22, // 모든 난이도 동일. 추적 성공 여부와 관계없이 크기 고정
  // 공 중심이 움직일 수 있는 범위: 공 전체가 화면 안에 있고 천장 점수판(y 84~150)에 가려지지 않도록
  area: Object.freeze({ x0: 40, x1: 1000, y0: 186, y1: 572 }),
  difficulties: Object.freeze({
    easy: Object.freeze({ // 느린 좌우 이동
      pattern: 'horizontal', speed: 150, segMinMs: 1800, segMaxMs: 3200, flipChance: 0.5, turnMs: 450,
    }),
    normal: Object.freeze({ // 중간 속도의 상하좌우 이동, 완만한 방향 전환
      pattern: 'free', speed: 230, maxTurnDegPerSec: 80, turnAccelDegPerSec2: 160,
      changeMinMs: 1000, changeMaxMs: 2000, wallMargin: 90,
    }),
    hard: Object.freeze({ // 빠른 이동, 더 잦고 급한 방향 전환
      pattern: 'free', speed: 340, maxTurnDegPerSec: 230, turnAccelDegPerSec2: 1100,
      changeMinMs: 300, changeMaxMs: 750, wallMargin: 90,
    }),
  }),
});

// 표적 수(처리 기준)와 랭크 목표 점수는 서로 다른 설정입니다.
export const TARGETS_PER_GAME = 30; // 기본·움직임·분석 모드: 처리된 표적 수가 이 값이 되면 종료
export const RANK_GOAL_SCORE = 20; // 랭크 모드: 점수가 이 값에 도달하면 종료

export const DIFFICULTIES = Object.freeze({
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
});

export const EXPOSURE_MS = Object.freeze({
  static: { easy: 1500, normal: 1000, hard: 500 },
  moving: { easy: 2500, normal: 2000, hard: 1500 },
});

// 랭크 규칙. 표적 위치와 순서는 매 판 무작위이며, 서버가 세션마다 무작위 시드를 발급하고 그 시드로 기록을 재현 검증합니다.
// 아래 값이나 TARGET_SHAPE/ARENA/SPAWN_GAP_MS 등 랭크 판정에 영향을 주는 값을 바꾸면
// 반드시 RANK_RULES_VERSION을 올려 기존 기록과 섞이지 않게 해야 합니다.
export const RANK = Object.freeze({
  // v2: 표적 위치·순서를 매 판 무작위로 변경 / v3: 표적 외형·크기·바닥 배치 변경, 노출 시간 0.5초 / v4: 등장 간격 0.5초
  // v5: 노출 시간 0.5초 → 1초
  rulesVersion: 'rank-v5',
  backgroundId: 'range', // 랭크 고정 배경 (서버도 같은 값인지 확인)
  exposureMs: 1000, // 랭크 전용 노출 시간 1초 (정지 표적). 기본 모드 난이도 설정과는 별개
  goalScore: RANK_GOAL_SCORE,
  headPoints: 1,
  timeoutPenalty: -1,
});

export const MODES = Object.freeze({
  basic: { label: '기본 모드' },
  moving: { label: '움직임 모드' },
  analysis: { label: '분석 모드' },
  rank: { label: '랭크 모드' },
  tracking: { label: '트래킹 모드' },
});

export const ANALYSIS_TYPES = Object.freeze({
  static: { label: '정지형', moving: false, exposureMs: EXPOSURE_MS.static.normal },
  moving: { label: '이동형', moving: true, exposureMs: EXPOSURE_MS.moving.normal },
});

// 커서 경로 기록 설정 (분석용)
export const CURSOR_SAMPLE_MIN_INTERVAL_MS = 8;

/**
 * 모드/옵션으로부터 엔진 설정을 만듭니다. 엔진은 이 객체만 보고 동작합니다.
 * end.type === 'targets' → 처리된 표적 수 기준 종료, 'score' → 점수 기준 종료.
 */
export function buildGameConfig(mode, option, seed) {
  const common = {
    mode,
    option,
    arena: ARENA,
    shape: TARGET_SHAPE,
    floor: FLOOR,
    movePattern: MOVE_PATTERN,
    spawnGapMs: SPAWN_GAP_MS,
    minSpawnDistance: MIN_SPAWN_DISTANCE,
    seed,
  };
  switch (mode) {
    case 'basic':
      return { ...common, moving: false, speed: 0, exposureMs: EXPOSURE_MS.static[option],
        scoring: { head: 1, timeout: 0 }, end: { type: 'targets', count: TARGETS_PER_GAME } };
    case 'moving':
      return { ...common, moving: true, speed: MOVE_SPEED, exposureMs: EXPOSURE_MS.moving[option],
        scoring: { head: 1, timeout: 0 }, end: { type: 'targets', count: TARGETS_PER_GAME } };
    case 'analysis': {
      const t = ANALYSIS_TYPES[option];
      return { ...common, moving: t.moving, speed: t.moving ? MOVE_SPEED : 0, exposureMs: t.exposureMs,
        scoring: { head: 1, timeout: 0 }, end: { type: 'targets', count: TARGETS_PER_GAME } };
    }
    case 'tracking':
      return {
        mode, option, seed, arena: ARENA,
        durationMs: TRACKING.durationMs, segmentMs: TRACKING.segmentMs, radius: TRACKING.ballRadius,
        area: TRACKING.area, diff: TRACKING.difficulties[option],
      };
    case 'rank':
      return { ...common, moving: false, speed: 0, exposureMs: RANK.exposureMs,
        scoring: { head: RANK.headPoints, timeout: RANK.timeoutPenalty },
        end: { type: 'score', goal: RANK.goalScore } };
    default:
      throw new Error(`알 수 없는 모드: ${mode}`);
  }
}
