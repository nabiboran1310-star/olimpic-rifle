import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------- Constants ----------
const TARGET_SIZE = 520;
const CENTER = TARGET_SIZE / 2;
const RING_RADII_MM = [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5];
const MM_TO_PX = 230 / 45.5;
const BULLET_MM = 4.5;
const BULLET_PX = BULLET_MM * MM_TO_PX;
const HOLD_WINDOW = 1.5;

function computeDecimalScore(dx: number, dy: number): number {
  const distPx = Math.hypot(dx, dy);
  if (distPx <= 1.5) return 10.9;
  const distMm = distPx / MM_TO_PX;
  if (distMm >= 45.5) return 0;
  const score = 10.9 - distMm * 0.2;
  return Math.max(0, Math.round(score * 10) / 10);
}

function creditsForShot(s: number): number {
  if (s === 10.9) return 500;
  if (s >= 10.0) return 100;
  if (s >= 9.0) return 50;
  return 0;
}

// ---------- Audio ----------
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
  gain.gain.value = 0.55;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}
function playHeartbeat(intensity: number) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 60;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.1 + intensity * 0.1, ctx.currentTime + 0.02);
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
    gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + i * 0.08 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 1.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.08);
    osc.stop(ctx.currentTime + i * 0.08 + 1.5);
  });
}
function playReload() {
  const ctx = getCtx();
  const now = ctx.currentTime;
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
  mkClick(0, 1200, 0.08, 0.5);
  mkClick(0.18, 2400, 0.04, 0.4);
  mkClick(0.35, 900, 0.1, 0.55);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = 1800;
  osc.type = "triangle";
  g.gain.setValueAtTime(0, now + 0.35);
  g.gain.linearRampToValueAtTime(0.13, now + 0.36);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  osc.connect(g).connect(ctx.destination);
  osc.start(now + 0.35);
  osc.stop(now + 0.6);
}
function playEmptyClick() {
  const ctx = getCtx();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 220;
  o.type = "square";
  g.gain.setValueAtTime(0.12, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.1);
}
function playPurchase() {
  const ctx = getCtx();
  const now = ctx.currentTime;
  [660, 880, 1320].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, now + i * 0.06);
    g.gain.linearRampToValueAtTime(0.18, now + i * 0.06 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.06);
    o.stop(now + i * 0.06 + 0.5);
  });
}

// ---------- Skins & Upgrades ----------
type Skin = {
  id: string;
  name: string;
  price: number;
  ring: string; // CSS color for the ring
  dot: string;
  glow?: string; // optional inner glow
  goldHalo?: boolean;
};
const SKINS: Skin[] = [
  { id: "default", name: "Стандартный спорт", price: 0, ring: "rgba(10,10,10,0.85)", dot: "rgba(0,0,0,0.9)" },
  {
    id: "carbon",
    name: "Спортивный Карбон",
    price: 1500,
    ring: "#3a3f47",
    dot: "#1a1d22",
    glow: "inset 0 0 0 1px rgba(120,130,140,0.4)",
  },
  {
    id: "chrome",
    name: "Олимпийский Хром",
    price: 3500,
    ring: "#e8edf2",
    dot: "#9aa3ad",
    glow: "0 0 6px rgba(220,230,240,0.7), inset 0 0 0 1px rgba(255,255,255,0.9)",
  },
  {
    id: "gold",
    name: "Золото Чемпиона",
    price: 7000,
    ring: "#f0c14a",
    dot: "#8a6a18",
    glow: "0 0 8px rgba(240,200,80,0.85), inset 0 0 0 1px rgba(255,230,140,0.9)",
    goldHalo: true,
  },
];

type Upgrade = {
  id: string;
  name: string;
  desc: string;
  price: number;
};
const UPGRADES: Upgrade[] = [
  { id: "rifle", name: "Сбалансированная винтовка", desc: "Снижает базовое дрожание мушки на 15%.", price: 2500 },
  { id: "jacket", name: "Спортивная куртка стрелка", desc: "Уменьшает рывки от сердцебиения на 20%.", price: 4000 },
  { id: "diopter", name: "Элитный диоптр", desc: "Тоньше кольцо мушки + точка-ориентир в центре.", price: 6000 },
];

