import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Shot = { score: number; index: number };

const TARGET_SIZE = 520;
const CENTER = TARGET_SIZE / 2;
const RING_RADII_MM = [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5];
const MM_TO_PX = 230 / 45.5;
const BULLET_MM = 4.5;
const BULLET_PX = BULLET_MM * MM_TO_PX;

const START_TIME = 40;
const HOLD_WINDOW = 1.5;

function computeDecimalScore(dx: number, dy: number): number {
  const distPx = Math.hypot(dx, dy);
  const distMm = distPx / MM_TO_PX;
  if (distMm >= 45.5) return 0;
  const score = 10.9 - distMm * 0.2;
  return Math.max(0, Math.round(score * 10) / 10);
}

// ---- Audio ----
let audioCtx: AudioContext | null = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return audioCtx;
}
function playCrack() {
  const ctx = getCtx();
  const dur = 0.12;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}
function playHeartbeat(intensity: number) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 60;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.12 + intensity * 0.15, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}
function playChime() {
  const ctx = getCtx();
  [880, 1320, 1760, 2200].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.08);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.08 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 1.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.08);
    osc.stop(ctx.currentTime + i * 0.08 + 1.6);
  });
  // crowd roar — filtered noise burst
  const dur = 1.8;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = Math.sin((i / d.length) * Math.PI);
    d[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 800;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.value = 0.5;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start();
}
function playReload() {
  const ctx = getCtx();
  const now = ctx.currentTime;
  // bolt open: noise burst with bandpass
  const mkClick = (t: number, freq: number, dur: number, gainV: number) => {
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = gainV;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(now + t);
  };
  mkClick(0, 1200, 0.08, 0.5); // bolt open
  mkClick(0.18, 2400, 0.04, 0.4); // pellet click
  mkClick(0.35, 900, 0.1, 0.55); // bolt close
  // metallic ping
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = 1800;
  osc.type = "triangle";
  g.gain.setValueAtTime(0, now + 0.35);
  g.gain.linearRampToValueAtTime(0.15, now + 0.36);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  osc.connect(g).connect(ctx.destination);
  osc.start(now + 0.35);
  osc.stop(now + 0.6);
}
function playGameOver() {
  const ctx = getCtx();
  const now = ctx.currentTime;
  [440, 330, 220, 165].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = "sawtooth";
    g.gain.setValueAtTime(0.25, now + i * 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.25);
    o.stop(now + i * 0.25 + 0.55);
  });
}
function playEmptyClick() {
  const ctx = getCtx();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 220;
  o.type = "square";
  g.gain.setValueAtTime(0.15, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.1);
}

// ---- Industrial bg music (looping web audio) ----
let musicNodes: { stop: () => void } | null = null;
function startMusic() {
  if (musicNodes) return;
  const ctx = getCtx();
  const bpm = 132;
  const beat = 60 / bpm;
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  // sub bass pulse
  const bassOsc = ctx.createOscillator();
  bassOsc.type = "sawtooth";
  bassOsc.frequency.value = 55;
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0;
  const bassFilter = ctx.createBiquadFilter();
  bassFilter.type = "lowpass";
  bassFilter.frequency.value = 220;
  bassOsc.connect(bassFilter).connect(bassGain).connect(master);
  bassOsc.start();

  // arp synth
  const arpOsc = ctx.createOscillator();
  arpOsc.type = "square";
  const arpGain = ctx.createGain();
  arpGain.gain.value = 0;
  const arpFilter = ctx.createBiquadFilter();
  arpFilter.type = "lowpass";
  arpFilter.frequency.value = 1400;
  arpOsc.connect(arpFilter).connect(arpGain).connect(master);
  arpOsc.start();

  const notes = [110, 138.6, 164.8, 220, 164.8, 138.6, 110, 82.4];
  let step = 0;
  const interval = setInterval(() => {
    const t = ctx.currentTime;
    // kick
    bassGain.gain.cancelScheduledValues(t);
    bassGain.gain.setValueAtTime(0.6, t);
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    // arp
    arpOsc.frequency.setValueAtTime(notes[step % notes.length], t);
    arpGain.gain.cancelScheduledValues(t);
    arpGain.gain.setValueAtTime(0.12, t);
    arpGain.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.45);
    step++;
  }, beat * 500);

  musicNodes = {
    stop: () => {
      clearInterval(interval);
      try {
        bassOsc.stop();
        arpOsc.stop();
      } catch {}
      musicNodes = null;
    },
  };
}
function stopMusic() {
  musicNodes?.stop();
}

