import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Shot = { x: number; y: number; score: number; index: number };

const TARGET_SIZE = 520;
const CENTER = TARGET_SIZE / 2;
// ISSF 10m air rifle ring radii in mm (10 inner = 0.5mm). Black from ring 4.
// We scale: full target visual radius = 230px (~ ring 1 area).
const RING_RADII_MM = [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5]; // 10..1
const MM_TO_PX = 230 / 45.5;
const BULLET_MM = 4.5;
const BULLET_PX = BULLET_MM * MM_TO_PX;

function computeDecimalScore(dx: number, dy: number): number {
  // HARDCORE: strict center-to-center distance (no inward bullet-edge scoring).
  // 10.9 is achievable ONLY when the sight is mathematically on the absolute
  // center pixel. Each 0.5mm of offset costs 0.1 points — so a single pixel
  // away from dead center already drops the score below 10.9.
  const distPx = Math.hypot(dx, dy);
  const distMm = distPx / MM_TO_PX;
  if (distMm >= 45.5) return 0;
  const score = 10.9 - distMm * 0.2; // 0.1 per 0.5mm
  return Math.max(0, Math.round(score * 10) / 10);
}

// Web Audio helpers
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
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  }
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
  gain.gain.linearRampToValueAtTime(0.15 + intensity * 0.15, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}
function playChime() {
  const ctx = getCtx();
  [880, 1320, 1760].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.1 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.1);
    osc.stop(ctx.currentTime + i * 0.1 + 1.3);
  });
}

