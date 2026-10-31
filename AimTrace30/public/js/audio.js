// 오디오: 배경음악과 효과음을 Web Audio API로 실시간 합성합니다. (외부 음원 파일 없음 → 라이선스·로딩 실패 문제 없음)
// - 브라우저 자동재생 제한: 첫 사용자 클릭/키 입력 때 AudioContext를 만들고 재생을 시작합니다.
// - 오디오를 쓸 수 없거나 실패해도 모든 함수는 조용히 무시되어 게임 진행에 영향을 주지 않습니다.
// - 배경음악은 화면(scene)마다 하나만 재생되며, 전환 시 이전 곡을 짧게 줄인 뒤 다음 곡으로 넘어갑니다.

const SETTINGS_KEY = 'aimTrainer.audio.v1';
export const AUDIO_DEFAULTS = Object.freeze({ musicOn: true, musicVolume: 0.35, sfxOn: true, sfxVolume: 0.5, trackOn: true, trackVolume: 0.4 });

const FADE_OUT_S = 0.5; // 이전 곡 줄이는 시간
const FADE_IN_S = 0.9; // 다음 곡 키우는 시간
const LOOKAHEAD_S = 0.25; // 음표 예약 범위
const SCHEDULER_MS = 60;
const MAX_SHOT_VOICES = 4; // 빠른 연사에도 발사음이 이 수 이상 겹치지 않음
const MAX_HIT_VOICES = 3; // 명중음도 같은 방식으로 제한
// 발사음·명중음 음량 (발사음은 명중 여부와 관계없이 항상 같은 음량, 명중음은 총성에 묻히지 않도록 조금 크게)
const GUN_GAIN = 0.7;
const HEAD_GAIN = 0.95;
const BODY_GAIN = 0.8;
// 트래킹 피드백 지속음: 공 안에서 켜지고 밖에서 줄어듦 (setTargetAtTime 시간 상수, 초)
const TONE_LEVEL = 0.16;
const TONE_FADE_IN = 0.035; // ≈ 0.1초 안에 거의 최대
const TONE_FADE_OUT = 0.06; // ≈ 0.18초에 걸쳐 사라짐

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...AUDIO_DEFAULTS };
    const s = JSON.parse(raw);
    const vol = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    return {
      musicOn: typeof s.musicOn === 'boolean' ? s.musicOn : AUDIO_DEFAULTS.musicOn,
      musicVolume: vol(s.musicVolume, AUDIO_DEFAULTS.musicVolume),
      sfxOn: typeof s.sfxOn === 'boolean' ? s.sfxOn : AUDIO_DEFAULTS.sfxOn,
      sfxVolume: vol(s.sfxVolume, AUDIO_DEFAULTS.sfxVolume),
      trackOn: typeof s.trackOn === 'boolean' ? s.trackOn : AUDIO_DEFAULTS.trackOn,
      trackVolume: vol(s.trackVolume, AUDIO_DEFAULTS.trackVolume),
    };
  } catch {
    return { ...AUDIO_DEFAULTS };
  }
}

// ---------- 악기 (모두 짧은 attack/release로 갑작스러운 큰 소리 없음) ----------
function pad(ctx, out, t, notes, dur, vol, cutoff = 900) {
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(1.2, dur * 0.35));
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
  f.connect(g).connect(out);
  for (const n of notes) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.7);
    }
  }
}

function pluck(ctx, out, t, note, vol, decay = 0.35, type = 'triangle', cutoff = 2400) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = type;
  o.frequency.value = midi(note);
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(f).connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.05);
}

function bass(ctx, out, t, note, dur, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = midi(note);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.03);
  g.gain.setValueAtTime(vol, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function softKick(ctx, out, t, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.32);
}

function hat(ctx, out, t, vol, noise) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5, 0.06);
}

