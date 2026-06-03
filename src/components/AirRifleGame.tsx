import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// ============================================================
// Disciplines
// ============================================================
type DisciplineId = "ar10" | "rifle50" | "ap10" | "rfp25" | "boar";

type Discipline = {
  id: DisciplineId;
  name: string;
  short: string;
  caption: string;
  sight: "diopter" | "open";
  // physics
  amplitude: number;       // base sway
  pulseAmp: number;        // heartbeat impulse
  jitter: number;          // micro jitter
  wind: number;            // slow random drift speed
  dampenFocus: number;     // multiplier when holding RMB in window (lower = better)
  // target geometry
  targetPx: number;        // total svg size
  ringMm: number[];        // mm radii of rings 10..1
  mmToPx: number;          // scale
  bulletMm: number;        // pellet diameter
  blackRingFromIdx: number; // ring index (0=10) where black starts
  shotSound: "air" | "rim";
};

const DISCIPLINES: Discipline[] = [
  {
    id: "ar10",
    name: "Винтовка 10м",
    short: "10m AIR RIFLE",
    caption: "ISSF Air Rifle · диоптр · тяжёлая восьмёрка",
    sight: "diopter",
    amplitude: 24,
    pulseAmp: 12,
    jitter: 3,
    wind: 0,
    dampenFocus: 0.2,
    targetPx: 520,
    ringMm: [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5],
    mmToPx: 520 / 2 / 45.5,
    bulletMm: 4.5,
    blackRingFromIdx: 6, // rings 10..4 inside black? we'll use ring idx >= 4 (i.e. <=6 ring number)
    shotSound: "air",
  },
  {
    id: "boar",
    name: "Бегущий кабан 10м",
    short: "10m RUNNING TARGET",
    caption: "ISSF Running Target · движущаяся мишень · упреждение",
    sight: "diopter",
    amplitude: 22,
    pulseAmp: 10,
    jitter: 3,
    wind: 0,
    dampenFocus: 0.22,
    targetPx: 520,
    ringMm: [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5],
    mmToPx: 520 / 2 / 45.5,
    bulletMm: 4.5,
    blackRingFromIdx: 6,
    shotSound: "air",
  },
  {
    id: "rifle50",
    name: "Винтовка 50м",
    short: "50m RIFLE .22LR",
    caption: "Smallbore .22LR · диоптр · инерция + ветер",
    sight: "diopter",
    amplitude: 30,
    pulseAmp: 14,
    jitter: 4,
    wind: 0.6,
    dampenFocus: 0.25,
    targetPx: 520,
    ringMm: [0.5, 8, 16, 24, 32, 40, 48, 56, 64, 72], // approximated
    mmToPx: 520 / 2 / 72,
    bulletMm: 5.6,
    blackRingFromIdx: 6,
    shotSound: "rim",
  },
  {
    id: "ap10",
    name: "Пистолет 10м",
    short: "10m AIR PISTOL",
    caption: "Air Pistol · открытый прицел · резкий тремор",
    sight: "open",
    amplitude: 48,
    pulseAmp: 18,
    jitter: 5,
    wind: 0,
    dampenFocus: 0.45,
    targetPx: 520,
    ringMm: [6, 14.5, 23, 31.5, 40, 48.5, 57, 65.5, 74, 82.5],
    mmToPx: 520 / 2 / 82.5,
    bulletMm: 4.5,
    blackRingFromIdx: 4, // rings 6..1 white/larger black
    shotSound: "air",
  },
  {
    id: "rfp25",
    name: "Пистолет 25м",
    short: "25m RAPID FIRE",
    caption: "Rapid Fire Pistol · открытый прицел · хаотичные рывки",
    sight: "open",
    amplitude: 56,
    pulseAmp: 22,
    jitter: 9,
    wind: 0.4,
    dampenFocus: 0.5,
    targetPx: 520,
    ringMm: [10, 25, 40, 55, 70, 85, 100, 115, 130, 145],
    mmToPx: 520 / 2 / 145,
    bulletMm: 5.6,
    blackRingFromIdx: 4,
    shotSound: "rim",
  },
];

// ============================================================
// Score
// ============================================================
function computeDecimalScore(distPx: number, d: Discipline): number {
  if (distPx <= 1.5) return 10.9;
  const distMm = distPx / d.mmToPx;
  const ringStep = (d.ringMm[1] - d.ringMm[0]); // mm per ring (approx)
  const maxMm = d.ringMm[9];
  if (distMm >= maxMm) return 0;
  // map: distMm=0 -> 10.9; distMm = ring9 = (idx 0)=0.5mm -> 10.x
  // We compute as: score = 10.9 - (distMm / ringStep) * 1.0 (per ring)
  const score = 10.9 - (distMm / ringStep);
  return Math.max(0, Math.round(score * 10) / 10);
}

function computeIntegerScore(distPx: number, d: Discipline): number {
  const distMm = distPx / d.mmToPx;
  for (let i = 0; i < 10; i++) {
    if (distMm <= d.ringMm[i]) return 10 - i;
  }
  return 0;
}

// ============================================================
// Career Mode
// ============================================================
type CareerLevel = {
  id: 1 | 2 | 3;
  name: string;
  short: string;
  description: string;
  disciplineId: DisciplineId;
  shots: number;
  winScore: number;
  scoring: "integer" | "decimal";
  moving: boolean;
  hardcore: boolean;
};

const CAREER_LEVELS: CareerLevel[] = [
  {
    id: 1, name: "Клубный дебют", short: "L1 · INTEGER",
    description: "Винтовка 10м. Только целые очки. 10 выстрелов. Цель: набрать 95+.",
    disciplineId: "ar10", shots: 10, winScore: 95, scoring: "integer", moving: false, hardcore: false,
  },
  {
    id: 2, name: "Олимпийский отбор · Бегущий кабан", short: "L2 · RUNNING TARGET",
    description: "Движущаяся мишень. Десятые. 10 выстрелов. Цель: 96.0+.",
    disciplineId: "boar", shots: 10, winScore: 96.0, scoring: "decimal", moving: true, hardcore: false,
  },
  {
    id: 3, name: "Олимпийское Золото", short: "L3 · HARDCORE 50M",
    description: "Винтовка 50м. Сильный ветер + макс. дрожание. 10 выстрелов. Цель: 104.5+.",
    disciplineId: "rifle50", shots: 10, winScore: 104.5, scoring: "decimal", moving: false, hardcore: true,
  },
];
const CAREER_WIN_BONUS = 2000;

function timeBonusForShot(s: number): number {
  if (s === 10.9) return 8;
  if (s >= 10.0) return 4;
  if (s >= 9.0) return 2;
  return 0;
}
function creditsForShot(s: number): number {
  if (s === 10.9) return 500;
  if (s >= 10.0) return 100;
  if (s >= 9.0) return 50;
  return 0;
}