export default function AirRifleGame() {
  const arenaRef = useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = useState({ x: CENTER, y: CENTER });
  const [targetOffset, setTargetOffset] = useState({ x: 0, y: 0 });
  const [shots, setShots] = useState<Shot[]>([]);
  const [lastHole, setLastHole] = useState<{ x: number; y: number; score: number } | null>(null);
  const [holding, setHolding] = useState(false);
  const [holdStart, setHoldStart] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(true);
  const [perfect, setPerfect] = useState(false);
  const [bulletTime, setBulletTime] = useState(false);
  const [timeLeft, setTimeLeft] = useState(START_TIME);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [perfectCount, setPerfectCount] = useState(0);
  const [totalShots, setTotalShots] = useState(0);
  const [lastShot, setLastShot] = useState<number | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);
  const lastHeartbeat = useRef(0);
  const tRef = useRef(0);

  // mouse tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rect = arenaRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMouse({
        x: Math.max(0, Math.min(TARGET_SIZE, e.clientX - rect.left)),
        y: Math.max(0, Math.min(TARGET_SIZE, e.clientY - rect.top)),
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // global mouseup safety
  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (e.button === 2) {
        setHolding(false);
        setHoldStart(null);
      }
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Reload key
  const reload = useCallback(() => {
    if (loaded || gameOver) return;
    playReload();
    setTimeout(() => setLoaded(true), 450);
  }, [loaded, gameOver]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") reload();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reload]);

  // Physics — moving TARGET, static sight
  useEffect(() => {
    if (!started || gameOver) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tRef.current += dt;
      const t = tRef.current;

      // Hold window
      let dampen = 1;
      let overHold = false;
      if (holding && holdStart) {
        const heldFor = (now - holdStart) / 1000;
        if (heldFor < HOLD_WINDOW) dampen = 0.2;
        else {
          dampen = 2.2;
          overHold = true;
        }
      }

      const baseAmp = 70;
      const swayX = Math.sin(t * 2.3) * baseAmp + Math.sin(t * 5.7) * 25;
      const swayY = Math.cos(t * 1.9) * baseAmp * 0.7 + Math.cos(t * 6.3) * 22;
      const jitterAmp = overHold ? 28 : 14;
      const jx = (Math.random() - 0.5) * jitterAmp;
      const jy = (Math.random() - 0.5) * jitterAmp;
      setTargetOffset({ x: (swayX + jx) * dampen, y: (swayY + jy) * dampen });

      // heartbeat
      const beatInterval = overHold ? 0.35 : 0.7;
      if (now - lastHeartbeat.current > beatInterval * 1000) {
        lastHeartbeat.current = now;
        playHeartbeat(overHold ? 1 : 0.4);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [started, gameOver, holding, holdStart]);

  // Timer
  useEffect(() => {
    if (!started || gameOver) return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        const nt = +(t - 0.1).toFixed(2);
        if (nt <= 0) {
          setGameOver(true);
          stopMusic();
          playGameOver();
          return 0;
        }
        return nt;
      });
    }, 100);
    return () => clearInterval(id);
  }, [started, gameOver]);

  const fire = useCallback(() => {
    if (gameOver) return;
    if (!loaded) {
      playEmptyClick();
      return;
    }
    playCrack();
    setLoaded(false);
    // hit position = sight (mouse) minus the target's current offset
    const hitX = mouse.x - targetOffset.x;
    const hitY = mouse.y - targetOffset.y;
    const dx = hitX - CENTER;
    const dy = hitY - CENTER;
    const sc = computeDecimalScore(dx, dy);
    setLastHole({ x: hitX, y: hitY, score: sc });
    setShots((s) => [{ score: sc, index: s.length + 1 }, ...s].slice(0, 8));
    setTotalShots((c) => c + 1);
    setLastShot(sc);

    if (sc >= 9.0) {
      setCombo((c) => {
        const nc = c + 1;
        setBestCombo((b) => Math.max(b, nc));
        return nc;
      });
      const mult = 1 + combo * 0.25;
      setScore((s) => +(s + sc * mult).toFixed(1));
      setTimeLeft((t) => Math.min(99, t + (sc === 10.9 ? 10 : 3)));
    } else {
      setCombo(0);
      setScore((s) => +(s + sc * 0.5).toFixed(1));
    }

    if (sc === 10.9) {
      setPerfectCount((c) => c + 1);
      playChime();
      setPerfect(true);
      setBulletTime(true);
      setTimeout(() => setBulletTime(false), 900);
      setTimeout(() => setPerfect(false), 2200);
    }
    // release breath after shot
    setHolding(false);
    setHoldStart(null);
  }, [gameOver, loaded, mouse, targetOffset, combo]);

  const startGame = () => {
    setStarted(true);
    setGameOver(false);
    setShots([]);
    setScore(0);
    setCombo(0);
    setBestCombo(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setTimeLeft(START_TIME);
    setLoaded(true);
    setLastHole(null);
    getCtx();
    startMusic();
  };

  const resetAll = () => {
    stopMusic();
    setStarted(false);
    setGameOver(false);
  };

  const holdTime = holding && holdStart ? (performance.now() - holdStart) / 1000 : 0;
  const inPerfectWindow = holding && holdTime < HOLD_WINDOW;
  const overHold = holding && holdTime >= HOLD_WINDOW;
  const lowTime = timeLeft <= 10;

  return (
    <div className="min-h-screen bg-background text-foreground select-none overflow-hidden">
      {/* Top broadcast bar */}
      <div className="flex items-center justify-between border-b border-border bg-[var(--navy-mid)] px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
          <span className="text-xs font-bold tracking-[0.3em] text-muted-foreground">LIVE</span>
          <span className="text-xs font-semibold tracking-widest text-foreground">
            ENDLESS HARDCORE · 10m AIR RIFLE
          </span>
        </div>
        <div className="flex items-center gap-6 text-xs font-mono">
          <div>
            <span className="text-muted-foreground mr-2">SCORE</span>
            <span className="font-bold text-primary tabular-nums">{score.toFixed(1)}</span>
          </div>
          <div>
            <span className="text-muted-foreground mr-2">COMBO</span>
            <span className={`font-bold tabular-nums ${combo >= 3 ? "text-[var(--gold-bright)]" : "text-foreground"}`}>
              ×{combo}
            </span>
          </div>
          <div className={`font-bold tabular-nums ${lowTime ? "text-destructive animate-pulse" : "text-primary"}`}>
            {timeLeft.toFixed(1)}s
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-0">
        {/* Range */}
        <div className="relative flex items-center justify-center bg-gradient-to-b from-[#e8eaee] to-[#c8ccd2] p-8 min-h-[calc(100vh-52px)] overflow-hidden">
          {/* vignette when over-holding */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-300"
            style={{
              opacity: overHold ? 1 : 0,
              background:
                "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 95%)",
            }}
          />
          {/* bullet time gold flash */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-300"
            style={{
              opacity: bulletTime ? 0.55 : 0,
              background:
                "radial-gradient(circle at center, rgba(220,180,60,0.6) 0%, transparent 70%)",
              mixBlendMode: "screen",
            }}
          />

          <div
            ref={arenaRef}
            onMouseDown={(e) => {
              if (!started || gameOver) return;
              if (e.button === 0) fire();
              else if (e.button === 2) {
                setHolding(true);
                setHoldStart(performance.now());
              }
            }}
            onMouseUp={(e) => {
              if (e.button === 2) {
                setHolding(false);
                setHoldStart(null);
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="relative cursor-none shadow-2xl"
            style={{
              width: TARGET_SIZE,
              height: TARGET_SIZE,
              background: "#f4f4ef",
              transform: bulletTime ? "scale(1.04)" : "scale(1)",
              transition: "transform 0.3s ease-out",
            }}
          >
            {/* Target — translated by physics */}
            <svg
              width={TARGET_SIZE}
              height={TARGET_SIZE}
              className="absolute inset-0"
              style={{
                transform: `translate(${targetOffset.x}px, ${targetOffset.y}px)`,
                willChange: "transform",
              }}
            >
              {[9, 8, 7].map((idx) => {
                const r = RING_RADII_MM[idx] * MM_TO_PX;
                return <circle key={idx} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#222" strokeWidth={1} />;
              })}
              {[9, 8, 7, 6].map((idx, i) => {
                const r = (RING_RADII_MM[idx] - 2.5) * MM_TO_PX;
                return (
                  <text key={`n${idx}`} x={CENTER} y={CENTER + r + 4} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#222">
                    {i + 1}
                  </text>
                );
              })}
              <circle cx={CENTER} cy={CENTER} r={RING_RADII_MM[6] * MM_TO_PX} fill="#0a0a0a" />
              {[5, 4, 3, 2].map((idx, i) => {
                const r = (RING_RADII_MM[idx] - 2.5) * MM_TO_PX;
                return (
                  <text key={`w${idx}`} x={CENTER} y={CENTER + r + 4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#fff">
                    {i + 5}
                  </text>
                );
              })}
              {[5, 4, 3, 2, 1].map((idx) => {
                const r = RING_RADII_MM[idx] * MM_TO_PX;
                return <circle key={`l${idx}`} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#fff" strokeWidth={0.5} opacity={0.4} />;
              })}
              <circle cx={CENTER} cy={CENTER} r={0.6} fill="#fff" />

              {/* last bullet hole travels with target */}
              {lastHole && (
                <g>
                  <circle cx={lastHole.x} cy={lastHole.y} r={BULLET_PX / 2} fill="#fff" stroke="#000" strokeWidth={0.8} />
                  <circle cx={lastHole.x} cy={lastHole.y} r={BULLET_PX / 2 - 1.2} fill="#1a1a1a" />
                </g>
              )}
            </svg>

            {/* Static diopter sight at cursor */}
            <div
              className="absolute pointer-events-none"
              style={{ left: mouse.x, top: mouse.y, transform: "translate(-50%, -50%)" }}
            >
              <div
                className="rounded-full border-2"
                style={{
                  width: 38,
                  height: 38,
                  borderColor: inPerfectWindow ? "var(--gold)" : overHold ? "oklch(0.6 0.24 27)" : "rgba(0,0,0,0.6)",
                  boxShadow: inPerfectWindow
                    ? "0 0 0 6px rgba(220,180,60,0.25), inset 0 0 0 1px rgba(255,255,255,0.4)"
                    : "0 0 0 2px rgba(255,255,255,0.5), inset 0 0 0 1px rgba(255,255,255,0.4)",
                }}
              />
              <div
                className="absolute top-1/2 left-1/2 rounded-full"
                style={{
                  width: 2,
                  height: 2,
                  background: inPerfectWindow ? "var(--gold)" : "rgba(0,0,0,0.9)",
                  transform: "translate(-50%,-50%)",
                }}
              />
            </div>
          </div>

          {/* PERFECT overlay */}
          <AnimatePresence>
            {perfect && (
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0, scale: 1.2 }}
                transition={{ type: "spring", stiffness: 220, damping: 18 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
              >
                <div className="bg-[var(--navy-deep)]/90 backdrop-blur-sm border-y-4 border-primary px-16 py-8">
                  <div className="text-[10px] tracking-[0.5em] text-primary font-bold mb-2 text-center">
                    INNER TEN · +10s
                  </div>
                  <div className="text-7xl font-black tracking-tight text-primary">PERFECT 10.9</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* HUD bottom */}
          <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between text-xs font-mono pointer-events-none">
            <div className="bg-[var(--navy-deep)]/90 px-3 py-2 text-foreground border-l-2 border-primary">
              <div className="text-[9px] tracking-widest text-muted-foreground">CHAMBER</div>
              <div className={`font-bold ${loaded ? "text-[var(--gold-bright)]" : "text-destructive"}`}>
                {loaded ? "● LOADED" : "○ EMPTY · PRESS [R]"}
              </div>
            </div>
            <div className="bg-[var(--navy-deep)]/90 px-3 py-2 text-foreground border-r-2 border-primary text-right">
              <div className="text-[9px] tracking-widest text-muted-foreground">BREATH</div>
              <div className={`font-bold ${inPerfectWindow ? "text-[var(--gold-bright)]" : overHold ? "text-destructive" : ""}`}>
                {holding ? (inPerfectWindow ? `HOLD · ${(HOLD_WINDOW - holdTime).toFixed(2)}s` : "OVER-HOLD!") : "BREATHE"}
              </div>
            </div>
          </div>

          {/* Start / Game over overlays */}
          {!started && !gameOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--navy-deep)]/85 backdrop-blur-sm z-40">
              <div className="text-center space-y-6 px-8">
                <div className="text-[10px] tracking-[0.5em] text-primary font-bold">ENDLESS HARDCORE MODE</div>
                <div className="text-5xl font-black tracking-tight">10m AIR RIFLE</div>
                <div className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Мишень бесится. Винтовка — 1 патрон. Перезаряжай [R].
                  Удерживай ПКМ ровно 1.5с — окно идеального выстрела.
                </div>
                <button
                  onClick={startGame}
                  className="bg-primary text-primary-foreground font-bold tracking-widest px-10 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                >
                  START MATCH
                </button>
              </div>
            </div>
          )}
          {gameOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--navy-deep)]/90 backdrop-blur-sm z-40">
              <div className="text-center space-y-5 px-8">
                <div className="text-[10px] tracking-[0.5em] text-destructive font-bold">TIME OUT</div>
                <div className="text-6xl font-black tracking-tight">GAME OVER</div>
                <div className="grid grid-cols-3 gap-6 text-center pt-4">
                  <div>
                    <div className="text-[9px] tracking-widest text-muted-foreground">SCORE</div>
                    <div className="text-2xl font-black text-primary tabular-nums">{score.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] tracking-widest text-muted-foreground">SHOTS</div>
                    <div className="text-2xl font-black tabular-nums">{shots.length ? "—" : 0}</div>
                  </div>
                  <div>
                    <div className="text-[9px] tracking-widest text-muted-foreground">BEST COMBO</div>
                    <div className="text-2xl font-black text-[var(--gold-bright)] tabular-nums">×{bestCombo}</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    resetAll();
                    setTimeout(startGame, 30);
                  }}
                  className="bg-primary text-primary-foreground font-bold tracking-widest px-10 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                >
                  RETRY
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scoreboard / Dashboard */}
        <aside className="bg-[var(--navy-mid)] border-l border-border flex flex-col">
          <div className="px-5 py-4 border-b border-border bg-[var(--navy-deep)]">
            <div className="text-[10px] tracking-[0.4em] text-muted-foreground mb-3">LIVE DASHBOARD</div>

            {/* 4-metric grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Perfect 10.9s */}
              <div className="bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
                <div className="text-[9px] tracking-widest text-muted-foreground mb-1">PERFECT 10.9s</div>
                <div className="text-3xl font-black text-[var(--gold-bright)] font-mono tabular-nums leading-none">
                  {perfectCount}
                </div>
              </div>

              {/* Total Shots */}
              <div className="bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
                <div className="text-[9px] tracking-widest text-muted-foreground mb-1">TOTAL SHOTS</div>
                <div className="text-3xl font-black text-foreground font-mono tabular-nums leading-none">
                  {totalShots}
                </div>
              </div>

              {/* Last Shot */}
              <div className="bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
                <div className="text-[9px] tracking-widest text-muted-foreground mb-1">LAST SHOT</div>
                <div className={`text-3xl font-black font-mono tabular-nums leading-none ${lastShot === 10.9 ? "text-[var(--gold-bright)]" : lastShot !== null ? "text-foreground" : "text-muted-foreground/40"}`}>
                  {lastShot !== null ? lastShot.toFixed(1) : "—"}
                </div>
              </div>

              {/* Total Score */}
              <div className="bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
                <div className="text-[9px] tracking-widest text-muted-foreground mb-1">TOTAL SCORE</div>
                <div className="text-3xl font-black text-primary font-mono tabular-nums leading-none">
                  {score.toFixed(1)}
                </div>
              </div>
            </div>

            {/* Mini secondary row */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="text-[9px] tracking-widest text-muted-foreground">TIME</div>
                <div className={`text-xl font-black font-mono tabular-nums ${lowTime ? "text-destructive" : "text-primary"}`}>
                  {timeLeft.toFixed(1)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[9px] tracking-widest text-muted-foreground">COMBO</div>
                <div className={`text-xl font-black font-mono tabular-nums ${combo >= 3 ? "text-[var(--gold-bright)]" : "text-foreground"}`}>
                  ×{combo}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[9px] tracking-widest text-muted-foreground">BEST</div>
                <div className="text-xl font-black text-[var(--gold-bright)] font-mono tabular-nums">
                  ×{bestCombo}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="px-4 py-3 text-[10px] tracking-widest text-muted-foreground border-b border-border/40">
              RECENT SHOTS
            </div>
            <table className="w-full text-sm font-mono">
              <tbody>
                {shots.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-muted-foreground/60 text-xs italic">— no shots yet —</td>
                  </tr>
                )}
                {shots.map((shot, i) => (
                  <tr
                    key={shot.index}
                    className={`border-b border-border/40 ${shot.score === 10.9 ? "bg-primary/10" : "bg-[var(--navy-mid)]"}`}
                  >
                    <td className="px-4 py-2 text-muted-foreground">#{shot.index}</td>
                    <td className="px-2 py-2 font-bold text-primary">KAZ</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-bold ${
                        shot.score === 10.9
                          ? "text-primary"
                          : shot.score >= 9
                            ? "text-foreground"
                            : "text-muted-foreground"
                      }`}
                    >
                      {shot.score.toFixed(1)}
                      {i === 0 && shot.score >= 9 && (
                        <span className="ml-2 text-[10px] text-[var(--gold-bright)]">
                          +{shot.score === 10.9 ? 10 : 3}s
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border p-4 space-y-2 bg-[var(--navy-deep)]">
            <div className="text-[10px] leading-relaxed text-muted-foreground tracking-wide">
              <div className="text-foreground font-bold mb-1 tracking-widest">CONTROLS</div>
              [ПКМ] Задержать дыхание (окно 1.5с)
              <br />
              [ЛКМ] Выстрел · [R] Перезарядка
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