// ---------- 곡 정의 (자체 작곡·합성) ----------
// 홈: 훈련 전 분위기의 잔잔한 일렉트로닉 앰비언트 (Am7–Fmaj7–C–G 반복, 부드러운 킥·하이햇·아르페지오)
// 트래킹: 집중을 방해하지 않는 느린 패드 + 드문 음 (Dm9–B♭maj7–Fmaj7–C)
// 결과: 기록을 읽기 편한 차분한 패드와 피아노풍 음 (Fmaj7–Em7–Dm7–Cmaj7)
const TRACKS = {
  home: {
    bpm: 100, stepsPerBar: 16,
    chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]],
    roots: [45, 41, 48, 43],
    step(ctx, out, t, step, bar, sec, noise) {
      const ch = this.chords[bar % 4];
      if (step === 0) {
        pad(ctx, out, t, ch, sec * 16, 0.028, 1100);
        bass(ctx, out, t, this.roots[bar % 4], sec * 15, 0.07);
      }
      if (step % 4 === 0) softKick(ctx, out, t, 0.09);
      if (step % 4 === 2) hat(ctx, out, t, 0.018, noise);
      if (step % 2 === 0) pluck(ctx, out, t, ch[(step / 2) % 4] + 12, 0.035, 0.28);
    },
  },
  tracking: {
    bpm: 70, stepsPerBar: 8,
    chords: [[50, 57, 60, 64], [46, 53, 57, 62], [41, 48, 57, 64], [48, 55, 59, 64]],
    step(ctx, out, t, step, bar, sec) {
      const ch = this.chords[bar % 4];
      if (step === 0) pad(ctx, out, t, ch, sec * 8, 0.026, 800);
      if (step === 3 || step === 6) pluck(ctx, out, t, ch[(bar + step) % 4] + 12, 0.025, 0.9, 'sine', 1600);
    },
  },
  result: {
    bpm: 80, stepsPerBar: 8,
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    melody: [72, 69, 67, 69, 71, 67, 65, 64],
    step(ctx, out, t, step, bar, sec) {
      const ch = this.chords[bar % 4];
      if (step === 0) {
        pad(ctx, out, t, ch, sec * 8, 0.024, 900);
        bass(ctx, out, t, ch[0] - 12, sec * 7.5, 0.05);
      }
      if (step % 2 === 0) pluck(ctx, out, t, this.melody[(bar * 4 + step / 2) % 8], 0.03, 0.8, 'sine', 2000);
    },
  },
};