// ============================================================
// Audio (real MP3 files)
// ============================================================
const SOUND_URLS = {
  shotAir: "https://assets.mixkit.co/active_storage/sfx/1670/1670-preview.mp3",
  shotRim: "https://assets.mixkit.co/active_storage/sfx/1678/1678-preview.mp3",
  boltOpen: "https://assets.mixkit.co/active_storage/sfx/1124/1124-preview.mp3",
  boltClose: "https://assets.mixkit.co/active_storage/sfx/1118/1118-preview.mp3",
  chime: "https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3",
  crowd: "https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3",
  purchase: "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3",
  emptyClick: "https://assets.mixkit.co/active_storage/sfx/2778/2778-preview.mp3",
  gameOver: "https://assets.mixkit.co/active_storage/sfx/2952/2952-preview.mp3",
} as const;

function makeAudio(url: string, volume = 1) {
  if (typeof Audio === "undefined") return null;
  const a = new Audio(url);
  a.preload = "auto";
  a.volume = volume;
  return a;
}

const A = {
  shotAir: makeAudio(SOUND_URLS.shotAir, 0.7),
  shotRim: makeAudio(SOUND_URLS.shotRim, 0.75),
  boltOpen: makeAudio(SOUND_URLS.boltOpen, 0.8),
  boltClose: makeAudio(SOUND_URLS.boltClose, 0.85),
  chime: makeAudio(SOUND_URLS.chime, 0.6),
  crowd: makeAudio(SOUND_URLS.crowd, 0.7),
  purchase: makeAudio(SOUND_URLS.purchase, 0.5),
  emptyClick: makeAudio(SOUND_URLS.emptyClick, 0.5),
  gameOver: makeAudio(SOUND_URLS.gameOver, 0.7),
};

function playSfx(a: HTMLAudioElement | null) {
  if (!a) return;
  try {
    const clone = a.cloneNode(true) as HTMLAudioElement;
    clone.volume = a.volume;
    void clone.play().catch(() => {});
  } catch {/* ignore */}
}

// ============================================================
// Skins & Upgrades
// ============================================================
type Skin = {
  id: string; name: string; price: number;
  ring: string; dot: string; glow?: string; goldHalo?: boolean;
};
const SKINS: Skin[] = [
  { id: "default", name: "Стандартный спорт", price: 0, ring: "rgba(10,10,10,0.9)", dot: "rgba(0,0,0,0.95)" },
  { id: "carbon", name: "Спортивный Карбон", price: 1500, ring: "#3a3f47", dot: "#1a1d22",
    glow: "inset 0 0 0 1px rgba(120,130,140,0.4)" },
  { id: "chrome", name: "Олимпийский Хром", price: 3500, ring: "#e8edf2", dot: "#9aa3ad",
    glow: "0 0 6px rgba(220,230,240,0.7), inset 0 0 0 1px rgba(255,255,255,0.9)" },
  { id: "gold", name: "Золото Чемпиона", price: 7000, ring: "#f0c14a", dot: "#8a6a18",
    glow: "0 0 8px rgba(240,200,80,0.85), inset 0 0 0 1px rgba(255,230,140,0.9)", goldHalo: true },
];

type Upgrade = { id: string; name: string; desc: string; price: number };
const UPGRADES: Upgrade[] = [
  { id: "jacket", name: "Спортивный костюм", desc: "Снижает амплитуду дрожания прицела на 20% во всех дисциплинах.", price: 2500 },
  { id: "glove",  name: "Перчатка стрелка", desc: "Уменьшает резкие рывки от сердцебиения на 30%.", price: 4000 },
  { id: "premium",name: "Премиум Оптика / Анатом. рукоятка", desc: "Эффективная задержка дыхания 3 → 5 секунд.", price: 6000 },
];

// ============================================================
// Persistence
// ============================================================
const LS_KEY = "air-rifle-progress-v2";
type Progress = {
  credits: number;
  owned: string[];
  upgrades: string[];
  equipped: string;
  totalScore: number;
  perfectTens: number;
  careerCompleted: number; // highest completed career level (0..3)
};
function loadProgress(): Progress {
  const def: Progress = { credits: 0, owned: ["default"], upgrades: [], equipped: "default", totalScore: 0, perfectTens: 0, careerCompleted: 0 };
  if (typeof window === "undefined") return def;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw);
    return {
      credits: Number(p.credits) || 0,
      owned: Array.isArray(p.owned) && p.owned.includes("default") ? p.owned : ["default", ...(p.owned || [])],
      upgrades: Array.isArray(p.upgrades) ? p.upgrades : [],
      equipped: typeof p.equipped === "string" ? p.equipped : "default",
      totalScore: Number(p.totalScore) || 0,
      perfectTens: Number(p.perfectTens) || 0,
      careerCompleted: Math.max(0, Math.min(3, Number(p.careerCompleted) || 0)),
    };
  } catch { return def; }
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {}
}

// ============================================================
// Component
// ============================================================
const START_TIME = 30;

type Phase = "menu" | "playing" | "gameover";
type ShotRecord = { n: number; score: number; discipline: string; id: number };
type Hole = { x: number; y: number; score: number; id: number; gold: boolean };