// ---------- Persistence ----------
const LS_KEY = "air-rifle-progress-v1";
type Progress = {
  credits: number;
  owned: string[]; // skin ids owned
  upgrades: string[]; // upgrade ids owned
  equipped: string;
};
function loadProgress(): Progress {
  if (typeof window === "undefined") return { credits: 0, owned: ["default"], upgrades: [], equipped: "default" };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw 0;
    const p = JSON.parse(raw);
    return {
      credits: Number(p.credits) || 0,
      owned: Array.isArray(p.owned) && p.owned.includes("default") ? p.owned : ["default", ...(p.owned || [])],
      upgrades: Array.isArray(p.upgrades) ? p.upgrades : [],
      equipped: typeof p.equipped === "string" ? p.equipped : "default",
    };
  } catch {
    return { credits: 0, owned: ["default"], upgrades: [], equipped: "default" };
  }
}
function saveProgress(p: Progress) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {}
}

// ---------- Component ----------
export default function AirRifleGame() {
  const arenaRef = useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = useState({ x: CENTER, y: CENTER });
  const [sight, setSight] = useState({ x: CENTER, y: CENTER });
  const sightRef = useRef({ x: CENTER, y: CENTER });
  const [holes, setHoles] = useState<{ x: number; y: number; score: number; id: number; gold: boolean }[]>([]);
  const [holding, setHolding] = useState(false);
  const [holdStart, setHoldStart] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(true);
  const [perfect, setPerfect] = useState(false);

  const [perfectCount, setPerfectCount] = useState(0);
  const [totalShots, setTotalShots] = useState(0);
  const [lastShot, setLastShot] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [started, setStarted] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<"upgrades" | "skins">("upgrades");

  const lastHeartbeat = useRef(0);
  const tRef = useRef(0);
  const holeIdRef = useRef(0);

  const equippedSkin = useMemo(
    () => SKINS.find((s) => s.id === progress.equipped) ?? SKINS[0],
    [progress.equipped],
  );
  const hasUpgrade = (id: string) => progress.upgrades.includes(id);

  // Persist progress
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Mouse tracking (raw cursor)
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

  // Global RMB up safety
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

  // Reload via R
  const reload = useCallback(() => {
    if (loaded) return;
    playReload();
    setTimeout(() => setLoaded(true), 450);
  }, [loaded]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") reload();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reload]);

  // Physics — STATIC target, shaky sight following mouse
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tRef.current += dt;
      const t = tRef.current;

      let dampen = 1;
      if (holding && holdStart) {
        const heldFor = (now - holdStart) / 1000;
        if (heldFor < HOLD_WINDOW) dampen = 0.2;
        else dampen = 1.6;
      }

      // upgrades
      const rifleMul = hasUpgrade("rifle") ? 0.85 : 1;
      const jacketMul = hasUpgrade("jacket") ? 0.8 : 1;

      // figure-8 sway
      const baseAmp = 26 * rifleMul;
      const swayX = Math.sin(t * 1.8) * baseAmp + Math.sin(t * 4.2) * baseAmp * 0.35;
      const swayY = Math.sin(t * 3.6) * baseAmp * 0.55 + Math.cos(t * 2.1) * baseAmp * 0.4;

      // heartbeat micro-jerk: sharp impulse every ~0.7s
      const beatPhase = (t % 0.75) / 0.75;
      const pulse = Math.exp(-Math.pow((beatPhase - 0.1) * 9, 2)) * 12 * jacketMul;
      const pulseX = pulse * Math.sin(t * 13);
      const pulseY = pulse * Math.cos(t * 11);

      const jitter = 3 * rifleMul;
      const jx = (Math.random() - 0.5) * jitter;
      const jy = (Math.random() - 0.5) * jitter;

      const ox = (swayX + pulseX + jx) * dampen;
      const oy = (swayY + pulseY + jy) * dampen;

      const next = {
        x: Math.max(0, Math.min(TARGET_SIZE, mouse.x + ox)),
        y: Math.max(0, Math.min(TARGET_SIZE, mouse.y + oy)),
      };
      sightRef.current = next;
      setSight(next);

      // heartbeat sound
      const beatInterval = 0.75;
      if (now - lastHeartbeat.current > beatInterval * 1000) {
        lastHeartbeat.current = now;
        playHeartbeat(0.4);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [started, holding, holdStart, mouse, progress.upgrades]);

  const fire = useCallback(() => {
    if (!loaded) {
      playEmptyClick();
      return;
    }
    playCrack();
    setLoaded(false);
    const hitX = sightRef.current.x;
    const hitY = sightRef.current.y;
    const dx = hitX - CENTER;
    const dy = hitY - CENTER;
    const sc = computeDecimalScore(dx, dy);
    const id = ++holeIdRef.current;
    const gold = !!equippedSkin.goldHalo;
    setHoles((h) => [...h.slice(-30), { x: hitX, y: hitY, score: sc, id, gold }]);
    if (gold) {
      setTimeout(() => {
        setHoles((h) => h.map((hh) => (hh.id === id ? { ...hh, gold: false } : hh)));
      }, 1000);
    }
    setTotalShots((c) => c + 1);
    setLastShot(sc);
    setScore((s) => +(s + sc).toFixed(1));

    const earned = creditsForShot(sc);
    if (earned > 0) setProgress((p) => ({ ...p, credits: p.credits + earned }));

    if (sc === 10.9) {
      setPerfectCount((c) => c + 1);
      playChime();
      setPerfect(true);
      setTimeout(() => setPerfect(false), 1800);
    }
    setHolding(false);
    setHoldStart(null);
  }, [loaded, equippedSkin]);

  const startGame = () => {
    setStarted(true);
    setShopOpen(false);
    setHoles([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setLoaded(true);
    getCtx();
  };

  // Shop actions
  const buySkin = (s: Skin) => {
    if (progress.owned.includes(s.id) || progress.credits < s.price) return;
    playPurchase();
    setProgress((p) => ({
      ...p,
      credits: p.credits - s.price,
      owned: [...p.owned, s.id],
      equipped: s.id,
    }));
  };
  const equipSkin = (s: Skin) => {
    if (!progress.owned.includes(s.id)) return;
    setProgress((p) => ({ ...p, equipped: s.id }));
  };
  const buyUpgrade = (u: Upgrade) => {
    if (progress.upgrades.includes(u.id) || progress.credits < u.price) return;
    playPurchase();
    setProgress((p) => ({ ...p, credits: p.credits - u.price, upgrades: [...p.upgrades, u.id] }));
  };

  const holdTime = holding && holdStart ? (performance.now() - holdStart) / 1000 : 0;
  const inFocus = holding && holdTime < HOLD_WINDOW;
  const overHold = holding && holdTime >= HOLD_WINDOW;
  const sightRingSize = hasUpgrade("diopter") ? 32 : 38;
  const sightBorderW = hasUpgrade("diopter") ? 1.5 : 2.5;

  return (
    <div className="min-h-screen bg-background text-foreground select-none overflow-hidden">
      {/* Top broadcast bar */}
      <div className="flex items-center justify-between border-b border-border bg-[var(--navy-mid)] px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
          <span className="text-xs font-bold tracking-[0.3em] text-muted-foreground">LIVE</span>
          <span className="text-xs font-semibold tracking-widest text-foreground">
            10m AIR RIFLE · OLYMPIC RANGE
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-muted-foreground mr-2">SCORE</span>
            <span className="font-bold text-primary tabular-nums">{score.toFixed(1)}</span>
          </div>
          <div>
            <span className="text-muted-foreground mr-2">CR</span>
            <span className="font-bold text-[var(--gold-bright)] tabular-nums">{progress.credits}</span>
          </div>
          <button
            onClick={() => setShopOpen(true)}
            className="bg-primary text-primary-foreground font-bold tracking-widest px-3 py-1.5 hover:bg-[var(--gold-bright)] transition-colors"
          >
            МАГАЗИН
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-0">
        {/* Range */}
        <div className="relative flex items-center justify-center bg-gradient-to-b from-[#e8eaee] to-[#c8ccd2] p-8 min-h-[calc(100vh-52px)] overflow-hidden">
          <div
            ref={arenaRef}
            onMouseDown={(e) => {
              if (!started) return;
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
            style={{ width: TARGET_SIZE, height: TARGET_SIZE, background: "#f4f4ef" }}
          >
            {/* Target — STATIC */}
            <svg width={TARGET_SIZE} height={TARGET_SIZE} className="absolute inset-0">
              {[9, 8, 7].map((idx) => {
                const r = RING_RADII_MM[idx] * MM_TO_PX;
                return (
                  <circle key={idx} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#222" strokeWidth={1} />
                );
              })}
              {[9, 8, 7, 6].map((idx, i) => {
                const r = (RING_RADII_MM[idx] - 2.5) * MM_TO_PX;
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
                    {i + 1}
                  </text>
                );
              })}
              <circle cx={CENTER} cy={CENTER} r={RING_RADII_MM[6] * MM_TO_PX} fill="#0a0a0a" />
              {[5, 4, 3, 2].map((idx, i) => {
                const r = (RING_RADII_MM[idx] - 2.5) * MM_TO_PX;
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
                    {i + 5}
                  </text>
                );
              })}
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
              <circle cx={CENTER} cy={CENTER} r={0.6} fill="#fff" />

              {/* Bullet holes */}
              {holes.map((h) => (
                <g key={h.id}>
                  {h.gold && (
                    <circle
                      cx={h.x}
                      cy={h.y}
                      r={BULLET_PX / 2 + 6}
                      fill="none"
                      stroke="#f0c14a"
                      strokeWidth={3}
                      opacity={0.85}
                    >
                      <animate attributeName="opacity" from="1" to="0" dur="1s" fill="freeze" />
                      <animate attributeName="r" from={BULLET_PX / 2 + 2} to={BULLET_PX / 2 + 14} dur="1s" fill="freeze" />
                    </circle>
                  )}
                  <circle cx={h.x} cy={h.y} r={BULLET_PX / 2} fill="#fff" stroke="#000" strokeWidth={0.8} />
                  <circle cx={h.x} cy={h.y} r={BULLET_PX / 2 - 1.2} fill="#1a1a1a" />
                </g>
              ))}
            </svg>

            {/* Diopter sight — follows shaky position */}
            <div
              className="absolute pointer-events-none"
              style={{ left: sight.x, top: sight.y, transform: "translate(-50%, -50%)" }}
            >
              <div
                className="rounded-full"
                style={{
                  width: sightRingSize,
                  height: sightRingSize,
                  borderStyle: "solid",
                  borderWidth: sightBorderW,
                  borderColor: inFocus ? "var(--gold)" : overHold ? "oklch(0.6 0.24 27)" : equippedSkin.ring,
                  boxShadow: inFocus
                    ? "0 0 0 6px rgba(220,180,60,0.25), inset 0 0 0 1px rgba(255,255,255,0.4)"
                    : equippedSkin.glow ?? "0 0 0 2px rgba(255,255,255,0.4)",
                  background: "transparent",
                }}
              />
              {hasUpgrade("diopter") && (
                <div
                  className="absolute top-1/2 left-1/2 rounded-full"
                  style={{
                    width: 2,
                    height: 2,
                    background: inFocus ? "var(--gold)" : equippedSkin.dot,
                    transform: "translate(-50%,-50%)",
                  }}
                />
              )}
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
                    INNER TEN · +500 CR
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
                {loaded ? "● LOADED" : "○ EMPTY · Нажмите [R] для перезарядки"}
              </div>
            </div>
            <div className="bg-[var(--navy-deep)]/90 px-3 py-2 text-foreground border-r-2 border-primary text-right">
              <div className="text-[9px] tracking-widest text-muted-foreground">BREATH</div>
              <div
                className={`font-bold ${inFocus ? "text-[var(--gold-bright)]" : overHold ? "text-destructive" : ""}`}
              >
                {holding ? (inFocus ? `ФОКУС · ${(HOLD_WINDOW - holdTime).toFixed(2)}s` : "ПЕРЕДЕРЖАНО!") : "ДЫХАНИЕ"}
              </div>
            </div>
          </div>

          {/* Start overlay */}
          {!started && !shopOpen && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--navy-deep)]/90 backdrop-blur-sm z-40">
              <div className="text-center space-y-6 px-8 max-w-lg">
                <div className="text-[10px] tracking-[0.5em] text-primary font-bold">OLYMPIC TRAINING</div>
                <div className="text-5xl font-black tracking-tight">10m AIR RIFLE</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  Бесконечная тренировка концентрации.
                  <br />
                  <span className="text-foreground font-mono">[Удерживайте ПКМ]</span> Фокус/Дыхание ·{" "}
                  <span className="text-foreground font-mono">[ЛКМ]</span> Выстрел ·{" "}
                  <span className="text-foreground font-mono">[R]</span> Перезарядка
                </div>
                <div className="flex gap-3 justify-center pt-2">
                  <button
                    onClick={startGame}
                    className="bg-primary text-primary-foreground font-bold tracking-widest px-10 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                  >
                    НАЧАТЬ
                  </button>
                  <button
                    onClick={() => setShopOpen(true)}
                    className="border border-primary text-primary font-bold tracking-widest px-6 py-3 hover:bg-primary/10 transition-colors"
                  >
                    МАГАЗИН · {progress.credits} CR
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dashboard */}
        <aside className="bg-[var(--navy-mid)] border-l border-border flex flex-col">
          <div className="px-5 py-4 border-b border-border bg-[var(--navy-deep)]">
            <div className="text-[10px] tracking-[0.4em] text-muted-foreground mb-3">LIVE DASHBOARD</div>

            <div className="grid grid-cols-2 gap-3">
              <Metric label="PERFECT 10.9s" value={perfectCount} color="text-[var(--gold-bright)]" />
              <Metric label="TOTAL SHOTS" value={totalShots} color="text-foreground" />
              <Metric
                label="LAST SHOT"
                value={lastShot !== null ? lastShot.toFixed(1) : "—"}
                color={lastShot === 10.9 ? "text-[var(--gold-bright)]" : "text-foreground"}
              />
              <Metric label="TOTAL SCORE" value={score.toFixed(1)} color="text-primary" />
            </div>

            <div className="mt-3 bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
              <div className="text-[9px] tracking-widest text-muted-foreground mb-1">CREDITS</div>
              <div className="text-3xl font-black text-[var(--gold-bright)] font-mono tabular-nums leading-none">
                {progress.credits} <span className="text-sm text-muted-foreground">CR</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="px-4 py-3 text-[10px] tracking-widest text-muted-foreground border-b border-border/40">
              RECENT SHOTS
            </div>
            <table className="w-full text-sm font-mono">
              <tbody>
                {holes.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-muted-foreground/60 text-xs italic">— нет выстрелов —</td>
                  </tr>
                )}
                {[...holes]
                  .slice(-8)
                  .reverse()
                  .map((h, i) => (
                    <tr
                      key={h.id}
                      className={`border-b border-border/40 ${h.score === 10.9 ? "bg-primary/10" : "bg-[var(--navy-mid)]"}`}
                    >
                      <td className="px-4 py-2 text-muted-foreground">#{totalShots - i}</td>
                      <td className="px-2 py-2 font-bold text-primary">KAZ</td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums font-bold ${
                          h.score === 10.9
                            ? "text-primary"
                            : h.score >= 9
                              ? "text-foreground"
                              : "text-muted-foreground"
                        }`}
                      >
                        {h.score.toFixed(1)}
                        {creditsForShot(h.score) > 0 && (
                          <span className="ml-2 text-[10px] text-[var(--gold-bright)]">
                            +{creditsForShot(h.score)}
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
              [ПКМ] Фокус/Дыхание (окно 1.5с)
              <br />
              [ЛКМ] Выстрел · [R] Перезарядка
            </div>
          </div>
        </aside>
      </div>

      {/* SHOP MODAL */}
      <AnimatePresence>
        {shopOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[var(--navy-deep)]/95 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-4xl bg-[var(--navy-mid)] border border-border shadow-2xl"
            >
              {/* header */}
              <div className="flex items-center justify-between border-b border-border bg-[var(--navy-deep)] px-6 py-4">
                <div className="flex items-center gap-4">
                  <div className="text-2xl font-black tracking-tight">МАГАЗИН</div>
                  <div className="text-xs tracking-[0.3em] text-muted-foreground">OLYMPIC SHOP</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="font-mono text-sm">
                    <span className="text-muted-foreground mr-2">БАЛАНС</span>
                    <span className="font-bold text-[var(--gold-bright)] tabular-nums">
                      {progress.credits} CR
                    </span>
                  </div>
                  <button
                    onClick={() => setShopOpen(false)}
                    className="text-muted-foreground hover:text-foreground text-xl px-2"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* tabs */}
              <div className="flex border-b border-border bg-[var(--navy-deep)]">
                <TabBtn active={shopTab === "upgrades"} onClick={() => setShopTab("upgrades")}>
                  УЛУЧШЕНИЯ
                </TabBtn>
                <TabBtn active={shopTab === "skins"} onClick={() => setShopTab("skins")}>
                  СКИНЫ ПРИЦЕЛА
                </TabBtn>
              </div>

              {/* body */}
              <div className="p-6 max-h-[60vh] overflow-auto">
                {shopTab === "upgrades" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {UPGRADES.map((u) => {
                      const owned = hasUpgrade(u.id);
                      const canAfford = progress.credits >= u.price;
                      return (
                        <div
                          key={u.id}
                          className="bg-[var(--navy-deep)] border border-border/60 p-4 flex flex-col gap-3"
                        >
                          <div>
                            <div className="text-base font-bold tracking-wide">{u.name}</div>
                            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{u.desc}</div>
                          </div>
                          {owned ? (
                            <button
                              disabled
                              className="mt-auto bg-[var(--gold)] text-primary-foreground font-bold tracking-widest py-2"
                            >
                              ✓ КУПЛЕНО
                            </button>
                          ) : (
                            <button
                              disabled={!canAfford}
                              onClick={() => buyUpgrade(u)}
                              className={`mt-auto font-bold tracking-widest py-2 transition-colors ${
                                canAfford
                                  ? "bg-primary text-primary-foreground hover:bg-[var(--gold-bright)]"
                                  : "bg-muted text-muted-foreground cursor-not-allowed"
                              }`}
                            >
                              КУПИТЬ · {u.price} CR
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {shopTab === "skins" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {SKINS.map((s) => {
                      const owned = progress.owned.includes(s.id);
                      const equipped = progress.equipped === s.id;
                      const canAfford = progress.credits >= s.price;
                      return (
                        <div
                          key={s.id}
                          className="bg-[var(--navy-deep)] border border-border/60 p-4 flex flex-col gap-3"
                        >
                          <div className="flex items-center gap-4">
                            {/* preview */}
                            <div
                              className="rounded-full shrink-0"
                              style={{
                                width: 48,
                                height: 48,
                                borderStyle: "solid",
                                borderWidth: 3,
                                borderColor: s.ring,
                                boxShadow: s.glow ?? "0 0 0 1px rgba(255,255,255,0.08)",
                              }}
                            />
                            <div className="flex-1">
                              <div className="text-base font-bold tracking-wide">{s.name}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {s.goldHalo
                                  ? "Золотой ореол вокруг каждой пробоины."
                                  : s.id === "default"
                                    ? "Базовый прицел стрелка."
                                    : "Косметический скин кольца мушки."}
                              </div>
                            </div>
                          </div>
                          {equipped ? (
                            <button
                              disabled
                              className="mt-auto bg-[var(--gold)] text-primary-foreground font-bold tracking-widest py-2"
                            >
                              ✓ ЭКИПИРОВАН
                            </button>
                          ) : owned ? (
                            <button
                              onClick={() => equipSkin(s)}
                              className="mt-auto bg-primary text-primary-foreground font-bold tracking-widest py-2 hover:bg-[var(--gold-bright)] transition-colors"
                            >
                              ВЫБРАТЬ
                            </button>
                          ) : (
                            <button
                              disabled={!canAfford}
                              onClick={() => buySkin(s)}
                              className={`mt-auto font-bold tracking-widest py-2 transition-colors ${
                                canAfford
                                  ? "bg-primary text-primary-foreground hover:bg-[var(--gold-bright)]"
                                  : "bg-muted text-muted-foreground cursor-not-allowed"
                              }`}
                            >
                              КУПИТЬ · {s.price} CR
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-border px-6 py-3 bg-[var(--navy-deep)] flex justify-between items-center">
                <div className="text-[10px] text-muted-foreground tracking-widest">
                  10.9 = +500 CR · 10.0–10.8 = +100 CR · 9.0–9.9 = +50 CR
                </div>
                <button
                  onClick={() => {
                    setShopOpen(false);
                    if (!started) startGame();
                  }}
                  className="bg-primary text-primary-foreground font-bold tracking-widest px-6 py-2 hover:bg-[var(--gold-bright)] transition-colors"
                >
                  {started ? "ПРОДОЛЖИТЬ" : "НАЧАТЬ"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
      <div className="text-[9px] tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={`text-3xl font-black font-mono tabular-nums leading-none ${color}`}>{value}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 text-sm font-bold tracking-widest transition-colors border-b-2 ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