export default function AirRifleGame() {
  const arenaRef = useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = useState({ x: CENTER, y: CENTER });
  const [sight, setSight] = useState({ x: CENTER, y: CENTER });
  const [shots, setShots] = useState<Shot[]>([]);
  const [holding, setHolding] = useState(false);
  const [holdStart, setHoldStart] = useState<number | null>(null);
  const [aimingTime, setAimingTime] = useState(0); // muscle fatigue
  const [perfect, setPerfect] = useState(false);
  const lastHeartbeat = useRef(0);
  const tRef = useRef(0);

  // Mouse tracking
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

  // Spacebar breath control
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !holding) {
        e.preventDefault();
        setHolding(true);
        setHoldStart(performance.now());
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setHolding(false);
        setHoldStart(null);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [holding]);

  // Physics loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tRef.current += dt;
      setAimingTime((t) => t + dt);

      // Figure-8 base sway
      const t = tRef.current;
      const fatigue = Math.min(1, aimingTime / 25); // builds over 25s
      let swayAmp = 8 + fatigue * 22;
      const violentJitter = fatigue * 6;

      // Breath control
      let dampen = 1;
      if (holding && holdStart) {
        const heldFor = (now - holdStart) / 1000;
        if (heldFor < 3) dampen = 0.2;
        else dampen = 1 + (heldFor - 3) * 1.5; // violent after 3s
      }

      const swayX = Math.sin(t * 1.1) * swayAmp * dampen;
      const swayY = Math.sin(t * 2.2) * (swayAmp * 0.5) * dampen;
      const jx = (Math.random() - 0.5) * violentJitter * dampen;
      const jy = (Math.random() - 0.5) * violentJitter * dampen;

      const targetX = mouse.x + swayX + jx;
      const targetY = mouse.y + swayY + jy;

      // Elastic lag (heavy rifle inertia)
      setSight((s) => ({
        x: s.x + (targetX - s.x) * 0.08,
        y: s.y + (targetY - s.y) * 0.08,
      }));

      // Heartbeat (faster as fatigue builds)
      const beatInterval = 1.0 - fatigue * 0.5;
      if (now - lastHeartbeat.current > beatInterval * 1000) {
        lastHeartbeat.current = now;
        if (aimingTime > 2) playHeartbeat(fatigue);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mouse, holding, holdStart, aimingTime]);

  const fire = useCallback(() => {
    if (shots.length >= 10) return;
    playCrack();
    const dx = sight.x - CENTER;
    const dy = sight.y - CENTER;
    const score = computeDecimalScore(dx, dy);
    const newShot: Shot = { x: sight.x, y: sight.y, score, index: shots.length + 1 };
    setShots((s) => [...s, newShot]);
    setAimingTime(0);
    if (score === 10.9) {
      playChime();
      setPerfect(true);
      setTimeout(() => setPerfect(false), 2500);
    }
  }, [sight, shots.length]);

  const reset = () => {
    setShots([]);
    setAimingTime(0);
    setPerfect(false);
  };

  const total = shots.reduce((a, b) => a + b.score, 0);
  const fatiguePct = Math.min(100, (aimingTime / 25) * 100);
  const holdTime = holding && holdStart ? (performance.now() - holdStart) / 1000 : 0;
  const inPerfectWindow = holding && holdTime < 3;

  return (
    <div className="min-h-screen bg-background text-foreground select-none overflow-hidden">
      {/* Top broadcast bar */}
      <div className="flex items-center justify-between border-b border-border bg-[var(--navy-mid)] px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
          <span className="text-xs font-bold tracking-[0.3em] text-muted-foreground">LIVE</span>
          <span className="text-xs font-semibold tracking-widest text-foreground">
            ISSF · 10m AIR RIFLE · QUALIFICATION
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-muted-foreground">SHOT</span>
          <span className="font-bold text-primary">{shots.length}/10</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0">
        {/* Range */}
        <div className="relative flex items-center justify-center bg-gradient-to-b from-[#e8eaee] to-[#c8ccd2] p-8 min-h-[calc(100vh-52px)]">
          {/* Range backdrop lines */}
          <div className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.15) 100%), repeating-linear-gradient(0deg, transparent 0 40px, rgba(0,0,0,0.04) 40px 41px)",
            }}
          />

          <div
            ref={arenaRef}
            onClick={fire}
            className="relative cursor-none shadow-2xl"
            style={{ width: TARGET_SIZE, height: TARGET_SIZE, background: "#f4f4ef" }}
          >
            {/* Target rings — outer (white) */}
            <svg width={TARGET_SIZE} height={TARGET_SIZE} className="absolute inset-0">
              {/* Rings 1-3 (white area with thin lines) */}
              {[9, 8, 7].map((idx) => {
                const r = RING_RADII_MM[idx] * MM_TO_PX;
                return (
                  <circle
                    key={idx}
                    cx={CENTER}
                    cy={CENTER}
                    r={r}
                    fill="none"
                    stroke="#222"
                    strokeWidth={1}
                  />
                );
              })}
              {/* Ring numbers for 1-4 */}
              {[9, 8, 7, 6].map((idx, i) => {
                const r = (RING_RADII_MM[idx] - 2.5) * MM_TO_PX;
                const num = i + 1;
                return (
                  <text
                    key={`n${idx}`}
                    x={CENTER}
                    y={CENTER + r + 4}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="bold"
                    fill="#222"
                  >
                    {num}
                  </text>
                );
              })}

              {/* Ring 4 outer = start of black */}
              <circle cx={CENTER} cy={CENTER} r={RING_RADII_MM[6] * MM_TO_PX} fill="#0a0a0a" />

              {/* Ring numbers 5-8 in white */}
              {[5, 4, 3, 2].map((idx, i) => {
                const r = (RING_RADII_MM[idx] - 2.5) * MM_TO_PX;
                const num = i + 5;
                return (
                  <text
                    key={`w${idx}`}
                    x={CENTER}
                    y={CENTER + r + 4}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="bold"
                    fill="#fff"
                  >
                    {num}
                  </text>
                );
              })}

              {/* Inner ring lines */}
              {[5, 4, 3, 2, 1].map((idx) => {
                const r = RING_RADII_MM[idx] * MM_TO_PX;
                return (
                  <circle
                    key={`l${idx}`}
                    cx={CENTER}
                    cy={CENTER}
                    r={r}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={0.5}
                    opacity={0.4}
                  />
                );
              })}

              {/* The absolute center — a microscopic 1px dot.
                  Hitting it dead-on is the only way to score 10.9. */}
              <circle cx={CENTER} cy={CENTER} r={0.6} fill="#fff" />

              {/* Bullet holes */}
              {shots.map((s) => (
                <g key={s.index}>
                  <circle cx={s.x} cy={s.y} r={BULLET_PX / 2} fill="#fff" stroke="#000" strokeWidth={0.8} />
                  <circle cx={s.x} cy={s.y} r={BULLET_PX / 2 - 1.2} fill="#1a1a1a" />
                </g>
              ))}
            </svg>

            {/* Diopter sight */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: sight.x,
                top: sight.y,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div
                className="rounded-full border-2"
                style={{
                  width: 38,
                  height: 38,
                  borderColor: inPerfectWindow ? "var(--gold)" : "rgba(0,0,0,0.55)",
                  boxShadow: inPerfectWindow
                    ? "0 0 0 6px rgba(220,180,60,0.25), inset 0 0 0 1px rgba(255,255,255,0.4)"
                    : "0 0 0 2px rgba(255,255,255,0.5), inset 0 0 0 1px rgba(255,255,255,0.4)",
                  background: "transparent",
                }}
              />
              <div
                className="absolute top-1/2 left-1/2 rounded-full"
                style={{
                  width: 2,
                  height: 2,
                  background: inPerfectWindow ? "var(--gold)" : "rgba(0,0,0,0.8)",
                  transform: "translate(-50%,-50%)",
                }}
              />
            </div>
          </div>

          {/* Perfect 10.9 overlay */}
          <AnimatePresence>
            {perfect && (
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0, scale: 1.2 }}
                transition={{ type: "spring", stiffness: 220, damping: 18 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="bg-[var(--navy-deep)]/90 backdrop-blur-sm border-y-4 border-primary px-16 py-8">
                  <div className="text-[10px] tracking-[0.5em] text-primary font-bold mb-2">
                    INNER TEN
                  </div>
                  <div className="text-7xl font-black tracking-tight text-primary">
                    PERFECT 10.9
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom range HUD */}
          <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between text-xs font-mono">
            <div className="bg-[var(--navy-deep)]/90 px-3 py-2 text-foreground border-l-2 border-primary">
              <div className="text-[9px] tracking-widest text-muted-foreground">BREATH</div>
              <div className="font-bold">
                {holding ? (inPerfectWindow ? "HOLD · OPTIMAL" : "OVER-HOLD") : "BREATHE"}
              </div>
            </div>
            <div className="bg-[var(--navy-deep)]/90 px-3 py-2 text-foreground border-r-2 border-primary text-right">
              <div className="text-[9px] tracking-widest text-muted-foreground">FATIGUE</div>
              <div className="w-32 h-1.5 bg-[var(--navy-mid)] mt-1 overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${fatiguePct}%`,
                    background:
                      fatiguePct > 70 ? "oklch(0.6 0.24 27)" : "var(--gold)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Scoreboard */}
        <aside className="bg-[var(--navy-mid)] border-l border-border flex flex-col">
          <div className="px-5 py-4 border-b border-border bg-[var(--navy-deep)]">
            <div className="text-[10px] tracking-[0.4em] text-muted-foreground mb-2">
              LEADERBOARD · FINAL
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-12 bg-gradient-to-b from-sky-400 via-yellow-400 to-yellow-400 rounded-sm border border-border flex items-center justify-center text-xs">
                <span className="text-yellow-700 font-black">★</span>
              </div>
              <div className="flex-1">
                <div className="text-[10px] tracking-widest text-muted-foreground">RANK 1</div>
                <div className="font-bold text-base">YOU</div>
              </div>
              <div className="px-2 py-1 bg-primary text-primary-foreground text-xs font-black tracking-wider">
                KAZ
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-[10px] tracking-widest text-muted-foreground">TOTAL</span>
              <span className="text-4xl font-black text-primary font-mono tabular-nums">
                {total.toFixed(1)}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm font-mono">
              <thead className="bg-[var(--navy-deep)]/60 sticky top-0">
                <tr className="text-[10px] tracking-widest text-muted-foreground">
                  <th className="text-left px-4 py-2 font-semibold">#</th>
                  <th className="text-left px-2 py-2 font-semibold">CTRY</th>
                  <th className="text-right px-4 py-2 font-semibold">SCORE</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => {
                  const shot = shots[i];
                  return (
                    <tr
                      key={i}
                      className={`border-b border-border/40 ${
                        shot ? "bg-[var(--navy-mid)]" : "bg-[var(--navy-mid)]/40"
                      } ${shot?.score === 10.9 ? "bg-primary/10" : ""}`}
                    >
                      <td className="px-4 py-2 text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-2 py-2 font-bold text-primary">KAZ</td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums font-bold ${
                          shot?.score === 10.9
                            ? "text-primary"
                            : shot
                              ? "text-foreground"
                              : "text-muted-foreground/40"
                        }`}
                      >
                        {shot ? shot.score.toFixed(1) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border p-4 space-y-3 bg-[var(--navy-deep)]">
            <div className="text-[10px] leading-relaxed text-muted-foreground tracking-wide">
              <div className="text-foreground font-bold mb-1 tracking-widest">CONTROLS</div>
              MOUSE — AIM · CLICK — FIRE · SPACE — HOLD BREATH (3s optimal window)
            </div>
            {shots.length >= 10 && (
              <button
                onClick={reset}
                className="w-full bg-primary text-primary-foreground font-bold tracking-widest text-sm py-3 hover:bg-[var(--gold-bright)] transition-colors"
              >
                NEW MATCH
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
