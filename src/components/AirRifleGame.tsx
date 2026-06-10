import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CoachPanel } from "@/components/CoachPanel";
import { useTelemetryCoach } from "@/hooks/useTelemetryCoach";
import type { CoachMessage, CoachMessageType, CoachShotTelemetry } from "@/types/coach";

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
    caption: "ISSF Running Target · движущаяся мишень · стреляй чуть заранее",
    sight: "diopter",
    amplitude: 22,
    pulseAmp: 10,
    jitter: 3,
    wind: 0,
    dampenFocus: 0.22,
    targetPx: 450,
    ringMm: [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5],
    mmToPx: 450 / 2 / 45.5,
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
    caption: "Air Pistol · открытый прицел · прицел сильнее шатается",
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
  id: 1 | 2 | 3 | 4 | 5;
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

const CAREER_LEVEL_COUNT = 5;

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
    id: 3, name: "Пневматический пистолет", short: "L3 · AIR PISTOL",
    description: "Пистолет 10м. Открытый прицел. 10 выстрелов. Цель: 96.5+.",
    disciplineId: "ap10", shots: 10, winScore: 96.5, scoring: "decimal", moving: false, hardcore: false,
  },
  {
    id: 4, name: "Малокалиберная винтовка 50м", short: "L4 · 50M WIND",
    description: "Винтовка 50м. Ветер и инерция. 10 выстрелов. Цель: 103.5+.",
    disciplineId: "rifle50", shots: 10, winScore: 103.5, scoring: "decimal", moving: false, hardcore: true,
  },
  {
    id: 5, name: "Скоростной пистолет", short: "L5 · RAPID FIRE",
    description: "Пистолет 25м. Жесткий темп и открытый прицел. 10 выстрелов. Цель: 101.0+.",
    disciplineId: "rfp25", shots: 10, winScore: 101.0, scoring: "decimal", moving: false, hardcore: true,
  },
];
const CAREER_WIN_BONUS = 2000;

// ============================================================
// Olympic Finals Mode
// ============================================================
type Bot = {
  id: string;
  name: string;
  country: string;
  score: number;
  eliminated: boolean;
  favorite?: boolean;
};
const OLYMPIC_BOTS_INIT: Bot[] = [
  { id: "cooper",  name: "J. Cooper",  country: "USA", score: 0, eliminated: false, favorite: true  },
  { id: "chang",   name: "L. Chang",   country: "CHN", score: 0, eliminated: false, favorite: true  },
  { id: "rossi",   name: "M. Rossi",   country: "ITA", score: 0, eliminated: false },
  { id: "schmidt", name: "A. Schmidt", country: "GER", score: 0, eliminated: false },
  { id: "tanaka",  name: "K. Tanaka",  country: "JPN", score: 0, eliminated: false },
];
const OLYMPIC_TOTAL_SHOTS = 10;
const OLYMPIC_GOLD_BONUS = 5000;
// After shot N -> last-place participant is eliminated. (Player counts.)
const OLYMPIC_ELIM_SHOTS = new Set<number>([4, 6, 8]);

// ============================================================
// Daily Leaderboards
// ============================================================
type LeaderboardRankId = "rookie" | "starter" | "solid" | "pro" | "champion";
type DailyLeaderboardScore = { date: string; score: number };

const LEADERBOARD_RANKS: Array<{ id: LeaderboardRankId; name: string; subtitle: string; min: number; max: number }> = [
  { id: "rookie", name: "Новичок", subtitle: "первые стабильные серии", min: 88.0, max: 97.5 },
  { id: "starter", name: "Начинающий стрелок", subtitle: "уже держит темп", min: 94.0, max: 101.5 },
  { id: "solid", name: "Неплохой стрелок", subtitle: "борется за десятки", min: 98.0, max: 104.0 },
  { id: "pro", name: "Профи", subtitle: "почти без срывов", min: 102.0, max: 106.8 },
  { id: "champion", name: "Олимпийский чемпион", subtitle: "уровень финала", min: 105.0, max: 109.0 },
];
const LEADERBOARD_SHOTS = 10;

const CAREER_RANK_BY_LEVEL: Record<CareerLevel["id"], LeaderboardRankId> = {
  1: "rookie",
  2: "starter",
  3: "solid",
  4: "pro",
  5: "champion",
};

const SIM_PLAYER_NAMES = [
  "A. Volkov", "M. Sokolov", "D. Kim", "L. Novak", "S. Petrov", "K. Tanaka", "R. Weiss", "I. Morozov",
  "N. Orlov", "P. Jensen", "T. Larsen", "E. Rossi", "V. Smirnov", "H. Becker", "Y. Chen", "O. Koval",
] as const;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function localTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function leaderboardKey(date: string, disciplineId: DisciplineId, rankId: LeaderboardRankId) {
  return `${date}:${disciplineId}:${rankId}`;
}

function badgeIdFor(disciplineId: DisciplineId, rankId: LeaderboardRankId) {
  return `daily-1-${disciplineId}-${rankId}`;
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: string) {
  const x = Math.sin(hashString(seed)) * 10000;
  return x - Math.floor(x);
}

function dailySimScore(date: string, disciplineId: DisciplineId, rank: LeaderboardRankId, index: number) {
  const rankInfo = LEADERBOARD_RANKS.find((r) => r.id === rank) ?? LEADERBOARD_RANKS[0];
  const spread = rankInfo.max - rankInfo.min;
  const raw = rankInfo.min + seededUnit(`${date}:${disciplineId}:${rank}:${index}:score`) * spread;
  return +raw.toFixed(1);
}

function makeDailyLeaderboard(date: string, disciplineId: DisciplineId, rank: LeaderboardRankId, playerScore?: number) {
  const entries = Array.from({ length: 10 }, (_, index) => {
    const nameIndex = Math.floor(seededUnit(`${date}:${disciplineId}:${rank}:${index}:name`) * SIM_PLAYER_NAMES.length);
    return {
      id: `sim-${index}`,
      name: SIM_PLAYER_NAMES[(nameIndex + index) % SIM_PLAYER_NAMES.length],
      score: dailySimScore(date, disciplineId, rank, index),
      simulated: true,
    };
  });

  if (typeof playerScore === "number") {
    entries.push({ id: "player", name: "Вы", score: playerScore, simulated: false });
  }

  return entries.sort((a, b) => b.score - a.score).map((entry, index) => ({ ...entry, place: index + 1 }));
}

function badgeLabel(id: string) {
  const [, , disciplineId, rankId] = id.split("-");
  const discipline = DISCIPLINES.find((d) => d.id === disciplineId);
  const rank = LEADERBOARD_RANKS.find((r) => r.id === rankId);
  if (!discipline || !rank) return "Значок мастера";
  return `${rank.name} · ${discipline.name}`;
}

function rollBotShot(favorite: boolean): number {
  // Realistic Olympic final shot: 9.6..10.9 step 0.1.
  // Favorites lean toward 10.4..10.9 about ~65% of the time.
  if (favorite && Math.random() < 0.65) {
    const steps = Math.round((10.9 - 10.4) * 10);
    return +(10.4 + Math.round(Math.random() * steps) / 10).toFixed(1);
  }
  const steps = Math.round((10.9 - 9.6) * 10);
  return +(9.6 + Math.round(Math.random() * steps) / 10).toFixed(1);
}

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

// Sight-turret click (synthesized — tiny metallic tick)
let _audioCtx: AudioContext | null = null;
function playTurretClick() {
  if (typeof window === "undefined") return;
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    _audioCtx = _audioCtx ?? new Ctor();
    const ctx = _audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(2400, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.04);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.06);
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
  { id: "default", name: "Стандартный спорт", price: 0, ring: "#1a202c", dot: "#1a202c",
    glow: "0 0 0 1px rgba(255,255,255,0.55)" },
  { id: "carbon", name: "Спортивный Карбон", price: 1500, ring: "#3a3f47", dot: "#1a1d22",
    glow: "inset 0 0 0 1px rgba(120,130,140,0.4)" },
  { id: "chrome", name: "Олимпийский Хром", price: 3500, ring: "#e8edf2", dot: "#9aa3ad",
    glow: "0 0 6px rgba(220,230,240,0.7), inset 0 0 0 1px rgba(255,255,255,0.9)" },
  { id: "gold", name: "Золото Чемпиона", price: 7000, ring: "#f0c14a", dot: "#8a6a18",
    glow: "0 0 8px rgba(240,200,80,0.85), inset 0 0 0 1px rgba(255,230,140,0.9)", goldHalo: true },
];

type DailyGiftReward =
  | { type: "credits"; amount: number }
  | { type: "skin"; skinId: string; fallbackCredits: number };

const DAILY_GIFTS: Array<{ day: number; title: string; reward: DailyGiftReward }> = [
  { day: 1, title: "Разминка", reward: { type: "credits", amount: 100 } },
  { day: 2, title: "Спокойная рука", reward: { type: "credits", amount: 150 } },
  { day: 3, title: "Точный взгляд", reward: { type: "credits", amount: 250 } },
  { day: 4, title: "Хороший темп", reward: { type: "credits", amount: 400 } },
  { day: 5, title: "Серия пошла", reward: { type: "credits", amount: 600 } },
  { day: 6, title: "Почти финал", reward: { type: "credits", amount: 900 } },
  { day: 7, title: "Подарок недели", reward: { type: "skin", skinId: "chrome", fallbackCredits: 1500 } },
];

type DailyGiftState = {
  lastClaimDate: string | null;
  streakDay: number;
};

function normalizeGiftState(value: unknown): DailyGiftState {
  if (!value || typeof value !== "object") return { lastClaimDate: null, streakDay: 0 };
  const state = value as Partial<DailyGiftState>;
  return {
    lastClaimDate: typeof state.lastClaimDate === "string" ? state.lastClaimDate : null,
    streakDay: Math.max(0, Math.min(7, Number(state.streakDay) || 0)),
  };
}

function nextGiftDay(state: DailyGiftState, today = localTodayKey()) {
  if (state.lastClaimDate === today) return Math.max(1, state.streakDay || 1);
  const yesterday = addDaysKey(today, -1);
  if (state.lastClaimDate === yesterday) {
    return state.streakDay >= 7 ? 1 : Math.max(1, state.streakDay + 1);
  }
  return 1;
}

function rewardLabel(reward: DailyGiftReward) {
  if (reward.type === "credits") return `+${reward.amount} CR`;
  const skin = SKINS.find((item) => item.id === reward.skinId);
  return skin ? `Скин: ${skin.name}` : "Скин прицела";
}

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
  careerCompleted: number; // highest completed career level (0..5)
  dailyScores: Record<string, DailyLeaderboardScore>;
  badges: string[];
  dailyGift: DailyGiftState;
};
function loadProgress(): Progress {
  const def: Progress = {
    credits: 0,
    owned: ["default"],
    upgrades: [],
    equipped: "default",
    totalScore: 0,
    perfectTens: 0,
    careerCompleted: 0,
    dailyScores: {},
    badges: [],
    dailyGift: { lastClaimDate: null, streakDay: 0 },
  };
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
      careerCompleted: Math.max(0, Math.min(CAREER_LEVEL_COUNT, Number(p.careerCompleted) || 0)),
      dailyScores: p.dailyScores && typeof p.dailyScores === "object" ? p.dailyScores : {},
      badges: Array.isArray(p.badges) ? p.badges : [],
      dailyGift: normalizeGiftState(p.dailyGift),
    };
  } catch { return def; }
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {}
}

const RANGE_GUIDE_KEY_PREFIX = "range-guide-seen-v2";

function rangeGuideKey(disciplineId: DisciplineId) {
  return `${RANGE_GUIDE_KEY_PREFIX}-${disciplineId}`;
}

function shouldShowRangeGuide(disciplineId: DisciplineId) {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(rangeGuideKey(disciplineId)) !== "1";
}

function markRangeGuideSeen(disciplineId: DisciplineId) {
  if (typeof window === "undefined") return;
  localStorage.setItem(rangeGuideKey(disciplineId), "1");
}

// ============================================================
// Component
// ============================================================
const START_TIME = 30;