export function createAudio() {
  const settings = loadSettings();
  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  let noise = null;
  let scene = 'none'; // 원하는 배경음악: 'home' | 'tracking' | 'result' | 'none'
  const pauseReasons = new Set();
  const tracks = []; // 재생 중이거나 줄어드는 중인 곡 (전환 직후 잠깐 2개, 그 외에는 최대 1개)
  const shotVoices = [];

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 저장 불가 환경 */ }
  }

  function applyVolumes() {
    if (!ctx) return;
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(settings.musicOn && pauseReasons.size === 0 ? settings.musicVolume : 0, now, 0.08);
    sfxBus.gain.cancelScheduledValues(now);
    sfxBus.gain.setTargetAtTime(settings.sfxOn ? settings.sfxVolume : 0, now, 0.02);
    trackBus.gain.cancelScheduledValues(now);
    trackBus.gain.setTargetAtTime(settings.trackOn ? settings.trackVolume : 0, now, 0.03);
  }

  function init() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC({ latencyHint: 'interactive' });
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor(); // 효과음이 겹쳐도 소리가 과하게 커지지 않게
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.connect(comp);
      trackBus = ctx.createGain();
      trackBus.connect(ctx.destination);
      prepareSounds();
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyVolumes();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  // ---------- 배경음악 ----------
  function startTrack(name) {
    const def = TRACKS[name];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN_S);
    gain.connect(musicBus);
    const sec = 60 / def.bpm / (def.stepsPerBar / 4);
    const tr = { name, gain, def, sec, step: 0, bar: 0, next: ctx.currentTime + 0.05, timer: null, fading: false };
    tr.timer = setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      if (pauseReasons.size) { tr.next = Math.max(tr.next, ctx.currentTime + 0.05); return; } // 일시정지 중에는 새 음을 예약하지 않음
      while (tr.next < ctx.currentTime + LOOKAHEAD_S) {
        try { def.step(ctx, gain, tr.next, tr.step, tr.bar, sec, noise); } catch { /* 합성 실패 무시 */ }
        tr.step += 1;
        if (tr.step >= def.stepsPerBar) { tr.step = 0; tr.bar += 1; }
        tr.next += sec;
      }
    }, SCHEDULER_MS);
    tracks.push(tr);
  }

  function fadeOutTrack(tr) {
    if (tr.fading) return;
    tr.fading = true;
    const now = ctx.currentTime;
    tr.gain.gain.cancelScheduledValues(now);
    tr.gain.gain.setValueAtTime(tr.gain.gain.value, now);
    tr.gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
    clearInterval(tr.timer); // 새 음 예약 중단
    setTimeout(() => {
      try { tr.gain.disconnect(); } catch { /* 이미 해제됨 */ }
      const i = tracks.indexOf(tr);
      if (i >= 0) tracks.splice(i, 1);
    }, FADE_OUT_S * 1000 + 900);
  }

  function syncMusic() {
    if (!ctx) return;
    const playing = tracks.filter((t) => !t.fading);
    for (const tr of playing) if (tr.name !== scene) fadeOutTrack(tr);
    if (TRACKS[scene] && !playing.some((t) => t.name === scene)) startTrack(scene);
  }

  // ---------- 효과음: 미리 렌더링한 버퍼를 재생 ----------
  // 총성·명중음은 오디오 활성화 때 OfflineAudioContext로 한 번만 만들어 두고, 발사할 때마다 같은 버퍼를 즉시 재생합니다.
  // (발사마다 합성하지 않으므로 지연이 없고, 발사음은 어디를 맞히든 완전히 같은 소리입니다)
  const sounds = { gun: null, head: null, body: null };
  const hitVoices = [];
  const fireLog = [];
  let fireCount = 0; // 검증용: 지금까지 fire() 호출 수

  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; };
  }
  function noiseBuf(oc, seconds, seed) {
    const b = oc.createBuffer(1, Math.ceil(oc.sampleRate * seconds), oc.sampleRate);
    const d = b.getChannelData(0);
    const r = seeded(seed);
    for (let i = 0; i < d.length; i++) d[i] = r();
    return b;
  }
  async function render(seconds, build) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    build(oc);
    const buf = await oc.startRendering();
    // 최고 음량을 맞춰 소리 사이 균형을 일정하게
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak;
    return buf;
  }

  /** 단발 총성: 짧은 파열음(crack) + 몸통 소리 + 낮은 충격음 + 실내 잔향 */
  function buildGun(oc) {
    const out = oc.createGain();
    out.connect(oc.destination);
    // 잔향: 지수적으로 줄어드는 노이즈 임펄스 응답
    const ir = noiseBuf(oc, 0.9, 7);
    const ird = ir.getChannelData(0);
    for (let i = 0; i < ird.length; i++) ird[i] *= Math.exp(-i / (oc.sampleRate * 0.16));
    const verb = oc.createConvolver();
    verb.normalize = true;
    verb.buffer = ir;
    const verbLp = oc.createBiquadFilter();
    verbLp.type = 'lowpass';
    verbLp.frequency.value = 2600;
    const wet = oc.createGain();
    wet.gain.value = 0.32;
    verb.connect(verbLp).connect(wet).connect(out);
    const send = (node) => { node.connect(out); node.connect(verb); };
    // 1) 파열음: 아주 짧은 고역 노이즈
    const crack = oc.createBufferSource();
    crack.buffer = noiseBuf(oc, 0.02, 1);
    const hp = oc.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const cg = oc.createGain();
    cg.gain.setValueAtTime(1.0, 0);
    cg.gain.exponentialRampToValueAtTime(0.001, 0.012);
    crack.connect(hp).connect(cg);
    send(cg);
    crack.start(0);
    // 2) 몸통: 밝게 시작해 빠르게 어두워지는 노이즈
    const body = oc.createBufferSource();
    body.buffer = noiseBuf(oc, 0.4, 2);
    const lp = oc.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5500, 0);
    lp.frequency.exponentialRampToValueAtTime(700, 0.11);
    const bg = oc.createGain();
    bg.gain.setValueAtTime(0.0001, 0);
    bg.gain.linearRampToValueAtTime(0.85, 0.002);
    bg.gain.exponentialRampToValueAtTime(0.02, 0.16);
    bg.gain.exponentialRampToValueAtTime(0.0005, 0.32);
    body.connect(lp).connect(bg);
    send(bg);
    body.start(0);
    // 3) 낮은 충격음 (살짝 찌그러뜨려 타격감)
    const boom = oc.createOscillator();
    boom.frequency.setValueAtTime(150, 0);
    boom.frequency.exponentialRampToValueAtTime(42, 0.14);
    const shaper = oc.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    const og = oc.createGain();
    og.gain.setValueAtTime(0.0001, 0);
    og.gain.linearRampToValueAtTime(0.9, 0.003);
    og.gain.exponentialRampToValueAtTime(0.001, 0.22);
    boom.connect(shaper).connect(og);
    send(og);
    boom.start(0);
    boom.stop(0.25);
  }

  /** 헤드샷 확인음: 총성의 주된 대역보다 높은 곳에서 맑게 울리는 두 음 (발사음과 분명히 구분) */
  function buildHead(oc) {
    const out = oc.createGain();
    out.connect(oc.destination);
    for (const [f, v, d] of [[2349, 0.8, 0.16], [3136, 0.45, 0.12], [1175, 0.35, 0.1]]) {
      const o = oc.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = oc.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(v, 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, d);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(d + 0.02);
    }
    // 시작 부분의 짧은 금속성 ‘틱’
    const n = oc.createBufferSource();
    n.buffer = noiseBuf(oc, 0.02, 3);
    const bp = oc.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    bp.Q.value = 3;
    const ng = oc.createGain();
    ng.gain.setValueAtTime(0.6, 0);
    ng.gain.exponentialRampToValueAtTime(0.001, 0.015);
    n.connect(bp).connect(ng).connect(out);
    n.start(0);
  }

  /** 몸통·발 피격음: 짧고 작은 ‘퍽’ 소리 (헤드샷 확인음보다 낮고 짧음) */
  function buildBody(oc) {
    const out = oc.createGain();
    out.connect(oc.destination);
    const n = oc.createBufferSource();
    n.buffer = noiseBuf(oc, 0.06, 4);
    const bp = oc.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 1.4;
    const ng = oc.createGain();
    ng.gain.setValueAtTime(0.9, 0);
    ng.gain.exponentialRampToValueAtTime(0.001, 0.045);
    n.connect(bp).connect(ng).connect(out);
    n.start(0);
    const o = oc.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, 0);
    o.frequency.exponentialRampToValueAtTime(520, 0.05);
    const og = oc.createGain();
    og.gain.setValueAtTime(0.0001, 0);
    og.gain.linearRampToValueAtTime(0.7, 0.003);
    og.gain.exponentialRampToValueAtTime(0.001, 0.07);
    o.connect(og).connect(out);
    o.start(0);
    o.stop(0.08);
  }

  async function prepareSounds() {
    try {
      const [gun, head, body] = await Promise.all([render(0.9, buildGun), render(0.2, buildHead), render(0.1, buildBody)]);
      Object.assign(sounds, { gun, head, body });
    } catch { /* 렌더링 실패 시 효과음 없이 진행 */ }
  }

  function playBuffer(buf, gain, t, voices, max) {
    while (voices.length >= max) {
      const old = voices.shift();
      try { old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.006); old.src.stop(t + 0.04); } catch { /* 종료됨 */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(sfxBus);
    src.start(t);
    const v = { src, g };
    voices.push(v);
    src.onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
  }

  // ---------- 트래킹 피드백 지속음 ----------
  // 공 안에 있는 동안 하나의 부드러운 지속음을 켜고, 밖으로 나가면 짧게 줄입니다. (매 프레임 새로 재생하지 않음)
  let trackBus = null;
  let tone = null;
  let toneCreated = 0;

  function toneStart() {
    if (!ctx || tone) return; // 이미 있으면 새로 만들지 않음 (중복 방지)
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(g).connect(trackBus);
    // 배경음악(톱니파 패드)과 구분되는 순한 사인파 두 음 + 느린 떨림
    const oscs = [[523.25, 1], [784, 0.3]].map(([f, v]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(lp);
      o.start();
      return o;
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    const trem = ctx.createGain();
    trem.gain.value = 1;
    lfo.connect(lfoGain).connect(trem.gain);
    lp.disconnect();
    lp.connect(trem).connect(g);
    lfo.start();
    tone = { g, oscs: [...oscs, lfo], on: false };
    toneCreated += 1;
  }

  function toneSet(on) {
    if (!tone || tone.on === on) return;
    tone.on = on;
    const now = ctx.currentTime;
    tone.g.gain.cancelScheduledValues(now);
    tone.g.gain.setTargetAtTime(on ? TONE_LEVEL : 0, now, on ? TONE_FADE_IN : TONE_FADE_OUT);
  }

  function toneStop() {
    if (!tone) return;
    const t = tone;
    tone = null;
    const now = ctx.currentTime;
    t.g.gain.cancelScheduledValues(now);
    t.g.gain.setTargetAtTime(0, now, 0.02);
    for (const o of t.oscs) { try { o.stop(now + 0.15); } catch { /* 종료됨 */ } }
    setTimeout(() => { try { t.g.disconnect(); } catch { /* 해제됨 */ } }, 300);
  }

  const api = {
    settings,
    /** 첫 사용자 입력 때 호출: 오디오 활성화 (자동재생 차단 대응) */
    unlock() {
      if (!init()) return;
      if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
      syncMusic();
    },
    /** 화면별 배경음악 지정: 'home' | 'tracking' | 'result' | 'none' */
    setScene(name) {
      scene = name;
      syncMusic();
    },
    /** 일시정지 사유 추가/해제 (예: 'hidden' 탭 비활성, 'tracking-pause' 트래킹 일시정지) */
    pause(reason) {
      pauseReasons.add(reason);
      applyVolumes();
      if (ctx && reason === 'hidden') ctx.suspend().catch(() => {});
    },
    resume(reason) {
      pauseReasons.delete(reason);
      if (ctx && reason === 'hidden' && !document.hidden) ctx.resume().catch(() => {});
      applyVolumes();
    },
    /**
     * 유효한 발사 1회의 소리. part: 'head' | 'body' | 'feet' | 'miss' (판정 직후 호출)
     * 항상 같은 총성 + (명중 시) 그 위에 겹치는 명중음. 재생할 소리 층 목록을 돌려줍니다.
     */
    fire(part) {
      const layers = ['gun'];
      if (part === 'head') layers.push('head');
      else if (part === 'body' || part === 'feet') layers.push('body');
      fireCount += 1;
      fireLog.push(layers.join('+'));
      if (fireLog.length > 50) fireLog.shift();
      if (!ctx || ctx.state !== 'running' || !settings.sfxOn) return layers;
      try {
        const t = ctx.currentTime; // 같은 순간에 두 소리를 시작
        if (sounds.gun) playBuffer(sounds.gun, GUN_GAIN, t, shotVoices, MAX_SHOT_VOICES);
        if (layers[1] === 'head' && sounds.head) playBuffer(sounds.head, HEAD_GAIN, t, hitVoices, MAX_HIT_VOICES);
        if (layers[1] === 'body' && sounds.body) playBuffer(sounds.body, BODY_GAIN, t, hitVoices, MAX_HIT_VOICES);
      } catch { /* 효과음 실패는 무시 */ }
      return layers;
    },
    /** 트래킹 피드백 지속음: 시작(플레이 시작·재개) / 공 안 여부 / 정지(일시정지·종료·정리) */
    trackingToneStart() { try { toneStart(); } catch { /* 무시 */ } },
    trackingTone(inside) { try { toneSet(!!inside); } catch { /* 무시 */ } },
    trackingToneStop() { try { toneStop(); } catch { /* 무시 */ } },
    update(patch) {
      Object.assign(settings, patch);
      saveSettings();
      applyVolumes();
    },
    /** 검증용: 미리 렌더링한 효과음 버퍼 */
    buffers() { return { ...sounds, sampleRate: ctx ? ctx.sampleRate : 0 }; },
    /** 검증용 상태 */
    debug() {
      return {
        context: ctx ? ctx.state : 'none',
        scene,
        playing: tracks.filter((t) => !t.fading).map((t) => t.name),
        fading: tracks.filter((t) => t.fading).length,
        paused: [...pauseReasons],
        shotVoices: shotVoices.length,
        hitVoices: hitVoices.length,
        soundsReady: !!(sounds.gun && sounds.head && sounds.body),
        fireLog: fireLog.slice(),
        fireCount,
        tone: { active: !!tone, on: tone ? tone.on : false, created: toneCreated, level: tone ? tone.g.gain.value : 0 },
        settings: { ...settings },
      };
    },
  };
  return api;
}