export default function AirRifleGame() {
  const arenaRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [discipline, setDiscipline] = useState<Discipline>(DISCIPLINES[0]);

  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [sight, setSight] = useState({ x: 0, y: 0 });
  const sightRef = useRef({ x: 0, y: 0 });

  const [holes, setHoles] = useState<Hole[]>([]);
  const [shotHistory, setShotHistory] = useState<ShotRecord[]>([]);

  const [holding, setHolding] = useState(false);
  const [holdStart, setHoldStart] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(true);
  const [reloading, setReloading] = useState(false);

  const [perfect, setPerfect] = useState(false);
  const [perfectCount, setPerfectCount] = useState(0);
  const [totalShots, setTotalShots] = useState(0);
  const [lastShot, setLastShot] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  const [timeLeft, setTimeLeft] = useState(START_TIME);

  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<"upgrades" | "skins">("upgrades");

  // Career mode
  const [mode, setMode] = useState<"quick" | "career">("quick");
  const [careerLevel, setCareerLevel] = useState<CareerLevel | null>(null);
  const [careerResult, setCareerResult] = useState<{ won: boolean; score: number; level: CareerLevel } | null>(null);
  const [targetOffsetX, setTargetOffsetX] = useState(0);
  const targetOffsetRef = useRef(0);
  const boarRunRef = useRef(-260); // starts off-screen left; set on level start

  const tRef = useRef(0);
  const holeIdRef = useRef(0);
  const historyListRef = useRef<HTMLDivElement>(null);

  const equippedSkin = useMemo(
    () => SKINS.find((s) => s.id === progress.equipped) ?? SKINS[0],
    [progress.equipped],
  );
  const hasUpgrade = (id: string) => progress.upgrades.includes(id);
  const holdWindow = hasUpgrade("premium") ? 5 : 3;

  // Auth + Cloud sync
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const hydratedRef = useRef(false);

  // Responsive arena scale (landscape phones / small heights)
  const [arenaScale, setArenaScale] = useState(1);
  useEffect(() => {
    const recompute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isLandscapePhone = vh <= 500 && vw > vh;
      const topbarH = isLandscapePhone ? 40 : 52;
      const sidebarW = vw >= 1024 ? (isLandscapePhone ? 220 : 360) : 0;
      const padding = isLandscapePhone ? 24 : 64;
      const availW = vw - sidebarW - padding;
      const availH = vh - topbarH - padding;
      const s = Math.min(1, availW / 520, availH / 520);
      setArenaScale(Math.max(0.35, s));
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, []);


  // Load profile from cloud when user logs in
  useEffect(() => {
    if (!user) { hydratedRef.current = false; return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("credits, total_score, perfect_tens, skins, upgrades, equipped_skin")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const skinsList = Array.isArray(data.skins) ? (data.skins as string[]) : ["default"];
      const upgradesList = Array.isArray(data.upgrades) ? (data.upgrades as string[]) : [];
      setProgress((prev) => ({
        credits: data.credits ?? 0,
        owned: skinsList.includes("default") ? skinsList : ["default", ...skinsList],
        upgrades: upgradesList,
        equipped: data.equipped_skin ?? "default",
        totalScore: Number(data.total_score) || 0,
        perfectTens: data.perfect_tens ?? 0,
        careerCompleted: prev.careerCompleted,
      }));
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Persist locally + to cloud (debounced)
  useEffect(() => {
    saveProgress(progress);
    if (!user || !hydratedRef.current) return;
    const t = setTimeout(() => {
      supabase
        .from("profiles")
        .update({
          credits: progress.credits,
          total_score: progress.totalScore,
          perfect_tens: progress.perfectTens,
          skins: progress.owned,
          upgrades: progress.upgrades,
          equipped_skin: progress.equipped,
        })
        .eq("user_id", user.id)
        .then(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [progress, user]);

  // Mouse tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rect = arenaRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const size = discipline.targetPx;
      const scaleX = size / rect.width;
      const scaleY = size / rect.height;
      setMouse({
        x: Math.max(0, Math.min(size, (e.clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(size, (e.clientY - rect.top) * scaleY)),
      });
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const rect = arenaRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const size = discipline.targetPx;
      setMouse({
        x: Math.max(0, Math.min(size, (t.clientX - rect.left) * (size / rect.width))),
        y: Math.max(0, Math.min(size, (t.clientY - rect.top) * (size / rect.height))),
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [discipline]);


  // RMB safety
  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (e.button === 2) { setHolding(false); setHoldStart(null); }
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Reload
  const reload = useCallback(() => {
    if (loaded || reloading || phase !== "playing") return;
    setReloading(true);
    playSfx(A.boltOpen);
    // On Running Boar: reloading instantly resets the target back to the left start
    if (mode === "career" && careerLevel?.moving) {
      const startX = -discipline.targetPx * 0.5;
      boarRunRef.current = startX;
      targetOffsetRef.current = startX;
      setTargetOffsetX(startX);
    }
    setTimeout(() => {
      playSfx(A.boltClose);
      setTimeout(() => {
        setLoaded(true);
        setReloading(false);
      }, 180);
    }, 300);
  }, [loaded, reloading, phase, mode, careerLevel, discipline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") reload();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reload]);

  // Auto-scroll history to bottom on new shot
  useEffect(() => {
    if (historyListRef.current) {
      historyListRef.current.scrollTop = historyListRef.current.scrollHeight;
    }
  }, [shotHistory.length]);

  // Game timer (only in quick mode)
  useEffect(() => {
    if (phase !== "playing" || mode === "career") return;
    const t = setInterval(() => {
      setTimeLeft((tl) => {
        if (tl <= 0.1) {
          clearInterval(t);
          return 0;
        }
        return +(tl - 0.1).toFixed(2);
      });
    }, 100);
    return () => clearInterval(t);
  }, [phase, mode]);

  // Game over trigger (quick mode only — by time)
  useEffect(() => {
    if (phase === "playing" && mode === "quick" && timeLeft <= 0) {
      setPhase("gameover");
      playSfx(A.gameOver);
    }
  }, [timeLeft, phase, mode]);

  // Physics
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    let windX = 0, windY = 0;
    let windTimer = 0;
    let windTargetX = 0, windTargetY = 0;

    const moving = !!(mode === "career" && careerLevel?.moving);
    const hardcore = !!(mode === "career" && careerLevel?.hardcore);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tRef.current += dt;
      const t = tRef.current;
      const d = discipline;

      let dampen = 1;
      if (holding && holdStart) {
        const heldFor = (now - holdStart) / 1000;
        if (heldFor < holdWindow) dampen = d.dampenFocus;
        else dampen = 1.7; // overheld fatigue
      }

      const jacketMul = hasUpgrade("jacket") ? 0.8 : 1;
      const gloveMul  = hasUpgrade("glove")  ? 0.7 : 1;

      const hardcoreAmpMul = hardcore ? 1.6 : 1;
      const baseAmp = d.amplitude * jacketMul * hardcoreAmpMul;
      let swayX: number, swayY: number;
      if (d.sight === "diopter") {
        swayX = Math.sin(t * 1.8) * baseAmp + Math.sin(t * 4.2) * baseAmp * 0.35;
        swayY = Math.sin(t * 3.6) * baseAmp * 0.55 + Math.cos(t * 2.1) * baseAmp * 0.4;
      } else {
        swayX = Math.sin(t * 2.4) * baseAmp * 0.9 + Math.sin(t * 5.7) * baseAmp * 0.5;
        swayY = Math.cos(t * 2.9) * baseAmp * 0.9 + Math.sin(t * 6.3) * baseAmp * 0.4;
      }

      if (d.id === "rfp25" && Math.random() < 0.04) {
        swayX += (Math.random() - 0.5) * baseAmp * 1.2;
        swayY += (Math.random() - 0.5) * baseAmp * 1.2;
      }

      const beatPhase = (t % 0.75) / 0.75;
      const pulse = Math.exp(-Math.pow((beatPhase - 0.1) * 9, 2)) * d.pulseAmp * gloveMul;
      const pulseX = pulse * Math.sin(t * 13);
      const pulseY = pulse * Math.cos(t * 11);

      const jitter = d.jitter;
      const jx = (Math.random() - 0.5) * jitter;
      const jy = (Math.random() - 0.5) * jitter;

      // Wind drift (50m / 25m / hardcore L3)
      const effectiveWind = hardcore ? Math.max(d.wind, 0.6) * 1.8 : d.wind;
      if (effectiveWind > 0) {
        windTimer -= dt;
        if (windTimer <= 0) {
          windTimer = 1.5 + Math.random() * 2;
          const ang = Math.random() * Math.PI * 2;
          windTargetX = Math.cos(ang) * effectiveWind * 14;
          windTargetY = Math.sin(ang) * effectiveWind * 14;
        }
        windX += (windTargetX - windX) * dt * 1.2;
        windY += (windTargetY - windY) * dt * 1.2;
      }

      const ox = (swayX + pulseX + jx) * dampen + windX;
      const oy = (swayY + pulseY + jy) * dampen + windY;

      const size = d.targetPx;
      const next = {
        x: Math.max(0, Math.min(size, mouse.x + ox)),
        y: Math.max(0, Math.min(size, mouse.y + oy)),
      };
      sightRef.current = next;
      setSight(next);

      // Running Boar: strictly horizontal left-to-right pass at constant velocity.
      // Y axis is locked. On reaching the right edge target instantly resets to the left.
      if (moving) {
        const startX = -size * 0.5;
        const endX = size * 0.5;
        const duration = 4.5; // seconds to cross the arena
        const speed = (endX - startX) / duration;
        let off = boarRunRef.current + speed * dt;
        if (off > endX) off = startX;
        boarRunRef.current = off;
        targetOffsetRef.current = off;
        setTargetOffsetX(off);
      } else if (targetOffsetRef.current !== 0) {
        boarRunRef.current = 0;
        targetOffsetRef.current = 0;
        setTargetOffsetX(0);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, holding, holdStart, mouse, discipline, progress.upgrades, holdWindow, mode, careerLevel]);

  // Fire
  const fire = useCallback(() => {
    if (phase !== "playing") return;
    if (!loaded || reloading) {
      playSfx(A.emptyClick);
      return;
    }
    const d = discipline;
    playSfx(d.shotSound === "air" ? A.shotAir : A.shotRim);
    setLoaded(false);
    const center = d.targetPx / 2;
    const hitX = sightRef.current.x;
    const hitY = sightRef.current.y;
    const offX = targetOffsetRef.current;
    // hit relative to current target center
    const dx = hitX - (center + offX);
    const dy = hitY - center;
    const distPx = Math.hypot(dx, dy);

    const useInteger = mode === "career" && careerLevel?.scoring === "integer";
    const scRaw = useInteger ? computeIntegerScore(distPx, d) : computeDecimalScore(distPx, d);
    const sc = useInteger ? scRaw : +scRaw.toFixed(1);

    const id = ++holeIdRef.current;
    const gold = !!equippedSkin.goldHalo;
    // store hole in target-local space so it moves with target
    setHoles((h) => [...h, { x: hitX - offX, y: hitY, score: sc, id, gold }]);
    if (gold) {
      setTimeout(() => {
        setHoles((h) => h.map((hh) => (hh.id === id ? { ...hh, gold: false } : hh)));
      }, 1000);
    }

    const shotNum = totalShots + 1;
    setTotalShots(shotNum);
    setLastShot(sc);
    setScore((s) => +(s + sc).toFixed(1));
    setShotHistory((h) => [...h, { n: shotNum, score: sc, discipline: d.short, id }]);

    // Time bonus — only in quick mode
    if (mode === "quick") {
      const bonus = timeBonusForShot(sc);
      if (bonus > 0) setTimeLeft((t) => Math.min(120, +(t + bonus).toFixed(2)));
    }

    const earned = creditsForShot(sc);
    const gotPerfect = useInteger ? sc === 10 : sc === 10.9;
    setProgress((p) => ({
      ...p,
      credits: p.credits + earned,
      totalScore: +(p.totalScore + sc).toFixed(1),
      perfectTens: p.perfectTens + (gotPerfect ? 1 : 0),
    }));

    if (gotPerfect) {
      setPerfectCount((c) => c + 1);
      playSfx(A.chime);
      playSfx(A.crowd);
      setPerfect(true);
      setTimeout(() => setPerfect(false), 1800);
      const rect = arenaRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = (rect.left + hitX) / window.innerWidth;
        const cy = (rect.top + hitY) / window.innerHeight;
        confetti({
          particleCount: 140, spread: 110, startVelocity: 55,
          origin: { x: cx, y: cy },
          colors: ["#f0c14a", "#ffe28a", "#ffffff", "#3b6fa0"], ticks: 220,
        });
        confetti({
          particleCount: 80, spread: 70, startVelocity: 35,
          origin: { x: cx, y: cy },
          colors: ["#f0c14a", "#ffffff"],
        });
      }
    }
    setHolding(false);
    setHoldStart(null);

    // Career: end of level when shots limit reached
    if (mode === "career" && careerLevel && shotNum >= careerLevel.shots) {
      const finalScore = +(score + sc).toFixed(1);
      const won = finalScore >= careerLevel.winScore;
      setTimeout(() => {
        setCareerResult({ won, score: finalScore, level: careerLevel });
        setPhase("gameover");
        if (won) {
          playSfx(A.crowd);
          setProgress((p) => ({
            ...p,
            credits: p.credits + CAREER_WIN_BONUS,
            careerCompleted: Math.max(p.careerCompleted, careerLevel.id),
          }));
          confetti({
            particleCount: 220, spread: 140, startVelocity: 60,
            origin: { x: 0.5, y: 0.5 },
            colors: ["#f0c14a", "#ffe28a", "#ffffff", "#3b6fa0"],
          });
        } else {
          playSfx(A.gameOver);
        }
      }, 600);
    }
  }, [phase, loaded, reloading, discipline, equippedSkin, totalShots, mode, careerLevel, score]);

  // ----- actions -----
  const startMatch = (d: Discipline) => {
    setMode("quick");
    setCareerLevel(null);
    setCareerResult(null);
    setDiscipline(d);
    setPhase("playing");
    setHoles([]);
    setShotHistory([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setTimeLeft(START_TIME);
    setLoaded(true);
    setReloading(false);
    setShopOpen(false);
    targetOffsetRef.current = 0;
    setTargetOffsetX(0);
  };

  const startCareerLevel = (lvl: CareerLevel) => {
    const d = DISCIPLINES.find((x) => x.id === lvl.disciplineId) ?? DISCIPLINES[0];
    setMode("career");
    setCareerLevel(lvl);
    setCareerResult(null);
    setDiscipline(d);
    setPhase("playing");
    setHoles([]);
    setShotHistory([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setTimeLeft(999);
    setLoaded(true);
    setReloading(false);
    setShopOpen(false);
    boarRunRef.current = -d.targetPx * 0.5;
    targetOffsetRef.current = boarRunRef.current;
    setTargetOffsetX(boarRunRef.current);
  };

  const backToMenu = () => {
    setPhase("menu");
    setHoles([]);
    setCareerResult(null);
  };

  const resetTarget = () => {
    setHoles([]);
  };


  const buySkin = (s: Skin) => {
    if (progress.owned.includes(s.id) || progress.credits < s.price) return;
    playSfx(A.purchase);
    setProgress((p) => ({ ...p, credits: p.credits - s.price, owned: [...p.owned, s.id], equipped: s.id }));
  };
  const equipSkin = (s: Skin) => {
    if (!progress.owned.includes(s.id)) return;
    setProgress((p) => ({ ...p, equipped: s.id }));
  };
  const buyUpgrade = (u: Upgrade) => {
    if (progress.upgrades.includes(u.id) || progress.credits < u.price) return;
    playSfx(A.purchase);
    setProgress((p) => ({ ...p, credits: p.credits - u.price, upgrades: [...p.upgrades, u.id] }));
  };

  const holdTime = holding && holdStart ? (performance.now() - holdStart) / 1000 : 0;
  const inFocus = holding && holdTime < holdWindow;
  const overHold = holding && holdTime >= holdWindow;
  const timeCritical = timeLeft <= 10;

  return (
    <div className="min-h-screen bg-background text-foreground select-none overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-[var(--navy-mid)] px-3 py-2 md:px-6 md:py-3 gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
          <span className="text-xs font-bold tracking-[0.3em] text-muted-foreground">LIVE</span>
          <span className="text-xs font-semibold tracking-widest text-foreground">
            {phase === "menu" ? "ОЛИМПИЙСКИЙ ТИР · ВЫБОР ДИСЦИПЛИНЫ" : discipline.short + " · OLYMPIC RANGE"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          {phase === "playing" && mode === "quick" && (
            <div className={`px-2 py-0.5 border ${timeCritical ? "border-destructive text-destructive animate-pulse" : "border-primary text-primary"}`}>
              <span className="text-muted-foreground mr-2">ВРЕМЯ</span>
              <span className="font-bold tabular-nums">{timeLeft.toFixed(1)}s</span>
            </div>
          )}
          {phase === "playing" && mode === "career" && careerLevel && (
            <div className="px-2 py-0.5 border border-primary text-primary">
              <span className="text-muted-foreground mr-2">ВЫСТРЕЛ</span>
              <span className="font-bold tabular-nums">{totalShots}/{careerLevel.shots}</span>
              <span className="text-muted-foreground ml-2">ЦЕЛЬ</span>
              <span className="font-bold tabular-nums ml-1">{careerLevel.winScore}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground mr-2">SCORE</span>
            <span className="font-bold text-primary tabular-nums">{score.toFixed(1)}</span>
          </div>
          <div>
            <span className="text-muted-foreground mr-2">CR</span>
            <span className="font-bold text-[var(--gold-bright)] tabular-nums">{progress.credits}</span>
          </div>
          {phase === "playing" && (
            <button
              onClick={backToMenu}
              className="border border-border px-3 py-1.5 hover:bg-secondary transition-colors tracking-widest"
            >
              МЕНЮ
            </button>
          )}
          <button
            onClick={() => setShopOpen(true)}
            className="bg-primary text-primary-foreground font-bold tracking-widest px-3 py-1.5 hover:bg-[var(--gold-bright)] transition-colors"
          >
            МАГАЗИН
          </button>
          {mounted ? (
            <Link
              to={user ? "/profile" : "/auth"}
              className="border border-[var(--gold-bright)] text-[var(--gold-bright)] font-bold tracking-widest px-3 py-1.5 hover:bg-[var(--gold-bright)] hover:text-[var(--navy-deep)] transition-colors"
            >
              {user ? "ПРОФИЛЬ" : "ВОЙТИ"}
            </Link>
          ) : (
            <div className="w-20 h-7 border border-border/40" />
          )}
        </div>
      </div>

      {/* MENU */}
      {phase === "menu" && (
        <DisciplineMenu
          onPick={startMatch}
          onPickCareer={startCareerLevel}
          credits={progress.credits}
          careerCompleted={progress.careerCompleted}
        />
      )}

      {/* GAMEPLAY */}
      {phase !== "menu" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0">
          {/* Range */}
          <div className="relative flex items-center justify-center bg-gradient-to-b from-[#e8eaee] to-[#c8ccd2] p-2 md:p-8 min-h-[calc(100svh-52px)] overflow-hidden">
            <div className="absolute top-2 left-2 right-2 md:top-4 md:left-4 md:right-4 flex items-center justify-between text-[10px] md:text-xs font-mono pointer-events-auto z-10">
              <div className="bg-[var(--navy-deep)]/90 px-2 py-1 md:px-3 md:py-1.5 text-foreground border-l-2 border-primary">
                <span className="text-[9px] tracking-widest text-muted-foreground mr-2 hidden sm:inline">ДИСЦИПЛИНА</span>
                <span className="font-bold">{discipline.short}</span>
              </div>
              <button
                onClick={resetTarget}
                title="Сбросить пробоины (счет и время сохраняются)"
                className="bg-[var(--navy-deep)]/90 hover:bg-[var(--navy-mid)] px-2 py-1 md:px-3 md:py-1.5 border-r-2 border-primary text-foreground font-bold tracking-widest text-[10px] md:text-[11px] flex items-center gap-2"
              >
                <span>👁</span> <span className="hidden sm:inline">СБРОСИТЬ МИШЕНЬ</span><span className="sm:hidden">СБРОС</span>
              </button>
            </div>

            <div
              ref={arenaRef}
              onMouseDown={(e) => {
                if (phase !== "playing") return;
                if (e.button === 0) fire();
                else if (e.button === 2) {
                  setHolding(true);
                  setHoldStart(performance.now());
                }
              }}
              onMouseUp={(e) => {
                if (e.button === 2) { setHolding(false); setHoldStart(null); }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className="relative cursor-none shadow-2xl"
              style={{
                width: discipline.targetPx * arenaScale,
                height: discipline.targetPx * arenaScale,
                background: "#f4f4ef",
              }}
            >
              <div
                style={{
                  width: discipline.targetPx,
                  height: discipline.targetPx,
                  transform: `scale(${arenaScale})`,
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              >

              <TargetSvg discipline={discipline} holes={holes} offsetX={targetOffsetX} />

              {/* Sight */}
              {phase === "playing" && (
                discipline.sight === "diopter" ? (
                  <DiopterSight
                    x={sight.x} y={sight.y}
                    inFocus={inFocus} overHold={overHold}
                    skin={equippedSkin}
                  />
                ) : (
                  <OpenSight
                    x={sight.x} y={sight.y}
                    inFocus={inFocus} overHold={overHold}
                    skin={equippedSkin}
                  />
                )
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
                      INNER TEN · +500 CR · +8s
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
                <div className={`font-bold ${reloading ? "text-[var(--gold-bright)] animate-pulse" : loaded ? "text-[var(--gold-bright)]" : "text-destructive"}`}>
                  {reloading ? "◐ RELOADING…" : loaded ? "● LOADED" : "○ EMPTY · [R]"}
                </div>
              </div>
              <div className="bg-[var(--navy-deep)]/90 px-3 py-2 text-foreground border-r-2 border-primary text-right">
                <div className="text-[9px] tracking-widest text-muted-foreground">BREATH ({holdWindow}s)</div>
                <div className={`font-bold ${inFocus ? "text-[var(--gold-bright)]" : overHold ? "text-destructive" : ""}`}>
                  {holding ? (inFocus ? `ФОКУС · ${(holdWindow - holdTime).toFixed(2)}s` : "ПЕРЕДЕРЖАНО!") : "ДЫХАНИЕ"}
                </div>
              </div>
            </div>

            {/* GAME OVER */}
            {phase === "gameover" && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--navy-deep)]/95 backdrop-blur-sm z-40">
                <div className="text-center space-y-6 px-8 max-w-lg">
                  {careerResult ? (
                    <>
                      <div className={`text-[10px] tracking-[0.5em] font-bold ${careerResult.won ? "text-[var(--gold-bright)]" : "text-destructive"}`}>
                        {careerResult.level.short}
                      </div>
                      <div className="text-5xl font-black tracking-tight">
                        {careerResult.won ? "УРОВЕНЬ ПРОЙДЕН!" : "ПРОВАЛ"}
                      </div>
                      {careerResult.won && (
                        <div className="text-lg text-[var(--gold-bright)] font-bold tracking-wide">
                          + {CAREER_WIN_BONUS} КРЕДИТОВ БОНУСА
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-4 text-sm font-mono">
                        <Stat label="SCORE" value={careerResult.score.toFixed(1)} />
                        <Stat label="ЦЕЛЬ" value={careerResult.level.winScore} />
                        <Stat label="ВЫСТРЕЛОВ" value={totalShots} />
                      </div>
                      {!careerResult.won && (
                        <div className="text-xs text-muted-foreground">
                          Не хватило {(careerResult.level.winScore - careerResult.score).toFixed(1)} очка. Попробуйте ещё раз.
                        </div>
                      )}
                      <div className="flex gap-3 justify-center pt-2 flex-wrap">
                        <button
                          onClick={() => startCareerLevel(careerResult.level)}
                          className="bg-primary text-primary-foreground font-bold tracking-widest px-8 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                        >
                          ПОВТОРИТЬ
                        </button>
                        <button
                          onClick={backToMenu}
                          className="border border-primary text-primary font-bold tracking-widest px-6 py-3 hover:bg-primary/10 transition-colors"
                        >
                          К МЕНЮ КАРЬЕРЫ
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] tracking-[0.5em] text-destructive font-bold">TIME UP</div>
                      <div className="text-6xl font-black tracking-tight">GAME OVER</div>
                      <div className="grid grid-cols-3 gap-4 text-sm font-mono">
                        <Stat label="SCORE" value={score.toFixed(1)} />
                        <Stat label="SHOTS" value={totalShots} />
                        <Stat label="10.9s" value={perfectCount} />
                      </div>
                      <div className="flex gap-3 justify-center pt-2">
                        <button
                          onClick={() => startMatch(discipline)}
                          className="bg-primary text-primary-foreground font-bold tracking-widest px-8 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                        >
                          ПОВТОРИТЬ
                        </button>
                        <button
                          onClick={backToMenu}
                          className="border border-primary text-primary font-bold tracking-widest px-6 py-3 hover:bg-primary/10 transition-colors"
                        >
                          ДИСЦИПЛИНЫ
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Dashboard */}
          <aside className="bg-[var(--navy-mid)] border-l border-border flex flex-col lg:max-h-[calc(100svh-52px)]">
            <div className="px-5 py-4 border-b border-border bg-[var(--navy-deep)]">
              <div className="text-[10px] tracking-[0.4em] text-muted-foreground mb-3">LIVE DASHBOARD</div>

              {mode === "career" && careerLevel ? (
                <div className="mb-3 px-3 py-3 border border-primary/50 bg-[var(--navy-mid)]/60">
                  <div className="text-[9px] tracking-widest text-muted-foreground">КАРЬЕРА · {careerLevel.short}</div>
                  <div className="text-2xl font-black font-mono tabular-nums leading-tight text-primary mt-1">
                    {totalShots}<span className="text-base text-muted-foreground">/{careerLevel.shots}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Цель: <span className="text-[var(--gold-bright)] font-bold">{careerLevel.winScore}</span> · Текущий: <span className="text-foreground font-bold">{score.toFixed(1)}</span>
                  </div>
                </div>
              ) : (
                <div className={`mb-3 px-3 py-3 border ${timeCritical ? "border-destructive" : "border-primary/50"} bg-[var(--navy-mid)]/60`}>
                  <div className="text-[9px] tracking-widest text-muted-foreground">TIME REMAINING</div>
                  <div className={`text-4xl font-black font-mono tabular-nums leading-none ${timeCritical ? "text-destructive animate-pulse" : "text-primary"}`}>
                    {timeLeft.toFixed(1)}<span className="text-base text-muted-foreground">s</span>
                  </div>
                </div>
              )}

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

            <div className="px-4 py-3 text-[10px] tracking-widest text-muted-foreground border-b border-border/40 flex items-center justify-between">
              <span>ИСТОРИЯ ВЫСТРЕЛОВ</span>
              <span className="text-muted-foreground/70">{shotHistory.length}</span>
            </div>
            <div ref={historyListRef} className="flex-1 overflow-y-auto font-mono text-sm">
              {shotHistory.length === 0 && (
                <div className="px-4 py-4 text-muted-foreground/60 text-xs italic">— нет выстрелов —</div>
              )}
              {shotHistory.map((h) => (
                <div
                  key={h.id}
                  className={`flex items-center justify-between px-4 py-1.5 border-b border-border/30 ${
                    h.score === 10.9 ? "bg-primary/10" : "bg-transparent"
                  }`}
                >
                  <span className="text-muted-foreground text-xs">#{h.n}</span>
                  <span className="text-[10px] text-muted-foreground/70 tracking-widest">{h.discipline}</span>
                  <span
                    className={`tabular-nums font-bold ${
                      h.score === 10.9 ? "text-primary"
                      : h.score >= 9 ? "text-foreground"
                      : "text-muted-foreground"
                    }`}
                  >
                    {h.score.toFixed(1)}
                    {timeBonusForShot(h.score) > 0 && (
                      <span className="ml-2 text-[10px] text-[var(--gold-bright)]">+{timeBonusForShot(h.score)}s</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-border p-4 space-y-1 bg-[var(--navy-deep)] text-[10px] leading-relaxed text-muted-foreground tracking-wide">
              <div className="text-foreground font-bold mb-1 tracking-widest">УПРАВЛЕНИЕ</div>
              [ПКМ] Задержка дыхания ({holdWindow}s) · [ЛКМ] Выстрел · [R] Перезарядка
              <div className="mt-2 text-foreground/80">
                Бонус: 10.9 = +8s · 10.x = +4s · 9.x = +2s
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* SHOP MODAL */}
      <AnimatePresence>
        {shopOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[var(--navy-deep)]/95 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-4xl bg-[var(--navy-mid)] border border-border shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border bg-[var(--navy-deep)] px-6 py-4">
                <div className="flex items-center gap-4">
                  <div className="text-2xl font-black tracking-tight">МАГАЗИН</div>
                  <div className="text-xs tracking-[0.3em] text-muted-foreground">OLYMPIC SHOP</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="font-mono text-sm">
                    <span className="text-muted-foreground mr-2">БАЛАНС</span>
                    <span className="font-bold text-[var(--gold-bright)] tabular-nums">{progress.credits} CR</span>
                  </div>
                  <button onClick={() => setShopOpen(false)} className="text-muted-foreground hover:text-foreground text-xl px-2">✕</button>
                </div>
              </div>

              <div className="flex border-b border-border bg-[var(--navy-deep)]">
                <TabBtn active={shopTab === "upgrades"} onClick={() => setShopTab("upgrades")}>УЛУЧШЕНИЯ</TabBtn>
                <TabBtn active={shopTab === "skins"} onClick={() => setShopTab("skins")}>СКИНЫ ПРИЦЕЛА</TabBtn>
              </div>

              <div className="p-6 max-h-[60vh] overflow-auto">
                {shopTab === "upgrades" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {UPGRADES.map((u) => {
                      const owned = hasUpgrade(u.id);
                      const canAfford = progress.credits >= u.price;
                      return (
                        <div key={u.id} className="bg-[var(--navy-deep)] border border-border/60 p-4 flex flex-col gap-3">
                          <div>
                            <div className="text-base font-bold tracking-wide">{u.name}</div>
                            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{u.desc}</div>
                          </div>
                          {owned ? (
                            <button disabled className="mt-auto bg-[var(--gold)] text-primary-foreground font-bold tracking-widest py-2">✓ КУПЛЕНО</button>
                          ) : (
                            <button
                              disabled={!canAfford} onClick={() => buyUpgrade(u)}
                              className={`mt-auto font-bold tracking-widest py-2 transition-colors ${
                                canAfford ? "bg-primary text-primary-foreground hover:bg-[var(--gold-bright)]"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                              }`}
                            >КУПИТЬ · {u.price} CR</button>
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
                        <div key={s.id} className="bg-[var(--navy-deep)] border border-border/60 p-4 flex flex-col gap-3">
                          <div className="flex items-center gap-4">
                            <div className="rounded-full shrink-0" style={{
                              width: 48, height: 48, borderStyle: "solid", borderWidth: 3,
                              borderColor: s.ring,
                              boxShadow: s.glow ?? "0 0 0 1px rgba(255,255,255,0.08)",
                            }} />
                            <div className="flex-1">
                              <div className="text-base font-bold tracking-wide">{s.name}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {s.goldHalo ? "Золотой ореол вокруг каждой пробоины."
                                  : s.id === "default" ? "Базовый прицел стрелка."
                                  : "Косметический скин прицела."}
                              </div>
                            </div>
                          </div>
                          {equipped ? (
                            <button disabled className="mt-auto bg-[var(--gold)] text-primary-foreground font-bold tracking-widest py-2">✓ ЭКИПИРОВАН</button>
                          ) : owned ? (
                            <button onClick={() => equipSkin(s)} className="mt-auto bg-primary text-primary-foreground font-bold tracking-widest py-2 hover:bg-[var(--gold-bright)] transition-colors">ВЫБРАТЬ</button>
                          ) : (
                            <button
                              disabled={!canAfford} onClick={() => buySkin(s)}
                              className={`mt-auto font-bold tracking-widest py-2 transition-colors ${
                                canAfford ? "bg-primary text-primary-foreground hover:bg-[var(--gold-bright)]"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                              }`}
                            >КУПИТЬ · {s.price} CR</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-border px-6 py-3 bg-[var(--navy-deep)] flex justify-between items-center">
                <div className="text-[10px] text-muted-foreground tracking-widest">
                  10.9 = +500 CR / +8s · 10.x = +100 CR / +4s · 9.x = +50 CR / +2s
                </div>
                <button
                  onClick={() => setShopOpen(false)}
                  className="bg-primary text-primary-foreground font-bold tracking-widest px-6 py-2 hover:bg-[var(--gold-bright)] transition-colors"
                >ЗАКРЫТЬ</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function DisciplineMenu({
  onPick, onPickCareer, credits, careerCompleted,
}: {
  onPick: (d: Discipline) => void;
  onPickCareer: (lvl: CareerLevel) => void;
  credits: number;
  careerCompleted: number;
}) {
  const [tab, setTab] = useState<"quick" | "career">("quick");
  return (
    <div className="min-h-[calc(100vh-52px)] flex flex-col items-center justify-start px-6 py-10 bg-[radial-gradient(ellipse_at_top,_var(--navy-mid),_var(--navy-deep))]">
      <div className="text-[10px] tracking-[0.5em] text-primary font-bold mb-2">OLYMPIC SHOOTING SIMULATOR</div>
      <h1 className="text-4xl md:text-6xl font-black tracking-tight text-center mb-2">
        {tab === "quick" ? "ВЫБОР ДИСЦИПЛИНЫ" : "РЕЖИМ КАРЬЕРЫ"}
      </h1>
      <div className="text-xs text-muted-foreground mb-6 font-mono">
        Баланс: <span className="text-[var(--gold-bright)] font-bold">{credits} CR</span>
      </div>

      <div className="flex gap-2 mb-8">
        <button
          onClick={() => setTab("quick")}
          className={`px-5 py-2 font-bold tracking-widest text-xs transition-colors border ${
            tab === "quick" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >БЫСТРАЯ ИГРА</button>
        <button
          onClick={() => setTab("career")}
          className={`px-5 py-2 font-bold tracking-widest text-xs transition-colors border ${
            tab === "career" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >КАРЬЕРА</button>
      </div>

      {tab === "quick" && (
        <>
          <div className="text-sm text-muted-foreground mb-6 text-center">
            Старт: <span className="text-foreground font-mono">30 секунд</span>. Точные выстрелы добавляют время.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl w-full">
            {DISCIPLINES.map((d) => (
              <button
                key={d.id}
                onClick={() => onPick(d)}
                className="group text-left bg-[var(--navy-mid)] border border-border hover:border-primary transition-colors p-5 flex gap-4 items-start"
              >
                <div className="shrink-0 w-20 h-20 rounded-full flex items-center justify-center bg-[var(--navy-deep)] border-2 border-primary/50 group-hover:border-primary">
                  <MiniTargetIcon disciplineId={d.id} />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] tracking-[0.3em] text-primary font-bold">{d.short}</div>
                  <div className="text-xl font-black tracking-tight">{d.name}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{d.caption}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <MiniStat label="ПРИЦЕЛ" v={d.sight === "diopter" ? "ДИОПТР" : "ОТКР."} />
                    <MiniStat label="ТРЕМОР" v={d.amplitude < 30 ? "СРЕДН." : d.amplitude < 50 ? "СИЛЬН." : "ХАОС"} />
                    <MiniStat label="ВЕТЕР" v={d.wind > 0 ? "ДА" : "—"} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === "career" && (
        <>
          <div className="text-sm text-muted-foreground mb-6 text-center max-w-2xl">
            Три уникальных уровня. У каждого свои правила подсчёта и механики. Уровни открываются последовательно. За победу: <span className="text-[var(--gold-bright)] font-bold">+{CAREER_WIN_BONUS} CR</span>.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl w-full">
            {CAREER_LEVELS.map((lvl) => {
              const unlocked = lvl.id === 1 || careerCompleted >= lvl.id - 1;
              const done = careerCompleted >= lvl.id;
              return (
                <button
                  key={lvl.id}
                  disabled={!unlocked}
                  onClick={() => onPickCareer(lvl)}
                  className={`group text-left border p-5 flex flex-col gap-3 transition-colors min-h-[260px] ${
                    !unlocked
                      ? "bg-[var(--navy-deep)]/60 border-border/40 opacity-50 cursor-not-allowed"
                      : done
                        ? "bg-[var(--navy-mid)] border-[var(--gold-bright)] hover:border-primary"
                        : "bg-[var(--navy-mid)] border-border hover:border-primary"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] tracking-[0.3em] text-primary font-bold">{lvl.short}</div>
                    {done && <div className="text-[10px] font-bold text-[var(--gold-bright)] tracking-widest">✓ ПРОЙДЕН</div>}
                    {!unlocked && <div className="text-[10px] font-bold text-muted-foreground tracking-widest">🔒 ЗАКРЫТ</div>}
                  </div>
                  <div className="text-xl font-black tracking-tight">УРОВЕНЬ {lvl.id}</div>
                  <div className="text-base font-bold">{lvl.name}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed flex-1">{lvl.description}</div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono mt-auto">
                    <MiniStat label="ВЫСТРЕЛЫ" v={String(lvl.shots)} />
                    <MiniStat label="ОЧКИ" v={lvl.scoring === "integer" ? "ЦЕЛЫЕ" : "10.x"} />
                    <MiniStat label="ЦЕЛЬ" v={String(lvl.winScore)} />
                  </div>
                  {!unlocked && (
                    <div className="text-[10px] text-muted-foreground text-center">
                      Пройдите уровень {lvl.id - 1}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-8 text-[10px] tracking-widest text-muted-foreground text-center max-w-xl">
        [ПКМ] Задержка дыхания · [ЛКМ] Выстрел (1 патрон) · [R] Перезарядка
      </div>
    </div>
  );
}

function MiniStat({ label, v }: { label: string; v: string }) {
  return (
    <div className="bg-[var(--navy-deep)] px-2 py-1 border border-border/40">
      <div className="text-[8px] tracking-widest text-muted-foreground">{label}</div>
      <div className="text-foreground font-bold">{v}</div>
    </div>
  );
}

function MiniTargetIcon({ disciplineId }: { disciplineId: DisciplineId }) {
  const blackR = disciplineId.startsWith("ap") || disciplineId === "rfp25" ? 22 : 14;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={24} cy={24} r={22} fill="#f4f4ef" stroke="#222" strokeWidth="1" />
      <circle cx={24} cy={24} r={blackR} fill="#0a0a0a" />
      <circle cx={24} cy={24} r={2} fill="#fff" />
    </svg>
  );
}

function TargetSvg({ discipline: d, holes, offsetX = 0 }: { discipline: Discipline; holes: Hole[]; offsetX?: number }) {
  const CENTER = d.targetPx / 2;
  const BULLET_PX = d.bulletMm * d.mmToPx;
  const blackR = d.ringMm[d.blackRingFromIdx] * d.mmToPx;
  return (
    <svg width={d.targetPx} height={d.targetPx} className="absolute inset-0">
      <g transform={`translate(${offsetX} 0)`}>

      {/* white outer rings */}
      {d.ringMm.map((mm, idx) => {
        if (idx <= d.blackRingFromIdx) return null;
        const r = mm * d.mmToPx;
        return <circle key={`o${idx}`} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#222" strokeWidth={1} />;
      })}
      {/* ring numbers on white */}
      {d.ringMm.map((mm, idx) => {
        if (idx <= d.blackRingFromIdx) return null;
        const r = (mm - (d.ringMm[1] - d.ringMm[0]) / 2) * d.mmToPx;
        const num = 10 - idx;
        return (
          <text key={`tn${idx}`} x={CENTER} y={CENTER + r + 4} textAnchor="middle"
            fontSize="10" fontWeight="bold" fill="#222">{num}</text>
        );
      })}
      {/* black bull */}
      <circle cx={CENTER} cy={CENTER} r={blackR} fill="#0a0a0a" />
      {/* inner rings (white strokes) */}
      {d.ringMm.map((mm, idx) => {
        if (idx > d.blackRingFromIdx) return null;
        if (idx === 0) return null;
        const r = mm * d.mmToPx;
        return <circle key={`i${idx}`} cx={CENTER} cy={CENTER} r={r} fill="none"
          stroke="#fff" strokeWidth={0.6} opacity={0.45} />;
      })}
      {/* black ring numbers */}
      {d.ringMm.map((mm, idx) => {
        if (idx > d.blackRingFromIdx) return null;
        if (idx === 0) return null;
        const r = (mm - (d.ringMm[1] - d.ringMm[0]) / 2) * d.mmToPx;
        const num = 10 - idx;
        return (
          <text key={`tb${idx}`} x={CENTER} y={CENTER + r + 4} textAnchor="middle"
            fontSize="9" fontWeight="bold" fill="#fff">{num}</text>
        );
      })}
      {/* center dot */}
      <circle cx={CENTER} cy={CENTER} r={0.8} fill="#fff" />

      {/* Holes */}
      {holes.map((h) => (
        <g key={h.id}>
          {h.gold && (
            <circle cx={h.x} cy={h.y} r={BULLET_PX / 2 + 6} fill="none" stroke="#f0c14a" strokeWidth={3} opacity={0.85}>
              <animate attributeName="opacity" from="1" to="0" dur="1s" fill="freeze" />
              <animate attributeName="r" from={BULLET_PX / 2 + 2} to={BULLET_PX / 2 + 14} dur="1s" fill="freeze" />
            </circle>
          )}
          <circle cx={h.x} cy={h.y} r={BULLET_PX / 2} fill="#fff" stroke="#000" strokeWidth={0.8} />
          <circle cx={h.x} cy={h.y} r={BULLET_PX / 2 - 1.2} fill="#1a1a1a" />
        </g>
      ))}
      </g>
    </svg>
  );
}

function DiopterSight({ x, y, inFocus, overHold, skin }:
  { x: number; y: number; inFocus: boolean; overHold: boolean; skin: Skin }) {
  const size = 38;
  return (
    <div className="absolute pointer-events-none" style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}>
      <div className="rounded-full" style={{
        width: size, height: size, borderStyle: "solid", borderWidth: 2.5,
        borderColor: inFocus ? "var(--gold)" : overHold ? "oklch(0.6 0.24 27)" : skin.ring,
        boxShadow: inFocus
          ? "0 0 0 6px rgba(220,180,60,0.25), inset 0 0 0 1px rgba(255,255,255,0.4)"
          : skin.glow ?? "0 0 0 2px rgba(255,255,255,0.4)",
        background: "transparent",
      }} />
    </div>
  );
}

function OpenSight({ x, y, inFocus, overHold, skin }:
  { x: number; y: number; inFocus: boolean; overHold: boolean; skin: Skin }) {
  const color = inFocus ? "var(--gold)" : overHold ? "oklch(0.6 0.24 27)" : skin.ring;
  return (
    <div className="absolute pointer-events-none" style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}>
      {/* front post */}
      <div style={{
        position: "absolute", left: -2, top: -16, width: 4, height: 22,
        background: color, boxShadow: skin.glow,
      }} />
      {/* rear notch (two posts) */}
      <div style={{
        position: "absolute", left: -22, top: 6, width: 14, height: 10,
        borderRight: `3px solid ${color}`,
      }} />
      <div style={{
        position: "absolute", left: 8, top: 6, width: 14, height: 10,
        borderLeft: `3px solid ${color}`,
      }} />
      {/* baseline */}
      <div style={{
        position: "absolute", left: -24, top: 14, width: 48, height: 2,
        background: color, opacity: 0.6,
      }} />
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[var(--navy-mid)]/60 border border-border/40 px-3 py-3">
      <div className="text-[9px] tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-black text-primary tabular-nums leading-none">{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-6 py-3 text-sm font-bold tracking-widest transition-colors border-b-2 ${
      active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
    }`}>{children}</button>
  );
}