type Phase = "menu" | "playing" | "gameover";
type SessionMode = "sighting" | "match";
type ShotRecord = { n: number; score: number; discipline: string; id: number; sighting?: boolean };
type Hole = { x: number; y: number; score: number; id: number; gold: boolean; sighting?: boolean };

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
  const [lastCoachShot, setLastCoachShot] = useState<CoachShotTelemetry | null>(null);
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachSessionId, setCoachSessionId] = useState(0);
  const [showRangeGuide, setShowRangeGuide] = useState(false);
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [score, setScore] = useState(0);

  const [timeLeft, setTimeLeft] = useState(START_TIME);

  // Sight adjustment system: random bias per match + player corrections (in clicks).
  // 1 ring (gabarit) = 4 clicks. Rule: "where the shot landed — turn that way".
  const [errorX, setErrorX] = useState(0);
  const [errorY, setErrorY] = useState(0);
  const [adjX, setAdjX] = useState(0);
  const [adjY, setAdjY] = useState(0);

  // Sighting vs Match mode (per level). Default = sighting.
  const [sessionMode, setSessionMode] = useState<SessionMode>("sighting");
  const [hasMatchShot, setHasMatchShot] = useState(false);

  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<"upgrades" | "skins">("upgrades");
  const [isGuest, setIsGuest] = useState(false);

  // Career mode
  const [mode, setMode] = useState<"quick" | "career" | "olympic" | "leaderboard">("quick");
  const [careerLevel, setCareerLevel] = useState<CareerLevel | null>(null);
  const [careerResult, setCareerResult] = useState<{ won: boolean; score: number; level: CareerLevel } | null>(null);
  const [leaderboardRank, setLeaderboardRank] = useState<LeaderboardRankId>("rookie");
  const [leaderboardResult, setLeaderboardResult] = useState<{ score: number; disciplineId: DisciplineId; rankId: LeaderboardRankId } | null>(null);
  const [targetOffsetX, setTargetOffsetX] = useState(0);
  const targetOffsetRef = useRef(0);
  const boarRunRef = useRef(-260); // starts off-screen left; set on level start

  // Olympic Finals
  const [bots, setBots] = useState<Bot[]>([]);
  const botsRef = useRef<Bot[]>([]);
  useEffect(() => { botsRef.current = bots; }, [bots]);
  const [olympicResult, setOlympicResult] = useState<{ place: number; score: number; medal: "gold" | "silver" | "bronze" | null; eliminated: boolean } | null>(null);

  const tRef = useRef(0);
  const holeIdRef = useRef(0);
  const coachMessageIdRef = useRef(0);
  const historyListRef = useRef<HTMLDivElement>(null);

  const equippedSkin = useMemo(
    () => SKINS.find((s) => s.id === progress.equipped) ?? SKINS[0],
    [progress.equipped],
  );

  const addCoachMessage = useCallback((text: string, type: CoachMessageType) => {
    setCoachMessages((messages) => [
      ...messages,
      {
        id: `${Date.now()}-${++coachMessageIdRef.current}`,
        text,
        type,
        timestamp: Date.now(),
      },
    ].slice(-3));
  }, []);
  const hasUpgrade = (id: string) => progress.upgrades.includes(id);
  const holdWindow = hasUpgrade("premium") ? 5 : 3;

  const recordDailyLeaderboardScore = useCallback((disciplineId: DisciplineId, rankId: LeaderboardRankId, resultScore: number) => {
    const date = todayKey();
    const key = leaderboardKey(date, disciplineId, rankId);
    const badge = badgeIdFor(disciplineId, rankId);

    setProgress((prev) => {
      const previous = prev.dailyScores[key]?.score;
      const bestScore = typeof previous === "number" ? Math.max(previous, resultScore) : resultScore;
      const board = makeDailyLeaderboard(date, disciplineId, rankId, bestScore);
      const playerEntry = board.find((entry) => entry.id === "player");
      const earnedBadge = !!playerEntry && playerEntry.place === 1;

      return {
        ...prev,
        dailyScores: {
          ...prev.dailyScores,
          [key]: { date, score: bestScore },
        },
        badges: earnedBadge && !prev.badges.includes(badge)
          ? [...prev.badges, badge]
          : prev.badges,
      };
    });
  }, []);

  // Auth + Cloud sync
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const closeRangeGuide = useCallback(() => {
    markRangeGuideSeen(discipline.id);
    setShowRangeGuide(false);
    if (!user) setAccountPromptOpen(true);
  }, [discipline.id, user]);
  const hydratedRef = useRef(false);

  // Route-driven screen separation: '/' = Home, '/range' = Shooting.
  // Route is synced manually inside startMatch / backToMenu — no auto-redirect
  // here (it was racing the state update on match start and bouncing user home).
  const navigate = useNavigate();

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
        dailyScores: prev.dailyScores,
        badges: prev.badges,
        dailyGift: prev.dailyGift,
      }));
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Persist locally + to cloud (debounced)
  useEffect(() => {
    if (isGuest) return; // Guest mode: no persistence
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
  }, [progress, user, isGuest]);

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
    if ((mode === "career" && careerLevel?.moving) || discipline.id === "boar") {
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

  // Game timer (only in quick mode AND match mode — paused during sighting)
  useEffect(() => {
    if (phase !== "playing" || mode !== "quick" || sessionMode !== "match") return;
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
  }, [phase, mode, sessionMode]);

  // Game over trigger (quick mode only — by time)
  useEffect(() => {
    if (phase === "playing" && mode === "quick" && sessionMode === "match" && timeLeft <= 0) {
      setPhase("gameover");
      playSfx(A.gameOver);
    }
  }, [timeLeft, phase, mode, sessionMode]);

  // Physics
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    let windX = 0, windY = 0;
    let windTimer = 0;
    let windTargetX = 0, windTargetY = 0;

    const moving = !!(mode === "career" && careerLevel?.moving) || discipline.id === "boar";
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
    const shotHoldTime = holding && holdStart ? (performance.now() - holdStart) / 1000 : 0;
    const d = discipline;
    playSfx(d.shotSound === "air" ? A.shotAir : A.shotRim);
    setLoaded(false);
    const center = d.targetPx / 2;

    // Sight bias: residual error (errorX - adjX) in clicks, 4 clicks = 1 ring.
    const ringStepMm = d.ringMm[1] - d.ringMm[0];
    const pxPerClick = (ringStepMm / 4) * d.mmToPx;
    const biasX = (errorX - adjX) * pxPerClick;
    const biasY = (errorY - adjY) * pxPerClick;

    const hitX = sightRef.current.x + biasX;
    const hitY = sightRef.current.y + biasY;
    const offX = targetOffsetRef.current;
    // hit relative to current target center
    const dx = hitX - (center + offX);
    const dy = hitY - center;
    const distPx = Math.hypot(dx, dy);

    const useInteger = mode === "career" && careerLevel?.scoring === "integer";
    const scRaw = useInteger ? computeIntegerScore(distPx, d) : computeDecimalScore(distPx, d);
    const sc = useInteger ? scRaw : +scRaw.toFixed(1);

    const id = ++holeIdRef.current;
    const isSighting = sessionMode === "sighting";
    const gold = !isSighting && !!equippedSkin.goldHalo;
    setLastCoachShot({
      id,
      score: sc,
      deltaX: dx,
      deltaY: dy,
      clickX: Math.round(dx / pxPerClick),
      clickY: Math.round(dy / pxPerClick),
      isSightingMode: isSighting,
      holdBreathTime: shotHoldTime,
      levelId: careerLevel?.id ?? null,
    });
    // store hole in target-local space so it moves with target
    setHoles((h) => [...h, { x: hitX - offX, y: hitY, score: sc, id, gold, sighting: isSighting }]);
    if (gold) {
      setTimeout(() => {
        setHoles((h) => h.map((hh) => (hh.id === id ? { ...hh, gold: false } : hh)));
      }, 1000);
    }

    setLastShot(sc);
    setHolding(false);
    setHoldStart(null);

    // --- Sighting mode: shot does not count toward level, credits, time, or score ---
    if (isSighting) {
      setShotHistory((h) => [...h, { n: 0, score: sc, discipline: d.short, id, sighting: true }]);
      return;
    }

    // --- Match mode: counts for real ---
    setHasMatchShot(true);
    const shotNum = totalShots + 1;
    setTotalShots(shotNum);
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

    // Career: end of level when shots limit reached
    if (mode === "career" && careerLevel && shotNum >= careerLevel.shots) {
      const finalScore = +(score + sc).toFixed(1);
      const won = finalScore >= careerLevel.winScore;
      recordDailyLeaderboardScore(careerLevel.disciplineId, CAREER_RANK_BY_LEVEL[careerLevel.id], finalScore);
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

    // Daily leaderboard challenge: exactly 10 match shots, no timer.
    if (mode === "leaderboard" && shotNum >= LEADERBOARD_SHOTS) {
      const finalScore = +(score + sc).toFixed(1);
      recordDailyLeaderboardScore(d.id, leaderboardRank, finalScore);
      setTimeout(() => {
        setLeaderboardResult({ score: finalScore, disciplineId: d.id, rankId: leaderboardRank });
        setPhase("gameover");
        playSfx(finalScore >= 100 ? A.chime : A.gameOver);
      }, 600);
    }

    // Olympic Finals: bot turn + eliminations
    if (mode === "olympic") {
      const playerScore = +(score + sc).toFixed(1);
      setTimeout(() => runOlympicRound(shotNum, playerScore), 550);
    }
  }, [phase, loaded, reloading, holding, holdStart, discipline, equippedSkin, totalShots, mode, careerLevel, score, errorX, errorY, adjX, adjY, sessionMode, recordDailyLeaderboardScore, leaderboardRank]);

  // ----- Olympic round helper -----
  const runOlympicRound = (shotNum: number, playerScore: number) => {
    // 1) Every active bot shoots.
    const updatedBots = botsRef.current.map((b) =>
      b.eliminated
        ? b
        : { ...b, score: +(b.score + rollBotShot(!!b.favorite)).toFixed(1) }
    );

    // 2) Elimination check after shots 4, 6, 8.
    let nextBots = updatedBots;
    let playerOut = false;
    if (OLYMPIC_ELIM_SHOTS.has(shotNum)) {
      const active = [
        { id: "player", isPlayer: true, score: playerScore },
        ...updatedBots.filter((b) => !b.eliminated).map((b) => ({ id: b.id, isPlayer: false, score: b.score })),
      ];
      active.sort((a, b) => a.score - b.score);
      const loser = active[0];
      if (loser.isPlayer) {
        playerOut = true;
      } else {
        nextBots = updatedBots.map((b) => (b.id === loser.id ? { ...b, eliminated: true } : b));
        playSfx(A.crowd); // bot dropped, player advances — short applause
      }
    }
    setBots(nextBots);
    botsRef.current = nextBots;

    // 3) Player eliminated -> stop the match.
    if (playerOut) {
      playSfx(A.gameOver);
      const standings = [
        { id: "player", score: playerScore },
        ...nextBots.map((b) => ({ id: b.id, score: b.score })),
      ].sort((a, b) => b.score - a.score);
      const place = standings.findIndex((p) => p.id === "player") + 1;
      setOlympicResult({ place, score: playerScore, medal: null, eliminated: true });
      setPhase("gameover");
      return;
    }

    // 4) Finals after shot 10.
    if (shotNum >= OLYMPIC_TOTAL_SHOTS) {
      const finalists = [
        { id: "player", score: playerScore },
        ...nextBots.filter((b) => !b.eliminated).map((b) => ({ id: b.id, score: b.score })),
      ].sort((a, b) => b.score - a.score);
      const place = finalists.findIndex((p) => p.id === "player") + 1;
      const medal = place === 1 ? "gold" : place === 2 ? "silver" : place === 3 ? "bronze" : null;
      recordDailyLeaderboardScore("ar10", "champion", playerScore);
      setOlympicResult({ place, score: playerScore, medal, eliminated: false });
      setPhase("gameover");
      if (place === 1) {
        playSfx(A.crowd);
        setProgress((p) => ({ ...p, credits: p.credits + OLYMPIC_GOLD_BONUS }));
        confetti({
          particleCount: 320, spread: 160, startVelocity: 70,
          origin: { x: 0.5, y: 0.5 },
          colors: ["#f0c14a", "#ffe28a", "#ffffff", "#3b6fa0"],
        });
        setTimeout(() => confetti({
          particleCount: 200, spread: 120, startVelocity: 55,
          origin: { x: 0.3, y: 0.6 }, colors: ["#f0c14a", "#ffffff"],
        }), 250);
        setTimeout(() => confetti({
          particleCount: 200, spread: 120, startVelocity: 55,
          origin: { x: 0.7, y: 0.6 }, colors: ["#f0c14a", "#ffffff"],
        }), 500);
      } else if (place <= 3) {
        playSfx(A.chime);
      } else {
        playSfx(A.gameOver);
      }
    }
  };

  // ----- actions -----
  const randomizeSightError = () => {
    // Random scope drift in clicks: roughly ±5 rings worth (4 clicks per ring)
    const rand = () => Math.round((Math.random() * 2 - 1) * 20);
    setErrorX(rand());
    setErrorY(rand());
    setAdjX(0);
    setAdjY(0);
  };

  const startMatch = (d: Discipline) => {
    setMode("quick");
    setCareerLevel(null);
    setCareerResult(null);
    setLeaderboardResult(null);
    setDiscipline(d);
    setPhase("playing");
    setHoles([]);
    setShotHistory([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setLastCoachShot(null);
    setCoachMessages([]);
    setCoachSessionId((id) => id + 1);
    setShowRangeGuide(shouldShowRangeGuide(d.id));
    setTimeLeft(START_TIME);
    setLoaded(true);
    setReloading(false);
    setShopOpen(false);
    setSessionMode("sighting");
    setHasMatchShot(false);
    randomizeSightError();
    if (d.id === "boar") {
      boarRunRef.current = -d.targetPx * 0.5;
      targetOffsetRef.current = boarRunRef.current;
      setTargetOffsetX(boarRunRef.current);
    } else {
      targetOffsetRef.current = 0;
      setTargetOffsetX(0);
    }
    navigate({ to: "/range" });
  };

  const startLeaderboardMatch = (d: Discipline, rankId: LeaderboardRankId) => {
    setMode("leaderboard");
    setCareerLevel(null);
    setCareerResult(null);
    setOlympicResult(null);
    setLeaderboardRank(rankId);
    setLeaderboardResult(null);
    setDiscipline(d);
    setPhase("playing");
    setHoles([]);
    setShotHistory([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setLastCoachShot(null);
    setCoachMessages([]);
    setCoachSessionId((id) => id + 1);
    setShowRangeGuide(shouldShowRangeGuide(d.id));
    setTimeLeft(999);
    setLoaded(true);
    setReloading(false);
    setShopOpen(false);
    setSessionMode("sighting");
    setHasMatchShot(false);
    randomizeSightError();
    if (d.id === "boar") {
      boarRunRef.current = -d.targetPx * 0.5;
      targetOffsetRef.current = boarRunRef.current;
      setTargetOffsetX(boarRunRef.current);
    } else {
      targetOffsetRef.current = 0;
      setTargetOffsetX(0);
    }
    navigate({ to: "/range" });
  };

  const startCareerLevel = (lvl: CareerLevel) => {
    const d = DISCIPLINES.find((x) => x.id === lvl.disciplineId) ?? DISCIPLINES[0];
    setMode("career");
    setCareerLevel(lvl);
    setCareerResult(null);
    setLeaderboardResult(null);
    setDiscipline(d);
    setPhase("playing");
    setHoles([]);
    setShotHistory([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setLastCoachShot(null);
    setCoachMessages([]);
    setCoachSessionId((id) => id + 1);
    setShowRangeGuide(shouldShowRangeGuide(d.id));
    setTimeLeft(999);
    setLoaded(true);
    setReloading(false);
    setShopOpen(false);
    setSessionMode("sighting");
    setHasMatchShot(false);
    randomizeSightError();
    boarRunRef.current = -d.targetPx * 0.5;
    targetOffsetRef.current = boarRunRef.current;
    setTargetOffsetX(boarRunRef.current);
    navigate({ to: "/range" });
  };

  const startGuestSession = () => {
    setIsGuest(true);
    setProgress({
      credits: 0,
      owned: ["default"],
      upgrades: [],
      equipped: "default",
      totalScore: 0,
      perfectTens: 0,
      careerCompleted: 0,
      dailyScores: {},
      badges: [],
      dailyGift: { lastClaimDate: null, streakDay: 0 },
    });
    startCareerLevel(CAREER_LEVELS[0]);
  };

  const startOlympicFinals = () => {
    if (progress.careerCompleted < CAREER_LEVEL_COUNT) return;
    const d = DISCIPLINES.find((x) => x.id === "ar10") ?? DISCIPLINES[0];
    setMode("olympic");
    setCareerLevel(null);
    setCareerResult(null);
    setLeaderboardResult(null);
    setOlympicResult(null);
    const fresh = OLYMPIC_BOTS_INIT.map((b) => ({ ...b, score: 0, eliminated: false }));
    setBots(fresh);
    botsRef.current = fresh;
    setDiscipline(d);
    setPhase("playing");
    setHoles([]);
    setShotHistory([]);
    setScore(0);
    setPerfectCount(0);
    setTotalShots(0);
    setLastShot(null);
    setLastCoachShot(null);
    setCoachMessages([]);
    setCoachSessionId((id) => id + 1);
    setShowRangeGuide(shouldShowRangeGuide(d.id));
    setTimeLeft(999);
    setLoaded(true);
    setReloading(false);
    setShopOpen(false);
    setSessionMode("sighting");
    setHasMatchShot(false);
    randomizeSightError();
    targetOffsetRef.current = 0;
    setTargetOffsetX(0);
    navigate({ to: "/range" });
  };





  const backToMenu = () => {
    setPhase("menu");
    setHoles([]);
    setLastCoachShot(null);
    setCoachMessages([]);
    setShowRangeGuide(false);
    setCareerResult(null);
    setLeaderboardResult(null);
    navigate({ to: "/" });
  };

  const resetTarget = () => {
    setHoles([]);
  };

  // Sight turret correction. Rule: "click toward where the shot went".
  const adjustSight = (dir: "up" | "down" | "left" | "right") => {
    if (phase !== "playing") return;
    playTurretClick();
    if (dir === "left") setAdjX((v) => v - 1);
    else if (dir === "right") setAdjX((v) => v + 1);
    else if (dir === "up") setAdjY((v) => v - 1);
    else if (dir === "down") setAdjY((v) => v + 1);
  };

  // Switch sighting -> match: clear target, reset shot counter, (re)start timer.
  const switchToMatch = () => {
    if (sessionMode === "match") return;
    setSessionMode("match");
    setHoles([]);
    setShotHistory((h) => h.filter((s) => !s.sighting)); // keep clean slate
    setTotalShots(0);
    setScore(0);
    setPerfectCount(0);
    setLastShot(null);
    if (mode === "quick") setTimeLeft(START_TIME);
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

  const claimDailyGift = () => {
    const today = localTodayKey();
    if (progress.dailyGift.lastClaimDate === today) return;

    const day = nextGiftDay(progress.dailyGift, today);
    const gift = DAILY_GIFTS.find((item) => item.day === day) ?? DAILY_GIFTS[0];

    setProgress((prev) => {
      const nextDay = nextGiftDay(prev.dailyGift, today);
      const nextGift = DAILY_GIFTS.find((item) => item.day === nextDay) ?? DAILY_GIFTS[0];
      const nextState: DailyGiftState = { lastClaimDate: today, streakDay: nextDay };

      if (nextGift.reward.type === "credits") {
        return {
          ...prev,
          credits: prev.credits + nextGift.reward.amount,
          dailyGift: nextState,
        };
      }

      if (prev.owned.includes(nextGift.reward.skinId)) {
        return {
          ...prev,
          credits: prev.credits + nextGift.reward.fallbackCredits,
          dailyGift: nextState,
        };
      }

      return {
        ...prev,
        owned: [...prev.owned, nextGift.reward.skinId],
        equipped: nextGift.reward.skinId,
        dailyGift: nextState,
      };
    });

    playSfx(gift.reward.type === "skin" ? A.chime : A.purchase);
  };

  const holdTime = holding && holdStart ? (performance.now() - holdStart) / 1000 : 0;
  const inFocus = holding && holdTime < holdWindow;
  const overHold = holding && holdTime >= holdWindow;
  const timeCritical = timeLeft <= 10;

  useTelemetryCoach({
    levelId: careerLevel?.id ?? null,
    sessionId: coachSessionId,
    isSightingMode: sessionMode === "sighting",
    lastShot: lastCoachShot,
    holdBreathTime: holdTime,
    isHoldingBreath: holding,
    addCoachMessage,
  });

  return (
    <div className="min-h-screen bg-background text-foreground select-none overflow-hidden">
      {/* Top bar — visible only on Shooting Range screen */}
      {phase !== "menu" && (
        <div className="flex items-center justify-between border-b border-border bg-[var(--navy-mid)] px-3 py-2 md:px-6 md:py-3 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
            <span className="text-xs font-bold tracking-[0.3em] text-muted-foreground">LIVE</span>
            <span className="text-xs font-semibold tracking-widest text-foreground">
              {discipline.short} · OLYMPIC RANGE
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
            {phase === "playing" && mode === "leaderboard" && (
              <div className="px-2 py-0.5 border border-[var(--gold-bright)] text-[var(--gold-bright)]">
                <span className="text-muted-foreground mr-2">ТАБЛИЦА</span>
                <span className="font-bold tabular-nums">{totalShots}/{LEADERBOARD_SHOTS}</span>
              </div>
            )}
            {phase === "playing" && mode === "olympic" && (
              <div className="px-2 py-0.5 border border-[var(--gold-bright)] text-[var(--gold-bright)]">
                <span className="text-muted-foreground mr-2">🏅 ФИНАЛ</span>
                <span className="font-bold tabular-nums">{totalShots}/{OLYMPIC_TOTAL_SHOTS}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground mr-2">SCORE</span>
              <span className="font-bold text-primary tabular-nums">{score.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-muted-foreground mr-2">CR</span>
              <span className="font-bold text-[var(--gold-bright)] tabular-nums">{progress.credits}</span>
              {isGuest && (
                <span className="ml-2 text-[10px] tracking-widest text-muted-foreground">• РЕЖИМ ГОСТЯ</span>
              )}
            </div>

            <button
              onClick={backToMenu}
              className="border border-primary text-primary font-bold px-3 py-1.5 hover:bg-primary hover:text-primary-foreground transition-colors tracking-widest"
            >
              ← НАЗАД В МЕНЮ
            </button>
          </div>
        </div>
      )}

      {/* HOME SCREEN */}
      {phase === "menu" && (
          <HomeScreen
            onPickCareer={startCareerLevel}
            onPickQuick={startMatch}
            onPickLeaderboard={startLeaderboardMatch}
            onStartOlympic={startOlympicFinals}
          progress={progress}
          careerCompleted={progress.careerCompleted}
          user={user}
          mounted={mounted}
          buySkin={buySkin}
          equipSkin={equipSkin}
          buyUpgrade={buyUpgrade}
          hasUpgrade={hasUpgrade}
          isGuest={isGuest}
          onStartGuest={startGuestSession}
          onClaimDailyGift={claimDailyGift}
        />


      )}
      <AccountPrompt
        open={accountPromptOpen && !user}
        onClose={() => setAccountPromptOpen(false)}
      />

      {/* GAMEPLAY */}
      {phase !== "menu" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0">
          {/* Range */}
          <div className="relative flex items-center justify-center bg-gradient-to-b from-[#e8eaee] to-[#c8ccd2] p-2 md:p-8 min-h-[calc(100svh-52px)] overflow-hidden">
            {phase === "playing" && <CoachPanel messages={coachMessages} />}
            {phase === "playing" && showRangeGuide && (
              <RangeCoachGuide
                discipline={discipline}
                holdWindow={holdWindow}
                onClose={closeRangeGuide}
              />
            )}

            <div className="absolute top-2 left-2 right-2 md:top-4 md:left-4 md:right-4 flex items-center justify-between text-[10px] md:text-xs font-mono pointer-events-auto z-10 gap-2">
              <div className="flex items-center gap-2">
                <div className="bg-[var(--navy-deep)]/90 px-2 py-1 md:px-3 md:py-1.5 text-foreground border-l-2 border-primary">
                  <span className="text-[9px] tracking-widest text-muted-foreground mr-2 hidden sm:inline">ДИСЦИПЛИНА</span>
                  <span className="font-bold">{discipline.short}</span>
                </div>
                {/* Mode toggle: Sighting / Match */}
                <div className="flex bg-[var(--navy-deep)]/90 border border-border overflow-hidden">
                  <button
                    type="button"
                    disabled={hasMatchShot}
                    onClick={() => {
                      if (!hasMatchShot && sessionMode !== "sighting") {
                        // Reverting from match back is blocked anyway, just no-op
                      }
                    }}
                    title={hasMatchShot ? "Зачёт уже начался — возврат запрещён" : "Пробные выстрелы (без зачёта)"}
                    className={`px-2 py-1 md:px-3 md:py-1.5 font-bold tracking-widest text-[10px] md:text-[11px] transition-colors ${
                      sessionMode === "sighting"
                        ? "bg-destructive/80 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    } ${hasMatchShot ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    ПРОБНЫЕ
                  </button>
                  <button
                    type="button"
                    onClick={switchToMatch}
                    title="Перейти в зачётный режим (мишень очистится, таймер запустится)"
                    className={`px-2 py-1 md:px-3 md:py-1.5 font-bold tracking-widest text-[10px] md:text-[11px] transition-colors ${
                      sessionMode === "match"
                        ? "bg-primary text-primary-foreground"
                        : "text-primary hover:bg-primary/20"
                    }`}
                  >
                    ЗАЧЁТ
                  </button>
                </div>
              </div>
              <button
                onClick={resetTarget}
                title="Сбросить пробоины (счет и время сохраняются)"
                className="bg-[var(--navy-deep)]/90 hover:bg-[var(--navy-mid)] px-2 py-1 md:px-3 md:py-1.5 border-r-2 border-primary text-foreground font-bold tracking-widest text-[10px] md:text-[11px] flex items-center gap-2"
              >
                <span>👁</span> <span className="hidden sm:inline">СБРОСИТЬ МИШЕНЬ</span><span className="sm:hidden">СБРОС</span>
              </button>
            </div>

            {/* Olympic Finals — live leaderboard */}
            {mode === "olympic" && (
              <div className="absolute top-16 right-2 md:right-4 z-20 pointer-events-auto w-[200px] md:w-[230px]">
                <div className="bg-[var(--navy-deep)]/95 border border-[var(--gold-bright)]/70 shadow-xl">
                  <div className="px-3 py-2 border-b border-border bg-[var(--navy-mid)] flex items-center justify-between">
                    <div className="text-[10px] tracking-widest text-[var(--gold-bright)] font-bold">🏅 ОЛИМП. ФИНАЛ</div>
                    <div className="text-[9px] font-mono text-muted-foreground">{totalShots}/{OLYMPIC_TOTAL_SHOTS}</div>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {[
                      { id: "player", name: "ВЫ", country: "PLR", score: score, eliminated: olympicResult?.eliminated ?? false, isPlayer: true, favorite: false },
                      ...bots.map((b) => ({ id: b.id, name: b.name, country: b.country, score: b.score, eliminated: b.eliminated, isPlayer: false, favorite: !!b.favorite })),
                    ]
                      .slice()
                      .sort((a, b) => {
                        if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
                        return b.score - a.score;
                      })
                      .map((p, idx) => (
                        <li
                          key={p.id}
                          className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono ${
                            p.eliminated ? "opacity-40" : ""
                          } ${p.isPlayer ? "bg-primary/10" : ""}`}
                        >
                          <span className={`w-4 text-center font-bold ${idx === 0 ? "text-[var(--gold-bright)]" : "text-muted-foreground"}`}>
                            {idx + 1}
                          </span>
                          <span className="flex-1 truncate">
                            <span className={p.isPlayer ? "text-primary font-bold" : "text-foreground"}>
                              {p.name}
                            </span>
                            <span className="text-muted-foreground ml-1 text-[9px]">{p.country}</span>
                            {p.favorite && !p.eliminated && <span className="ml-1 text-[var(--gold-bright)]">★</span>}
                          </span>
                          {p.eliminated ? (
                            <span className="text-destructive font-bold text-[10px]">❌</span>
                          ) : (
                            <span className="tabular-nums font-bold text-foreground">{p.score.toFixed(1)}</span>
                          )}
                        </li>
                      ))}
                  </ul>
                  <div className="px-3 py-1.5 border-t border-border text-[9px] text-muted-foreground tracking-wider">
                    Выбывание: 4 · 6 · 8 выстрелы
                  </div>
                </div>
              </div>
            )}


            {/* Sight Adjustment turret — bottom-left of arena */}
            <div className="absolute left-2 md:left-4 bottom-20 md:bottom-24 z-20 pointer-events-auto">
              <div className="bg-[var(--navy-deep)]/95 border border-primary/60 px-2 py-2 font-mono text-foreground shadow-xl">
                <div className="text-[9px] tracking-widest text-muted-foreground text-center mb-1">ПОПРАВКИ · КУДА ПОПАЛ, ТУДА НАЖМИ</div>
                <div className="grid grid-cols-3 gap-1 w-[120px] mx-auto">
                  <div />
                  <button
                    onClick={() => adjustSight("up")}
                    className="aspect-square bg-[var(--navy-mid)] hover:bg-primary/30 border border-border text-foreground font-bold text-base flex items-center justify-center active:scale-95 transition-transform"
                    title="Если попал выше центра, нажми сюда"
                  >▲</button>
                  <div />
                  <button
                    onClick={() => adjustSight("left")}
                    className="aspect-square bg-[var(--navy-mid)] hover:bg-primary/30 border border-border text-foreground font-bold text-base flex items-center justify-center active:scale-95 transition-transform"
                    title="Если попал левее центра, нажми сюда"
                  >◀</button>
                  <div className="aspect-square bg-[var(--navy-deep)] border border-border flex flex-col items-center justify-center text-[8px] leading-none text-muted-foreground">
                    <div>X:<span className="text-primary tabular-nums ml-0.5">{adjX > 0 ? `+${adjX}` : adjX}</span></div>
                    <div className="mt-0.5">Y:<span className="text-primary tabular-nums ml-0.5">{adjY > 0 ? `+${adjY}` : adjY}</span></div>
                  </div>
                  <button
                    onClick={() => adjustSight("right")}
                    className="aspect-square bg-[var(--navy-mid)] hover:bg-primary/30 border border-border text-foreground font-bold text-base flex items-center justify-center active:scale-95 transition-transform"
                    title="Если попал правее центра, нажми сюда"
                  >▶</button>
                  <div />
                  <button
                    onClick={() => adjustSight("down")}
                    className="aspect-square bg-[var(--navy-mid)] hover:bg-primary/30 border border-border text-foreground font-bold text-base flex items-center justify-center active:scale-95 transition-transform"
                    title="Если попал ниже центра, нажми сюда"
                  >▼</button>
                  <div />
                </div>
              </div>
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
                  {olympicResult ? (
                    <>
                      {olympicResult.eliminated ? (
                        <>
                          <div className="text-[10px] tracking-[0.5em] text-destructive font-bold">🏅 ОЛИМПИЙСКИЙ ФИНАЛ</div>
                          <div className="text-5xl font-black tracking-tight text-destructive">ВЫ ВЫБЫЛИ</div>
                          <div className="text-sm text-muted-foreground">
                            Вы выбыли из финала на <span className="text-foreground font-bold">{olympicResult.place}-м</span> месте.
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                            <Stat label="МЕСТО" value={olympicResult.place} />
                            <Stat label="ОЧКИ" value={olympicResult.score.toFixed(1)} />
                          </div>
                        </>
                      ) : olympicResult.medal === "gold" ? (
                        <>
                          <div className="text-[10px] tracking-[0.5em] text-[var(--gold-bright)] font-bold">🏅 ОЛИМПИЙСКИЙ ФИНАЛ</div>
                          <div className="text-5xl md:text-6xl font-black tracking-tight text-[var(--gold-bright)]">ЧЕМПИОН! 🥇</div>
                          <div className="text-lg text-[var(--gold-bright)] font-bold tracking-wide">+ {OLYMPIC_GOLD_BONUS} КРЕДИТОВ СУПЕР-БОНУСА</div>
                          <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                            <Stat label="МЕСТО" value="1" />
                            <Stat label="ОЧКИ" value={olympicResult.score.toFixed(1)} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[10px] tracking-[0.5em] text-primary font-bold">🏅 ОЛИМПИЙСКИЙ ФИНАЛ</div>
                          <div className="text-5xl font-black tracking-tight">
                            {olympicResult.medal === "silver" ? "СЕРЕБРО 🥈" : olympicResult.medal === "bronze" ? "БРОНЗА 🥉" : `${olympicResult.place}-е МЕСТО`}
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                            <Stat label="МЕСТО" value={olympicResult.place} />
                            <Stat label="ОЧКИ" value={olympicResult.score.toFixed(1)} />
                          </div>
                        </>
                      )}
                      <div className="flex gap-3 justify-center pt-2 flex-wrap">
                        <button
                          onClick={startOlympicFinals}
                          className="bg-primary text-primary-foreground font-bold tracking-widest px-8 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                        >
                          ПОПРОБОВАТЬ СНОВА
                        </button>
                        <button
                          onClick={backToMenu}
                          className="border border-primary text-primary font-bold tracking-widest px-6 py-3 hover:bg-primary/10 transition-colors"
                        >
                          В МЕНЮ
                        </button>
                      </div>
                    </>
                  ) : careerResult ? (
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
                  ) : leaderboardResult ? (
                    <>
                      <div className="text-[10px] tracking-[0.5em] text-[var(--gold-bright)] font-bold">ТАБЛИЦА ДНЯ</div>
                      <div className="text-5xl font-black tracking-tight">СЕРИЯ ЗАВЕРШЕНА</div>
                      <div className="text-sm text-muted-foreground">
                        Результат записан в ежедневную таблицу выбранной дисциплины.
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm font-mono">
                        <Stat label="SCORE" value={leaderboardResult.score.toFixed(1)} />
                        <Stat label="ВЫСТРЕЛОВ" value={LEADERBOARD_SHOTS} />
                        <Stat label="РАНГ" value={LEADERBOARD_RANKS.find((rank) => rank.id === leaderboardResult.rankId)?.name ?? "—"} />
                      </div>
                      <div className="flex gap-3 justify-center pt-2 flex-wrap">
                        <button
                          onClick={() => {
                            const selected = DISCIPLINES.find((d) => d.id === leaderboardResult.disciplineId) ?? discipline;
                            startLeaderboardMatch(selected, leaderboardResult.rankId);
                          }}
                          className="bg-primary text-primary-foreground font-bold tracking-widest px-8 py-3 hover:bg-[var(--gold-bright)] transition-colors"
                        >
                          ПОВТОРИТЬ 10 ВЫСТРЕЛОВ
                        </button>
                        <button
                          onClick={backToMenu}
                          className="border border-primary text-primary font-bold tracking-widest px-6 py-3 hover:bg-primary/10 transition-colors"
                        >
                          К ТАБЛИЦАМ
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
              ) : mode === "leaderboard" ? (
                <div className="mb-3 px-3 py-3 border border-[var(--gold-bright)]/60 bg-[var(--navy-mid)]/60">
                  <div className="text-[9px] tracking-widest text-muted-foreground">ТАБЛИЦА ДНЯ · {LEADERBOARD_RANKS.find((rank) => rank.id === leaderboardRank)?.name}</div>
                  <div className="text-2xl font-black font-mono tabular-nums leading-tight text-[var(--gold-bright)] mt-1">
                    {totalShots}<span className="text-base text-muted-foreground">/{LEADERBOARD_SHOTS}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Формат: <span className="text-foreground font-bold">10 зачетных выстрелов</span> · Таймера нет
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
                    h.sighting ? "bg-destructive/10" : h.score === 10.9 ? "bg-primary/10" : "bg-transparent"
                  }`}
                >
                  <span className="text-muted-foreground text-xs">
                    {h.sighting ? <span className="text-destructive">[ПРБ]</span> : `#${h.n}`}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 tracking-widest">{h.discipline}</span>
                  <span
                    className={`tabular-nums font-bold ${
                      h.sighting ? "text-destructive/80"
                      : h.score === 10.9 ? "text-primary"
                      : h.score >= 9 ? "text-foreground"
                      : "text-muted-foreground"
                    }`}
                  >
                    {h.score.toFixed(1)}
                    {!h.sighting && timeBonusForShot(h.score) > 0 && (
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

    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function HomeScreen({
  onPickCareer, onPickQuick, onPickLeaderboard, onStartOlympic, progress, careerCompleted, user, mounted,
  buySkin, equipSkin, buyUpgrade, hasUpgrade, isGuest, onStartGuest, onClaimDailyGift,
}: {
  onPickCareer: (lvl: CareerLevel) => void;
  onPickQuick: (d: Discipline) => void;
  onPickLeaderboard: (d: Discipline, rankId: LeaderboardRankId) => void;
  onStartOlympic: () => void;
  progress: Progress;
  careerCompleted: number;
  user: any;
  mounted: boolean;
  buySkin: (s: Skin) => void;
  equipSkin: (s: Skin) => void;
  buyUpgrade: (u: Upgrade) => void;
  hasUpgrade: (id: string) => boolean;
  isGuest: boolean;
  onStartGuest: () => void;
  onClaimDailyGift: () => void;
}) {
  const credits = progress.credits;
  const [shopTab, setShopTab] = useState<"upgrades" | "skins">("upgrades");
  const [signInOpen, setSignInOpen] = useState(false);
  const [guestWarnOpen, setGuestWarnOpen] = useState(false);
  const [tournamentPromptOpen, setTournamentPromptOpen] = useState(false);
  const [briefingDiscipline, setBriefingDiscipline] = useState<Discipline | null>(null);
  const [briefingLeaderboardRank, setBriefingLeaderboardRank] = useState<LeaderboardRankId | null>(null);
  const signInRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mounted || !user) return;
    const key = `tournament-prompt-seen-${user.id}`;
    const pending = localStorage.getItem("postAuthTournamentPrompt") === "1";
    if (pending || !localStorage.getItem(key)) {
      localStorage.removeItem("postAuthTournamentPrompt");
      localStorage.setItem(key, "1");
      setTournamentPromptOpen(true);
    }
  }, [mounted, user]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!signInOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (signInRef.current && !signInRef.current.contains(e.target as Node)) {
        setSignInOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [signInOpen]);

  if (briefingDiscipline) {
    return (
      <DisciplineBriefing
        discipline={briefingDiscipline}
        onBack={() => {
          setBriefingDiscipline(null);
          setBriefingLeaderboardRank(null);
        }}
        onStart={() => {
          if (briefingLeaderboardRank) onPickLeaderboard(briefingDiscipline, briefingLeaderboardRank);
          else onPickQuick(briefingDiscipline);
        }}
      />
    );
  }

  const olympicUnlocked = careerCompleted >= CAREER_LEVEL_COUNT;
  const today = localTodayKey();
  const giftAlreadyClaimed = progress.dailyGift.lastClaimDate === today;
  const giftDay = nextGiftDay(progress.dailyGift, today);
  const todayGift = DAILY_GIFTS.find((gift) => gift.day === giftDay) ?? DAILY_GIFTS[0];
  const nextGiftDayNumber = giftDay >= 7 ? 1 : giftDay + 1;
  const nextGift = DAILY_GIFTS.find((gift) => gift.day === nextGiftDayNumber) ?? DAILY_GIFTS[0];

  return (
    <div className="min-h-screen flex flex-col items-center px-4 md:px-6 py-8 bg-[radial-gradient(ellipse_at_top,_var(--navy-mid),_var(--navy-deep))]">
      {/* Header row with profile */}
      <div className="w-full max-w-6xl flex items-center justify-between mb-6">
        <div>
          <div className="text-[10px] tracking-[0.5em] text-primary font-bold">OLYMPIC SHOOTING SIMULATOR</div>
          <div className="text-xs text-muted-foreground mt-1">
            Добро пожаловать, стрелок{user?.email ? `, ${user.email.split("@")[0]}` : ""}!
            {isGuest && <span className="ml-2 text-[var(--gold-bright)]">• Режим гостя</span>}
          </div>
        </div>
        {mounted && (
          user ? (
            <Link
              to="/profile"
              className="border border-[var(--gold-bright)] text-[var(--gold-bright)] font-bold tracking-widest px-4 py-2 text-xs hover:bg-[var(--gold-bright)] hover:text-[var(--navy-deep)] transition-colors"
            >
              ПРОФИЛЬ
            </Link>
          ) : (
            <div ref={signInRef} className="relative">
              <button
                type="button"
                onClick={() => setSignInOpen((v) => !v)}
                className="border border-[var(--gold-bright)] text-[var(--gold-bright)] font-bold tracking-widest px-4 py-2 text-xs hover:bg-[var(--gold-bright)] hover:text-[var(--navy-deep)] transition-colors flex items-center gap-2"
                aria-haspopup="menu"
                aria-expanded={signInOpen}
              >
                ВОЙТИ
                <span className={`inline-block transition-transform ${signInOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
              <AnimatePresence>
                {signInOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-56 border border-[var(--gold-bright)]/50 bg-[var(--navy-deep)] shadow-xl z-50"
                    role="menu"
                  >
                    <Link
                      to="/auth"
                      onClick={() => setSignInOpen(false)}
                      className="block px-4 py-3 text-xs tracking-widest text-foreground hover:bg-[var(--gold-bright)] hover:text-[var(--navy-deep)] transition-colors border-b border-border"
                      role="menuitem"
                    >
                      ОСНОВНОЙ ВХОД
                    </Link>
                    <button
                      type="button"
                      onClick={() => { setSignInOpen(false); setGuestWarnOpen(true); }}
                      className="block w-full text-left px-4 py-3 text-xs tracking-widest text-muted-foreground hover:bg-[var(--gold-bright)] hover:text-[var(--navy-deep)] transition-colors"
                      role="menuitem"
                    >
                      ВОЙТИ КАК ГОСТЬ
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        )}
      </div>

      <div className="sticky top-2 z-40 w-full max-w-6xl mb-5 border border-border/70 bg-[var(--navy-deep)]/92 backdrop-blur-md px-2 py-2 shadow-xl">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { id: "disciplines", label: "ДИСЦИПЛИНЫ" },
            { id: "career-path", label: "КАРЬЕРА" },
            { id: "daily-tournament", label: "ТУРНИР" },
            { id: "weekly-gifts", label: "ПОДАРКИ" },
            { id: "shop", label: "МАГАЗИН" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => document.getElementById(tab.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="border border-border/60 bg-slate-950/45 px-3 py-2 text-[10px] font-black tracking-widest text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => document.getElementById("weekly-gifts")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className={`w-full max-w-6xl mb-6 text-left border px-4 py-3 transition-colors ${
          giftAlreadyClaimed
            ? "border-border/70 bg-slate-950/35 hover:border-[var(--gold-bright)]/60"
            : "border-[var(--gold-bright)] bg-[var(--gold-bright)]/12 hover:bg-[var(--gold-bright)]/18 shadow-[0_0_24px_rgba(245,190,80,0.16)]"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 border border-[var(--gold-bright)]/70 bg-slate-950/60 flex items-center justify-center text-xl">
              🎁
            </div>
            <div>
              <div className="text-[10px] tracking-[0.35em] text-[var(--gold-bright)] font-bold">
                {giftAlreadyClaimed ? "ПОДАРОК УЖЕ ЗАБРАН" : "ТЕБЯ ЖДЕТ ПОДАРОК"}
              </div>
              <div className="mt-1 text-sm md:text-base font-black">
                {giftAlreadyClaimed
                  ? `Завтра: день ${nextGift.day} · ${rewardLabel(nextGift.reward)}`
                  : `Сегодня: день ${todayGift.day} · ${rewardLabel(todayGift.reward)}`}
              </div>
            </div>
          </div>
          <div className="text-[10px] font-black tracking-widest text-primary">
            {giftAlreadyClaimed ? "ПОСМОТРЕТЬ НЕДЕЛЮ" : "ЗАБРАТЬ СЕЙЧАС"}
          </div>
        </div>
      </button>

      {/* Guest warning modal */}
      <AnimatePresence>
        {guestWarnOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
            onClick={() => setGuestWarnOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[var(--navy-mid)] border border-[var(--gold-bright)] p-6"
            >
              <div className="text-lg font-bold tracking-widest text-[var(--gold-bright)] mb-3">⚠️ РЕЖИМ ГОСТЯ</div>
              <p className="text-sm text-foreground leading-relaxed mb-6">
                В этом режиме ваш прогресс (заработанные кредиты, рекорды и купленные скины) <b>НЕ сохраняется</b> в браузере. После закрытия страницы все достижения будут сброшены. Желаете продолжить?
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setGuestWarnOpen(false)}
                  className="border border-border text-foreground font-bold tracking-widest px-4 py-2 text-xs hover:bg-secondary transition-colors"
                >
                  ОТМЕНА
                </button>
                <button
                  type="button"
                  onClick={() => { setGuestWarnOpen(false); onStartGuest(); }}
                  className="bg-[var(--gold-bright)] text-[var(--navy-deep)] font-bold tracking-widest px-4 py-2 text-xs hover:opacity-90 transition-opacity"
                >
                  ДА, ПРОДОЛЖИТЬ
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <TournamentPrompt
        open={tournamentPromptOpen}
        onClose={() => setTournamentPromptOpen(false)}
        onPlay={() => {
          setTournamentPromptOpen(false);
          window.setTimeout(() => {
            document.getElementById("daily-tournament")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }}
      />

      <div id="disciplines" className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6 items-stretch scroll-mt-24">
        <section className="border border-border/70 bg-[var(--navy-mid)]/70 p-6 md:p-8 flex flex-col justify-between min-h-[360px]">
          <div>
            <div className="text-[10px] tracking-[0.5em] text-primary font-bold mb-4">OLYMPIC SHOOTING RANGE</div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-none">
              Olympic<br />Shooting<br />Simulator
            </h1>
            <p className="mt-5 max-w-md text-sm md:text-base leading-relaxed text-muted-foreground">
              Выбери дисциплину, посмотри разбор тренера и выходи на рубеж с простым планом: навелся, задержал дыхание, мягко нажал.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-8 text-center">
            <MiniStat label="КОНТРОЛЬ" v="ДЫХАНИЕ" />
            <MiniStat label="ПРИЦЕЛ" v="ДИОПТР" />
            <MiniStat label="ТЕМП" v="СПУСК" />
          </div>
        </section>

        <section className="border border-[var(--gold-bright)]/35 bg-[var(--navy-deep)]/80 p-4 md:p-5">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <div>
              <div className="text-[10px] tracking-[0.45em] text-[var(--gold-bright)] font-bold">ВЫБЕРИТЕ ДИСЦИПЛИНУ</div>
              <div className="text-xs text-muted-foreground mt-1">После выбора откроется тренерский разбор.</div>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">5 НАПРАВЛЕНИЙ</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DISCIPLINES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setBriefingLeaderboardRank(null);
                  setBriefingDiscipline(d);
                }}
                className="group text-left border border-border/70 bg-slate-950/45 hover:border-primary transition-colors p-3 grid grid-cols-[92px_1fr] gap-3 min-h-[132px]"
              >
                <div className="h-full border border-border/50 bg-slate-900/70 flex items-center justify-center overflow-hidden">
                  <WeaponIllustration disciplineId={d.id} />
                </div>
                <div className="min-w-0 flex flex-col">
                  <div className="text-[10px] tracking-[0.22em] text-primary font-mono">{d.short}</div>
                  <div className="mt-1 font-black leading-tight text-foreground">{d.name}</div>
                  <div className="mt-1 text-[11px] leading-snug text-muted-foreground line-clamp-2">{d.caption}</div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className={`px-2 py-1 text-[10px] font-bold tracking-widest border ${difficultyStyle(d.id)}`}>
                      {difficultyLabel(d.id)}
                    </span>
                    <span className="text-[10px] font-bold tracking-widest text-primary group-hover:text-[var(--gold-bright)]">ДАЛЕЕ</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Player stats */}
      <div className="w-full max-w-6xl grid grid-cols-3 gap-3 md:gap-4 my-6">
        <div className="border border-border bg-[var(--navy-mid)] px-4 py-3">
          <div className="text-[10px] tracking-widest text-muted-foreground">КРЕДИТЫ</div>
          <div className="text-2xl md:text-3xl font-black text-[var(--gold-bright)] font-mono tabular-nums">{credits} <span className="text-sm text-muted-foreground">CR</span></div>
        </div>
        <div className="border border-border bg-[var(--navy-mid)] px-4 py-3">
          <div className="text-[10px] tracking-widest text-muted-foreground">ОБЩИЙ СЧЁТ</div>
          <div className="text-2xl md:text-3xl font-black text-primary font-mono tabular-nums">{Number(progress.totalScore).toFixed(1)}</div>
        </div>
        <div className="border border-border bg-[var(--navy-mid)] px-4 py-3">
          <div className="text-[10px] tracking-widest text-muted-foreground">ИДЕАЛЬНЫХ 10.9</div>
          <div className="text-2xl md:text-3xl font-black text-[var(--gold-bright)] font-mono tabular-nums">{progress.perfectTens}</div>
        </div>
      </div>

      {/* Career levels */}
      <div id="career-path" className="w-full max-w-6xl mt-10 scroll-mt-24">

        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl md:text-2xl font-black tracking-tight">РЕЖИМ КАРЬЕРЫ</h2>
          <div className="text-[10px] text-muted-foreground">За победу: <span className="text-[var(--gold-bright)] font-bold">+{CAREER_WIN_BONUS} CR</span></div>
        </div>
        <div className="relative flex flex-col gap-5 md:gap-7">
          {CAREER_LEVELS.map((lvl) => {
            const unlocked = lvl.id === 1 || careerCompleted >= lvl.id - 1;
            const done = careerCompleted >= lvl.id;
            const alignClass = lvl.id % 2 === 1 ? "md:self-start" : "md:self-end";
            const numberSideClass = lvl.id % 2 === 1 ? "md:right-[18%]" : "md:left-[18%]";
            return (
              <div key={lvl.id} className="relative flex flex-col">
                <div
                  className={`mb-2 md:mb-0 md:absolute md:top-1/2 md:-translate-y-1/2 ${numberSideClass} pointer-events-none flex items-center gap-2 ${
                    lvl.id % 2 === 1 ? "md:flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`h-12 w-12 md:h-16 md:w-16 border-2 flex items-center justify-center font-black font-mono text-xl md:text-2xl ${
                      done
                        ? "border-[var(--gold-bright)] bg-[var(--gold-bright)]/15 text-[var(--gold-bright)]"
                        : unlocked
                          ? "border-primary/70 bg-primary/10 text-primary"
                          : "border-border/50 bg-slate-950/50 text-muted-foreground"
                    }`}
                  >
                    {lvl.id}
                  </div>
                  <div className="hidden md:block h-px w-10 bg-primary/35" />
                </div>
                <button
                  disabled={!unlocked}
                  onClick={() => onPickCareer(lvl)}
                  className={`group relative w-full md:w-[58%] ${alignClass} text-left border p-4 flex flex-col gap-2 transition-colors min-h-[220px] ${
                    !unlocked
                      ? "bg-[var(--navy-deep)]/60 border-border/40 opacity-50 cursor-not-allowed"
                      : done
                        ? "bg-[var(--navy-mid)] border-[var(--gold-bright)] hover:border-primary"
                        : "bg-[var(--navy-mid)] border-border hover:border-primary"
                  }`}
                >
                  {lvl.id < CAREER_LEVEL_COUNT && (
                    <div className={`hidden md:block absolute top-full h-7 w-24 border-b border-primary/35 ${
                      lvl.id % 2 === 1
                        ? "left-[calc(100%-3rem)] rotate-[16deg] origin-left border-r"
                        : "right-[calc(100%-3rem)] -rotate-[16deg] origin-right border-l"
                    }`} />
                  )}
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] tracking-[0.3em] text-primary font-bold">{lvl.short}</div>
                    {done && <div className="text-[10px] font-bold text-[var(--gold-bright)] tracking-widest">✓ ПРОЙДЕН</div>}
                    {!unlocked && <div className="text-[10px] font-bold text-muted-foreground tracking-widest">🔒 ЗАКРЫТ</div>}
                  </div>
                  <div className="text-lg font-black tracking-tight">УРОВЕНЬ {lvl.id}</div>
                  <div className="text-sm font-bold">{lvl.name}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed flex-1">{lvl.description}</div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono mt-auto">
                    <MiniStat label="ВЫСТРЕЛЫ" v={String(lvl.shots)} />
                    <MiniStat label="ОЧКИ" v={lvl.scoring === "integer" ? "ЦЕЛЫЕ" : "10.x"} />
                    <MiniStat label="ЦЕЛЬ" v={String(lvl.winScore)} />
                  </div>
                  {!unlocked && (
                    <div className="text-[10px] text-muted-foreground text-center">Пройдите уровень {lvl.id - 1}</div>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Olympic Finals — final barrier after the full career ladder */}
        <div className="mt-8 md:mt-10">
          <button
            type="button"
            disabled={!olympicUnlocked}
            onClick={onStartOlympic}
            className={`group relative w-full overflow-hidden border-2 text-left transition-colors ${
              olympicUnlocked
                ? "border-[var(--gold-bright)] bg-gradient-to-r from-[var(--navy-deep)] via-[var(--navy-mid)] to-[var(--navy-deep)] hover:border-primary"
                : "border-border/60 bg-slate-950/80 opacity-70 cursor-not-allowed"
            }`}
          >
            <div
              className={`absolute inset-0 pointer-events-none ${
                olympicUnlocked
                  ? "bg-[linear-gradient(135deg,rgba(240,193,74,0.16)_0_14px,transparent_14px_28px)]"
                  : "bg-[linear-gradient(135deg,rgba(148,163,184,0.14)_0_14px,transparent_14px_28px)]"
              }`}
            />
            <div className="relative grid grid-cols-1 md:grid-cols-[220px_1fr_190px] gap-5 md:gap-7 items-center p-6 md:p-8 min-h-[210px]">
              <div className={`border-2 h-32 md:h-40 flex items-center justify-center ${
                olympicUnlocked ? "border-[var(--gold-bright)] bg-[var(--gold-bright)]/10" : "border-border bg-slate-900/70"
              }`}>
                <div className="text-center">
                  <div className="text-[10px] tracking-[0.45em] text-muted-foreground font-bold">ПРЕГРАДА</div>
                  <div className="mt-2 text-4xl md:text-5xl font-black tracking-widest text-[var(--gold-bright)]">
                    {olympicUnlocked ? "ОТКР" : "ЗАМК"}
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-muted-foreground">{careerCompleted}/{CAREER_LEVEL_COUNT}</div>
                </div>
              </div>

              <div>
                <div className="text-[10px] tracking-[0.45em] text-[var(--gold-bright)] font-bold">
                  {olympicUnlocked ? "ФИНАЛ ОТКРЫТ · HARDCORE · vs 5 AI" : "ОЛИМПИЙСКИЙ ФИНАЛ ЗАКРЫТ"}
                </div>
                <div className="mt-3 text-3xl md:text-5xl font-black tracking-tight leading-none">
                  Olympic Finals
                </div>
                <div className="mt-3 text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl">
                  {olympicUnlocked
                    ? "Ты прошел всю карьерную лестницу. Теперь финал: винтовка 10м, 10 выстрелов, после 4, 6 и 8 выстрелов слабейший участник выбывает."
                    : "Это последняя преграда. Чтобы выйти в финал, пройди все 5 карьерных уровней по порядку."}
                </div>
                {!olympicUnlocked && (
                  <div className="mt-5 h-3 border border-border bg-[var(--navy-deep)]">
                    <div
                      className="h-full bg-[var(--gold-bright)]"
                      style={{ width: `${Math.min(100, (careerCompleted / CAREER_LEVEL_COUNT) * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className={`shrink-0 text-center font-black tracking-widest px-5 py-5 text-xs md:text-sm ${
                olympicUnlocked
                  ? "bg-[var(--gold-bright)] text-[var(--navy-deep)] group-hover:bg-primary"
                  : "border border-border text-muted-foreground bg-slate-900/70"
              }`}>
                {olympicUnlocked ? "ВЫЙТИ В ФИНАЛ" : "НУЖНО 5/5"}
              </div>
            </div>
          </button>
        </div>
      </div>

      <DailyLeaderboards
        progress={progress}
        onPlayDiscipline={(disciplineId, rankId) => {
          const selected = DISCIPLINES.find((d) => d.id === disciplineId);
          if (selected) {
            setBriefingLeaderboardRank(rankId);
            setBriefingDiscipline(selected);
          }
        }}
      />

      <WeeklyGifts
        progress={progress}
        onClaim={onClaimDailyGift}
      />

      {/* Unified shop */}
      <div id="shop" className="w-full max-w-6xl mt-10 scroll-mt-24">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl md:text-2xl font-black tracking-tight">МАГАЗИН</h2>
          <div className="text-[10px] text-muted-foreground">10.9 = +500 CR · 10.x = +100 CR · 9.x = +50 CR</div>
        </div>

        <div className="flex gap-2 mb-4 border-b border-border">
          <button
            onClick={() => setShopTab("upgrades")}
            className={`px-4 py-2 text-xs font-bold tracking-widest border-b-2 -mb-px transition-colors ${
              shopTab === "upgrades" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >УЛУЧШЕНИЯ</button>
          <button
            onClick={() => setShopTab("skins")}
            className={`px-4 py-2 text-xs font-bold tracking-widest border-b-2 -mb-px transition-colors ${
              shopTab === "skins" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >СКИНЫ ПРИЦЕЛА</button>
        </div>

        {shopTab === "upgrades" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {UPGRADES.map((u) => {
              const owned = hasUpgrade(u.id);
              const canAfford = credits >= u.price;
              return (
                <div key={u.id} className="bg-[var(--navy-mid)] border border-border/60 p-3 flex flex-col gap-2">
                  <div>
                    <div className="text-sm font-bold tracking-wide">{u.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{u.desc}</div>
                  </div>
                  {owned ? (
                    <button disabled className="mt-auto bg-[var(--gold)] text-primary-foreground font-bold tracking-widest py-1.5 text-xs">✓ КУПЛЕНО</button>
                  ) : (
                    <button
                      disabled={!canAfford} onClick={() => buyUpgrade(u)}
                      className={`mt-auto font-bold tracking-widest py-1.5 text-xs transition-colors ${
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SKINS.map((s) => {
              const owned = progress.owned.includes(s.id);
              const equipped = progress.equipped === s.id;
              const canAfford = credits >= s.price;
              return (
                <div key={s.id} className="bg-[var(--navy-mid)] border border-border/60 p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full shrink-0" style={{
                      width: 36, height: 36, borderStyle: "solid", borderWidth: 3,
                      borderColor: s.ring,
                      boxShadow: s.glow ?? "0 0 0 1px rgba(255,255,255,0.08)",
                    }} />
                    <div className="flex-1">
                      <div className="text-sm font-bold tracking-wide">{s.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {s.goldHalo ? "Золотой ореол." : s.id === "default" ? "Базовый прицел." : "Скин прицела."}
                      </div>
                    </div>
                  </div>
                  {equipped ? (
                    <button disabled className="mt-auto bg-[var(--gold)] text-primary-foreground font-bold tracking-widest py-1.5 text-xs">✓ ЭКИПИРОВАН</button>
                  ) : owned ? (
                    <button onClick={() => equipSkin(s)} className="mt-auto bg-primary text-primary-foreground font-bold tracking-widest py-1.5 text-xs hover:bg-[var(--gold-bright)] transition-colors">ВЫБРАТЬ</button>
                  ) : (
                    <button
                      disabled={!canAfford} onClick={() => buySkin(s)}
                      className={`mt-auto font-bold tracking-widest py-1.5 text-xs transition-colors ${
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

      <div className="mt-8 text-[10px] tracking-widest text-muted-foreground text-center max-w-xl">
        [ПКМ] Задержка дыхания · [ЛКМ] Выстрел · [R] Перезарядка
      </div>
    </div>
  );
}

function RangeCoachGuide({
  discipline,
  holdWindow,
  onClose,
}: {
  discipline: Discipline;
  holdWindow: number;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const steps = disciplineRangeCoachSteps(discipline, holdWindow);
  const current = steps[step] ?? steps[0];
  const last = step >= steps.length - 1;

  return (
    <div className="absolute inset-0 z-50 pointer-events-auto">
      <div className="absolute inset-0 bg-slate-950/72" />
      <motion.div
        key={current.id}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        className={`absolute border-2 border-[var(--gold-bright)] bg-transparent shadow-[0_0_0_9999px_rgba(2,6,23,0.28),0_0_36px_rgba(245,190,80,0.65)] ${current.spot}`}
      />
      <motion.div
        key={`${current.id}-arrow`}
        initial={{ opacity: 0, x: current.arrowDx * -0.35, y: current.arrowDy * -0.35 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.22 }}
        className={`absolute font-black text-[var(--gold-bright)] drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)] ${current.arrow}`}
      >
        {current.arrowText}
      </motion.div>
      <div className={`absolute w-[min(360px,calc(100%-32px))] border border-[var(--gold-bright)]/70 bg-slate-950/92 text-foreground shadow-2xl ${current.card}`}>
        <div className="border-b border-border/70 bg-slate-900/80 px-4 py-3">
          <div className="text-[10px] tracking-[0.38em] text-[var(--gold-bright)] font-black">ТРЕНЕР НА РУБЕЖЕ</div>
          <div className="mt-1 text-xs text-muted-foreground font-mono">
            {step + 1}/{steps.length} · {discipline.short}
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="text-lg font-black tracking-tight">{current.title}</div>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{current.text}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="border border-border px-3 py-2 text-[10px] font-bold tracking-widest text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              ПРОПУСТИТЬ
            </button>
            <button
              type="button"
              onClick={() => {
                if (last) onClose();
                else setStep((value) => value + 1);
              }}
              className="bg-primary text-primary-foreground px-4 py-2 text-[10px] font-black tracking-widest hover:bg-[var(--gold-bright)] transition-colors"
            >
              {last ? "ПОНЯЛ, НАЧАТЬ" : "ДАЛЬШЕ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function disciplineRangeCoachSteps(discipline: Discipline, holdWindow: number) {
  const disciplineIntro: Record<DisciplineId, { title: string; text: string }> = {
    ar10: {
      title: "Пневматическая винтовка 10 м",
      text: "Здесь главное - спокойно удержать центр. Не дергай мышь: навелся, коротко задержал дыхание, плавно нажал левую кнопку.",
    },
    rifle50: {
      title: "Винтовка 50 м",
      text: "Дистанция длиннее, поэтому любая ошибка заметнее. Перед выстрелом успокой прицел, не тяни дыхание слишком долго и нажимай без рывка.",
    },
    ap10: {
      title: "Пистолет 10 м",
      text: "Пистолет сильнее показывает ошибки руки. Держи мушку ровно, не лови идеальный момент слишком долго и нажимай мягко.",
    },
    rfp25: {
      title: "Скоростной пистолет 25 м",
      text: "Здесь важно не суетиться. Быстро навелся, выровнял мушку, плавно нажал. Резкий клик почти всегда уводит пробоину.",
    },
    boar: {
      title: "Бегущий кабан 10 м",
      text: "Это движущаяся мишень. Не пытайся догнать ее резким рывком: веди прицел рядом с целью плавно, как будто корпус поворачивается вместе с ней.",
    },
  };

  const targetText = discipline.id === "boar"
    ? "Мишень едет по горизонтали. Держи прицел чуть впереди движения и не добавляй лишние движения вверх-вниз. Выстрел делай, когда ведение стало ровным."
    : "Это сама мишень. Твоя задача - привести прицел к центру, дать ему успокоиться и стрелять без резкого движения мышью.";

  return [
    {
      id: "discipline",
      title: disciplineIntro[discipline.id].title,
      text: disciplineIntro[discipline.id].text,
      spot: "left-1/2 top-1/2 w-[250px] h-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full md:w-[390px] md:h-[390px]",
      arrow: "left-[calc(50%+90px)] top-[calc(50%-210px)] md:left-[calc(50%+145px)] md:top-[calc(50%-255px)] text-6xl rotate-[38deg]",
      arrowText: "↙",
      arrowDx: -42,
      arrowDy: 42,
      card: "left-4 bottom-28 md:left-8 md:bottom-32",
    },
    {
      id: "mode",
      title: "Сначала пробные",
      text: "Сверху слева два режима. ПРОБНЫЕ - можно пристреляться без счета. ЗАЧЕТ - уже идет результат. Начни с пробных, потом переходи в зачет.",
      spot: "top-2 left-2 w-[315px] h-[44px] md:top-4 md:left-4 md:w-[420px] md:h-[48px]",
      arrow: "top-[54px] left-[64px] md:top-[70px] md:left-[150px] text-5xl rotate-[-18deg]",
      arrowText: "↑",
      arrowDx: 0,
      arrowDy: -40,
      card: "left-4 top-28 md:left-8 md:top-32",
    },
    {
      id: "target",
      title: discipline.id === "boar" ? "Веди движущуюся цель" : "Целься в центр",
      text: targetText,
      spot: "left-1/2 top-1/2 w-[260px] h-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full md:w-[410px] md:h-[410px]",
      arrow: "left-[calc(50%-110px)] top-[calc(50%-210px)] md:left-[calc(50%-175px)] md:top-[calc(50%-270px)] text-6xl rotate-[-8deg]",
      arrowText: "↓",
      arrowDx: 0,
      arrowDy: 44,
      card: "right-4 top-24 md:right-8 md:top-28",
    },
    {
      id: "breath",
      title: "Правая кнопка - дыхание",
      text: `Зажми правую кнопку мыши, чтобы прицел стал спокойнее. Держи недолго: около ${holdWindow} сек. Если не успел выстрелить - отпусти и начни заново.`,
      spot: "right-3 bottom-5 w-[200px] h-[60px] md:right-6 md:bottom-6 md:w-[250px]",
      arrow: "right-[150px] bottom-[86px] md:right-[230px] md:bottom-[96px] text-5xl rotate-[22deg]",
      arrowText: "↘",
      arrowDx: 35,
      arrowDy: 30,
      card: "right-4 bottom-32 md:right-8 md:bottom-36",
    },
    {
      id: "shot",
      title: "Левая кнопка - выстрел",
      text: "Стреляй левой кнопкой мыши. Нажимай спокойно, не резко. Если внизу написано EMPTY, нажми R - это перезарядка.",
      spot: "left-1/2 top-1/2 w-[130px] h-[130px] -translate-x-1/2 -translate-y-1/2 rounded-full md:w-[165px] md:h-[165px]",
      arrow: "left-[calc(50%+70px)] top-[calc(50%-132px)] md:left-[calc(50%+88px)] md:top-[calc(50%-150px)] text-6xl rotate-[32deg]",
      arrowText: "↙",
      arrowDx: -38,
      arrowDy: 38,
      card: "left-4 top-28 md:left-8 md:top-32",
    },
    {
      id: "adjustments",
      title: "Стрелки - поправки",
      text: "После пробного выстрела смотри, куда ушла пробоина. Попал левее - нажми стрелку влево. Попал выше - нажми вверх. Куда попал, туда и крутишь.",
      spot: "left-2 bottom-20 w-[245px] h-[185px] md:left-4 md:bottom-24",
      arrow: "left-[230px] bottom-[190px] md:left-[260px] md:bottom-[220px] text-6xl rotate-[16deg]",
      arrowText: "↙",
      arrowDx: -40,
      arrowDy: 35,
      card: "left-4 top-28 md:left-8 md:top-32",
    },
  ];
}

function rangeCoachSteps(discipline: Discipline, holdWindow: number) {
  const movingTargetText = discipline.id === "boar"
    ? "Мишень едет в сторону. Веди прицел рядом с ней плавно, без рывков вверх и вниз."
    : "Наведи прицел ближе к центру. Не дергай мышь. Дай прицелу спокойно остановиться и только потом стреляй.";

  return [
    {
      id: "mode",
      title: "Сначала пробные",
      text: "Вот здесь два режима. ПРОБНЫЕ - это тренировка без счета. ЗАЧЕТ - это уже результат. Сначала сделай пару пробных.",
      spot: "top-2 left-20 w-[230px] h-[42px] md:top-4 md:left-36 md:w-[280px] md:h-[48px]",
      arrow: "top-[58px] left-[150px] md:top-[78px] md:left-[250px] text-5xl rotate-[-28deg]",
      arrowText: "↖",
      arrowDx: -40,
      arrowDy: -25,
      card: "top-24 left-4 md:top-28 md:left-8",
    },
    {
      id: "target",
      title: "Работай по мишени",
      text: movingTargetText,
      spot: "left-1/2 top-1/2 w-[250px] h-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full md:left-[calc(50%-180px)] md:w-[360px] md:h-[360px]",
      arrow: "left-[calc(50%-170px)] top-[calc(50%-225px)] md:left-[calc(50%-425px)] md:top-[calc(50%-300px)] text-6xl rotate-[-20deg]",
      arrowText: "↘",
      arrowDx: 45,
      arrowDy: 45,
      card: "right-4 top-20 md:right-8 md:top-28",
    },
    {
      id: "breath",
      title: "Задержка дыхания",
      text: `Правая кнопка мыши делает прицел спокойнее. Держи ее недолго: примерно ${holdWindow} сек. Если не успел выстрелить, отпусти и начни заново.`,
      spot: "right-4 bottom-5 w-[190px] h-[58px] md:right-[384px] md:bottom-6 md:w-[240px]",
      arrow: "right-[130px] bottom-[84px] md:right-[560px] md:bottom-[96px] text-5xl rotate-[22deg]",
      arrowText: "↘",
      arrowDx: 35,
      arrowDy: 30,
      card: "right-4 bottom-32 md:right-8 md:bottom-36",
    },
    {
      id: "shot",
      title: "Выстрел",
      text: "Левая кнопка мыши стреляет. Нажимай ее мягко, без резкого рывка. Если внизу написано EMPTY, нажми R для перезарядки.",
      spot: "left-1/2 top-1/2 w-[120px] h-[120px] -translate-x-1/2 -translate-y-1/2 rounded-full md:left-[calc(50%-180px)] md:w-[150px] md:h-[150px]",
      arrow: "left-[calc(50%+70px)] top-[calc(50%-125px)] md:left-[calc(50%-85px)] md:top-[calc(50%-150px)] text-6xl rotate-[32deg]",
      arrowText: "↙",
      arrowDx: -38,
      arrowDy: 38,
      card: "left-4 top-24 md:left-8 md:top-32",
    },
    {
      id: "adjustments",
      title: "Поправки после пробных",
      text: "Если пробный выстрел попал левее центра, нажимай стрелку влево. Если выше центра, нажимай вверх. Куда попал - туда и нажимай.",
      spot: "left-2 bottom-20 w-[245px] h-[185px] md:left-4 md:bottom-24",
      arrow: "left-[250px] bottom-[190px] md:left-[270px] md:bottom-[230px] text-6xl rotate-[16deg]",
      arrowText: "↙",
      arrowDx: -40,
      arrowDy: 35,
      card: "left-4 top-24 md:left-8 md:top-28",
    },
  ];
}

function AccountPrompt({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md border border-[var(--gold-bright)]/70 bg-[var(--navy-mid)] p-6 shadow-2xl"
          >
            <div className="text-[10px] tracking-[0.4em] text-[var(--gold-bright)] font-black">ТРЕНЕР</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Хочешь сохранить прогресс?</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Создай аккаунт, и игра запомнит твои кредиты, рекорды, значки и открытые уровни. Так ты не потеряешь результат после закрытия страницы.
            </p>
            <div className="mt-5 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="border border-border px-4 py-2 text-xs font-bold tracking-widest text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
              >
                ПРОДОЛЖИТЬ ТАК
              </button>
              <Link
                to="/auth"
                onClick={() => {
                  localStorage.setItem("authDefaultMode", "signup");
                  localStorage.setItem("postAuthTournamentPrompt", "1");
                  onClose();
                }}
                className="bg-primary text-primary-foreground px-5 py-2 text-center text-xs font-black tracking-widest hover:bg-[var(--gold-bright)] transition-colors"
              >
                СОЗДАТЬ АККАУНТ
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TournamentPrompt({
  open,
  onClose,
  onPlay,
}: {
  open: boolean;
  onClose: () => void;
  onPlay: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md border border-[var(--gold-bright)]/70 bg-[var(--navy-mid)] p-6 shadow-2xl"
          >
            <div className="text-[10px] tracking-[0.4em] text-[var(--gold-bright)] font-black">НОВЫЙ ВЫЗОВ</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Попробуем турнир дня?</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Теперь у тебя есть аккаунт. Можно сыграть серию из 10 выстрелов и попасть в ежедневную таблицу. Соперники обновляются каждый день.
            </p>
            <div className="mt-5 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="border border-border px-4 py-2 text-xs font-bold tracking-widest text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
              >
                ПОЗЖЕ
              </button>
              <button
                type="button"
                onClick={onPlay}
                className="bg-primary text-primary-foreground px-5 py-2 text-xs font-black tracking-widest hover:bg-[var(--gold-bright)] transition-colors"
              >
                УЧАСТВОВАТЬ
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WeeklyGifts({
  progress,
  onClaim,
}: {
  progress: Progress;
  onClaim: () => void;
}) {
  const today = localTodayKey();
  const alreadyClaimed = progress.dailyGift.lastClaimDate === today;
  const currentDay = nextGiftDay(progress.dailyGift, today);
  const currentGift = DAILY_GIFTS.find((gift) => gift.day === currentDay) ?? DAILY_GIFTS[0];
  const chromeSkin = SKINS.find((skin) => skin.id === "chrome");

  return (
    <section id="weekly-gifts" className="w-full max-w-6xl mt-10 border border-[var(--gold-bright)]/45 bg-[var(--navy-mid)]/70 p-4 md:p-5 scroll-mt-24">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-5">
        <div>
          <div className="text-[10px] tracking-[0.45em] text-[var(--gold-bright)] font-bold">ЕЖЕДНЕВНЫЕ ПОДАРКИ</div>
          <h2 className="mt-1 text-xl md:text-2xl font-black tracking-tight">Неделя наград</h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
            Заходи каждый день и забирай подарок. В начале дают кредиты, а на 7-й день открывается скин прицела.
          </p>
        </div>

        <div className="border border-[var(--gold-bright)]/55 bg-slate-950/45 px-4 py-3 min-w-[220px]">
          <div className="text-[10px] tracking-widest text-muted-foreground">СЕГОДНЯ</div>
          <div className="mt-1 text-lg font-black text-[var(--gold-bright)]">{rewardLabel(currentGift.reward)}</div>
          <button
            type="button"
            onClick={onClaim}
            disabled={alreadyClaimed}
            className={`mt-3 w-full px-4 py-2 text-[10px] font-black tracking-widest transition-colors ${
              alreadyClaimed
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-[var(--gold-bright)]"
            }`}
          >
            {alreadyClaimed ? "УЖЕ ЗАБРАНО" : "ЗАБРАТЬ ПОДАРОК"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {DAILY_GIFTS.map((gift) => {
          const active = gift.day === currentDay;
          const claimedToday = alreadyClaimed && active;
          const skin = gift.reward.type === "skin" ? SKINS.find((item) => item.id === gift.reward.skinId) : null;

          return (
            <div
              key={gift.day}
              className={`border px-3 py-3 min-h-[120px] flex flex-col ${
                active
                  ? "border-[var(--gold-bright)] bg-[var(--gold-bright)]/10 text-foreground"
                  : "border-border/60 bg-slate-950/35 text-muted-foreground"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] tracking-widest">ДЕНЬ {gift.day}</div>
                {claimedToday && <div className="text-[10px] text-primary font-black">OK</div>}
              </div>
              <div className="mt-2 text-sm font-black">{gift.title}</div>
              <div className="mt-auto pt-3">
                {skin ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="h-8 w-8 rounded-full border-[3px]"
                      style={{
                        borderColor: skin.ring,
                        boxShadow: skin.glow ?? "0 0 0 1px rgba(255,255,255,0.08)",
                      }}
                    />
                    <div className="text-[11px] font-bold text-[var(--gold-bright)] leading-tight">
                      {chromeSkin?.name ?? rewardLabel(gift.reward)}
                    </div>
                  </div>
                ) : (
                  <div className="text-lg font-black font-mono text-[var(--gold-bright)]">
                    {rewardLabel(gift.reward)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DailyLeaderboards({
  progress,
  onPlayDiscipline,
}: {
  progress: Progress;
  onPlayDiscipline: (disciplineId: DisciplineId, rankId: LeaderboardRankId) => void;
}) {
  const [selectedDiscipline, setSelectedDiscipline] = useState<DisciplineId>("ar10");
  const [selectedRank, setSelectedRank] = useState<LeaderboardRankId>("rookie");
  const date = todayKey();
  const key = leaderboardKey(date, selectedDiscipline, selectedRank);
  const playerScore = progress.dailyScores[key]?.score;
  const board = makeDailyLeaderboard(date, selectedDiscipline, selectedRank, playerScore).slice(0, 8);
  const selectedRankInfo = LEADERBOARD_RANKS.find((rank) => rank.id === selectedRank) ?? LEADERBOARD_RANKS[0];
  const playerPlace = makeDailyLeaderboard(date, selectedDiscipline, selectedRank, playerScore).find((entry) => entry.id === "player")?.place;
  const earnedBadges = progress.badges.filter((badge) => badge.startsWith("daily-1-"));

  return (
    <section id="daily-tournament" className="w-full max-w-6xl mt-10 border border-border/70 bg-[var(--navy-mid)]/65 p-4 md:p-5 scroll-mt-24">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5">
        <div>
          <div className="text-[10px] tracking-[0.45em] text-primary font-bold">ЕЖЕДНЕВНЫЕ ТАБЛИЦЫ</div>
          <h2 className="mt-1 text-xl md:text-2xl font-black tracking-tight">Соревнование дня</h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
            Каждый день появляются новые соперники. Твой лучший результат за сегодня попадает в таблицу, первое место открывает значок мастерства.
          </p>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">ДАТА: {date}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr] gap-4">
        <div className="space-y-4">
          <div>
            <div className="text-[10px] tracking-widest text-muted-foreground mb-2">ДИСЦИПЛИНА</div>
            <div className="grid grid-cols-1 gap-2">
              {DISCIPLINES.map((disciplineItem) => (
                <button
                  key={disciplineItem.id}
                  type="button"
                  onClick={() => setSelectedDiscipline(disciplineItem.id)}
                  className={`text-left border px-3 py-2 transition-colors ${
                    selectedDiscipline === disciplineItem.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-slate-950/35 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="text-xs font-bold">{disciplineItem.name}</div>
                  <div className="text-[10px] font-mono mt-0.5">{disciplineItem.short}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] tracking-widest text-muted-foreground mb-2">УРОВЕНЬ</div>
            <div className="grid grid-cols-1 gap-2">
              {LEADERBOARD_RANKS.map((rank) => (
                <button
                  key={rank.id}
                  type="button"
                  onClick={() => setSelectedRank(rank.id)}
                  className={`text-left border px-3 py-2 transition-colors ${
                    selectedRank === rank.id
                      ? "border-[var(--gold-bright)] bg-[var(--gold-bright)]/10 text-foreground"
                      : "border-border/60 bg-slate-950/35 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="text-xs font-bold">{rank.name}</div>
                  <div className="text-[10px] mt-0.5">{rank.subtitle}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border border-border/60 bg-slate-950/45">
          <div className="border-b border-border/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-[10px] tracking-[0.35em] text-[var(--gold-bright)] font-bold">{selectedRankInfo.name}</div>
              <div className="text-sm font-black mt-1">{DISCIPLINES.find((d) => d.id === selectedDiscipline)?.name}</div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="text-[10px] text-muted-foreground font-mono">
                {typeof playerScore === "number" ? `ВАШЕ МЕСТО: ${playerPlace}` : "ВАШ РЕЗУЛЬТАТ ЕЩЕ НЕ ЗАПИСАН"}
              </div>
              <button
                type="button"
                onClick={() => onPlayDiscipline(selectedDiscipline, selectedRank)}
                className="bg-primary text-primary-foreground px-4 py-2 text-[10px] font-black tracking-widest hover:bg-[var(--gold-bright)] transition-colors"
              >
                ИГРАТЬ
              </button>
            </div>
          </div>

          <div className="divide-y divide-border/45">
            {board.map((entry) => (
              <div
                key={entry.id}
                className={`grid grid-cols-[48px_1fr_82px] gap-3 items-center px-4 py-3 ${
                  entry.id === "player" ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                }`}
              >
                <div className="font-mono text-sm font-black tabular-nums">{entry.place}</div>
                <div>
                  <div className="text-sm font-bold">{entry.name}</div>
                  <div className="text-[10px] tracking-widest">{entry.simulated ? "АКТИВЕН СЕГОДНЯ" : "ВАШ ЛУЧШИЙ РЕЗУЛЬТАТ"}</div>
                </div>
                <div className="text-right font-mono text-lg font-black text-[var(--gold-bright)]">{entry.score.toFixed(1)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <div className="text-[10px] tracking-[0.35em] text-primary font-bold mb-3">ЗНАЧКИ МАСТЕРСТВА</div>
        {earnedBadges.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {earnedBadges.map((badge) => (
              <div key={badge} className="border border-[var(--gold-bright)]/55 bg-[var(--gold-bright)]/10 px-3 py-3">
                <div className="text-[10px] tracking-widest text-[var(--gold-bright)] font-bold">ПЕРВОЕ МЕСТО</div>
                <div className="text-sm font-black mt-1">{badgeLabel(badge)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground border border-border/50 bg-slate-950/35 px-3 py-3">
            Значков пока нет. Займи первое место в ежедневной таблице, и здесь появится отметка твоего уровня.
          </div>
        )}
      </div>
    </section>
  );
}

function DisciplineBriefing({
  discipline,
  onBack,
  onStart,
}: {
  discipline: Discipline;
  onBack: () => void;
  onStart: () => void;
}) {
  const notes = briefingNotes(discipline.id);

  return (
    <div className="min-h-screen px-4 md:px-6 py-8 bg-[radial-gradient(ellipse_at_top,_var(--navy-mid),_var(--navy-deep))] text-foreground">
      <div className="w-full max-w-6xl mx-auto">
        <button
          type="button"
          onClick={onBack}
          className="border border-border px-4 py-2 text-xs font-bold tracking-widest text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
        >
          НАЗАД
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 mt-6 items-stretch">
          <section className="border border-border/70 bg-slate-950/55 p-5 flex flex-col">
            <div className="text-[10px] tracking-[0.45em] text-primary font-bold">ВЫБРАНА ДИСЦИПЛИНА</div>
            <h1 className="mt-3 text-3xl md:text-5xl font-black tracking-tight leading-none">{discipline.name}</h1>
            <div className="mt-3 text-sm text-muted-foreground leading-relaxed">{discipline.caption}</div>

            <div className="my-6 border border-border/60 bg-slate-900/70 min-h-[220px] flex items-center justify-center">
              <WeaponIllustration disciplineId={discipline.id} large />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-auto">
              <MiniStat label="ПРИЦЕЛ" v={discipline.sight === "diopter" ? "ДИОПТР" : "ОТКРЫТЫЙ"} />
              <div className={`border px-2 py-1 ${difficultyStyle(discipline.id)}`}>
                <div className="text-[8px] tracking-widest opacity-75">СЛОЖНОСТЬ</div>
                <div className="font-bold">{difficultyLabel(discipline.id)}</div>
              </div>
            </div>
          </section>

          <section className="border border-[var(--gold-bright)]/40 bg-[var(--navy-mid)]/70 p-5 md:p-6 flex flex-col">
            <div className="text-[10px] tracking-[0.45em] text-[var(--gold-bright)] font-bold">ТРЕНЕРСКИЙ РАЗБОР</div>
            <div className="mt-4 space-y-3">
              {notes.map((note, index) => (
                <div key={note.title} className="border border-border/60 bg-slate-950/45 p-4">
                  <div className="text-[10px] tracking-[0.28em] text-primary font-mono">ШАГ {index + 1}</div>
                  <div className="mt-2 text-lg font-black tracking-tight">{note.title}</div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{note.text}</p>
                </div>
              ))}
            </div>

            <div className="mt-auto pt-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="text-[11px] leading-relaxed text-muted-foreground max-w-md">
                Простая схема: наведи прицел, зажми правую кнопку мыши, мягко нажми левую. Если долго не получается выстрелить, отпусти и начни заново.
              </div>
              <button
                type="button"
                onClick={onStart}
                className="bg-primary text-primary-foreground px-6 py-3 text-xs font-black tracking-widest hover:bg-[var(--gold-bright)] transition-colors"
              >
                НА РУБЕЖ
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function briefingNotes(id: DisciplineId) {
  const common = [
    {
      title: "Как целиться",
      text: "Наведи прицел ближе к центру мишени. Не пытайся резко поймать точку. Двигай мышь медленно и спокойно.",
    },
    {
      title: "Дыхание",
      text: "Правая кнопка мыши делает прицел спокойнее. Держи ее недолго. Если держать слишком долго, прицел начнет дрожать сильнее.",
    },
    {
      title: "Как стрелять",
      text: "Левая кнопка мыши делает выстрел. Нажимай мягко. Если резко кликнуть, прицел дернется и пуля уйдет в сторону.",
    },
  ];

  const specific: Record<DisciplineId, { title: string; text: string }> = {
    ar10: {
      title: "Пневматическая винтовка 10 м",
      text: "Это самый понятный режим для старта. Наводи прицел в центр, держи мышь спокойно и не спеши с нажатием.",
    },
    boar: {
      title: "Бегущая мишень",
      text: "Мишень двигается. Не пытайся резко догнать ее мышью. Веди прицел рядом с мишенью плавно и стреляй чуть заранее.",
    },
    rifle50: {
      title: "Винтовка 50 м",
      text: "Здесь расстояние больше, поэтому маленькие ошибки заметнее. Смотри на ветер и нажимай левую кнопку спокойно.",
    },
    ap10: {
      title: "Пневматический пистолет 10 м",
      text: "Пистолет сильнее шатается. Держи мышь мягко, не зажимай руку и нажимай левую кнопку без рывка.",
    },
    rfp25: {
      title: "Скоростной пистолет 25 м",
      text: "Тут важен темп. Не паникуй. Лучше нажать спокойно и точно, чем быстро дернуть мышь.",
    },
  };

  return [specific[id], ...common];
}

function difficultyLabel(id: DisciplineId) {
  const labels: Record<DisciplineId, string> = {
    ar10: "ЛЕГКАЯ",
    boar: "СЛОЖНАЯ",
    rifle50: "СЛОЖНАЯ",
    ap10: "СРЕДНЯЯ",
    rfp25: "ВЫСОКАЯ",
  };
  return labels[id];
}

function difficultyStyle(id: DisciplineId) {
  const styles: Record<DisciplineId, string> = {
    ar10: "border-emerald-400/50 bg-emerald-500/10 text-emerald-200",
    boar: "border-amber-400/50 bg-amber-500/10 text-amber-200",
    rifle50: "border-amber-400/50 bg-amber-500/10 text-amber-200",
    ap10: "border-sky-400/50 bg-sky-500/10 text-sky-200",
    rfp25: "border-rose-400/50 bg-rose-500/10 text-rose-200",
  };
  return styles[id];
}

function WeaponIllustration({ disciplineId, large = false }: { disciplineId: DisciplineId; large?: boolean }) {
  const width = large ? 340 : 150;
  const height = large ? 180 : 92;
  const isPistol = disciplineId === "ap10" || disciplineId === "rfp25";
  const isRunning = disciplineId === "boar";
  const isLongRange = disciplineId === "rifle50";

  return (
    <svg width={width} height={height} viewBox="0 0 180 100" role="img" aria-label="weapon illustration">
      <rect x="8" y="80" width="164" height="2" fill="#334155" opacity="0.7" />
      {isPistol ? (
        <g>
          <path d="M43 44 H112 C120 44 126 49 129 56 L135 72 H113 L106 60 H82 L78 81 H56 L62 60 H43 Z" fill="#0f172a" stroke="#cbd5e1" strokeWidth="2" />
          <rect x="52" y="35" width="72" height="13" fill="#1e293b" stroke="#cbd5e1" strokeWidth="2" />
          <rect x="121" y="38" width="30" height="6" fill="#64748b" />
          <rect x="64" y="60" width="16" height="30" rx="2" fill="#334155" stroke="#cbd5e1" strokeWidth="1.5" />
          <path d="M91 60 C90 70 94 75 101 77" fill="none" stroke="#94a3b8" strokeWidth="2" />
          <circle cx="62" cy="41" r="2" fill="#22d3ee" />
          {disciplineId === "rfp25" && <rect x="126" y="30" width="25" height="5" fill="#fbbf24" />}
        </g>
      ) : (
        <g>
          <path d="M24 59 C39 43 58 43 76 54 L112 54 C123 54 132 59 137 68 L146 82 H122 L113 67 H72 C57 67 42 74 28 82 H15 C15 74 18 65 24 59 Z" fill="#0f172a" stroke="#cbd5e1" strokeWidth="2" />
          <rect x="61" y="44" width="75" height="10" fill="#1e293b" stroke="#cbd5e1" strokeWidth="1.7" />
          <rect x="132" y="47" width="42" height="4" fill="#94a3b8" />
          <rect x="76" y="34" width="42" height="8" rx="4" fill="#334155" stroke="#cbd5e1" strokeWidth="1.5" />
          <circle cx="52" cy="55" r="5" fill="#22d3ee" opacity="0.8" />
          <path d="M88 66 C87 75 91 79 98 81" fill="none" stroke="#94a3b8" strokeWidth="2" />
          {isLongRange && (
            <>
              <rect x="91" y="28" width="35" height="6" fill="#fbbf24" />
              <rect x="139" y="44" width="20" height="9" fill="#64748b" />
            </>
          )}
          {isRunning && (
            <>
              <rect x="18" y="18" width="124" height="3" fill="#64748b" />
              <circle cx="145" cy="20" r="10" fill="#f4f4ef" stroke="#cbd5e1" strokeWidth="1.5" />
              <circle cx="145" cy="20" r="4" fill="#0f172a" />
            </>
          )}
        </g>
      )}
    </svg>
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
          <circle cx={h.x} cy={h.y} r={BULLET_PX / 2} fill={h.sighting ? "#ffe5e5" : "#fff"} stroke={h.sighting ? "#d11" : "#000"} strokeWidth={h.sighting ? 1.2 : 0.8} />
          <circle cx={h.x} cy={h.y} r={BULLET_PX / 2 - 1.2} fill={h.sighting ? "#e11d48" : "#1a1a1a"} />
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
    <div className="absolute pointer-events-none z-50" style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}>
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
    <div className="absolute pointer-events-none z-50" style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}>
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
