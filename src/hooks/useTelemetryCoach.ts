import { useEffect, useRef } from "react";
import { getAiCoachFeedback } from "@/lib/api/coach.functions";
import type { CoachMessageType, CoachShotTelemetry, TelemetryFeedbackInput } from "@/types/coach";

const BREATH_FEEDBACK = [
  "Долго держал дыхание, и рука начала плыть. В следующий раз не тяни: поймал картинку, мягко нажал, выдохнул.",
  "Передержал прицел. Лучше отпусти, вдох-выдох, и заходи на выстрел заново.",
] as const;

const MATCH_EXCELLENT = [
  "Вот это чисто. Прицел вел спокойно, спуск не дернул.",
  "Отличный выстрел. Сохрани этот темп и не начинай спешить.",
] as const;

const MATCH_STABLE = [
  "Нормальный рабочий выстрел. Только не зажимай плечо, держи движение мягче.",
  "Хорошо удержал. Чуть спокойнее на спуске, и будет плотнее.",
] as const;

const MATCH_LOW = [
  "Поторопился со спуском. Смотри на мушку и дави плавно, без рывка.",
  "Выстрел сорвал рукой. Расслабь кисть и начни обработку спокойнее.",
] as const;

const LEVEL_TACTICS: Record<number, string> = {
  2: "Мишень идет по горизонтали. Не дергай стволом вверх-вниз, веди корпусом и стреляй на упреждение.",
  3: "На 50 метрах мелочи уже решают. Перед выстрелом глянь ветер и не торопи спуск.",
};

type UseTelemetryCoachParams = {
  levelId: number | null;
  sessionId: number;
  isSightingMode: boolean;
  lastShot: CoachShotTelemetry | null;
  holdBreathTime: number;
  isHoldingBreath: boolean;
  addCoachMessage: (text: string, type: CoachMessageType) => void;
};

function pick<T>(items: readonly T[], seed: number): T {
  return items[Math.abs(Math.round(seed * 10)) % items.length];
}

function conciseCorrection(clicks: number, direction: string) {
  return `${clicks} ${direction}`;
}

export function getTelemetryFeedback(shotData: TelemetryFeedbackInput): string {
  const { score, deltaX, deltaY, clickX, clickY, isSightingMode, holdBreathTime } = shotData;

  if (holdBreathTime > 5 && score < 9.5) {
    return pick(BREATH_FEEDBACK, score + deltaX + deltaY);
  }

  if (!isSightingMode) {
    if (score >= 10.5) return pick(MATCH_EXCELLENT, score + deltaX);
    if (score >= 9.5) return pick(MATCH_STABLE, score + deltaY);
    return pick(MATCH_LOW, score + deltaX - deltaY);
  }

  const absClickX = Math.abs(clickX);
  const absClickY = Math.abs(clickY);
  const hasCorrection = absClickX > 0 || absClickY > 0;

  if (score >= 10.8 && !hasCorrection) {
    return "Центр пойман. Оставляй поправки как есть и переходи в зачетную серию.";
  }

  if (absClickX >= absClickY && absClickX > 0) {
    return conciseCorrection(absClickX, clickX < 0 ? "влево" : "вправо");
  }

  if (absClickY > 0) {
    return conciseCorrection(absClickY, clickY < 0 ? "вверх" : "вниз");
  }

  return "Попадание близко к центру. Поправки пока не трогай, сделай еще одну пробную для проверки.";
}

function feedbackType(shotData: TelemetryFeedbackInput): CoachMessageType {
  if (shotData.holdBreathTime > 5 && shotData.score < 9.5) return "warning";
  if (shotData.isSightingMode && shotData.score >= 10.8 && Math.abs(shotData.clickX) === 0 && Math.abs(shotData.clickY) === 0) return "success";
  if (!shotData.isSightingMode && shotData.score >= 10.5) return "success";
  if (!shotData.isSightingMode && shotData.score < 9.5) return "warning";
  return shotData.isSightingMode ? "telemetry" : "tactical";
}

export function useTelemetryCoach({
  levelId,
  sessionId,
  isSightingMode,
  lastShot,
  holdBreathTime,
  isHoldingBreath,
  addCoachMessage,
}: UseTelemetryCoachParams) {
  const announcedLevelsRef = useRef<Set<number>>(new Set());
  const breathWarningActiveRef = useRef(false);
  const lastShotIdRef = useRef<number | null>(null);

  useEffect(() => {
    announcedLevelsRef.current.clear();
    breathWarningActiveRef.current = false;
    lastShotIdRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!levelId || !LEVEL_TACTICS[levelId] || announcedLevelsRef.current.has(levelId)) return;
    announcedLevelsRef.current.add(levelId);
    addCoachMessage(LEVEL_TACTICS[levelId], "tactical");
  }, [addCoachMessage, levelId]);

  useEffect(() => {
    if (isHoldingBreath && holdBreathTime > 5 && !breathWarningActiveRef.current) {
      breathWarningActiveRef.current = true;
      addCoachMessage(
        "Долго держишь. Опусти прицел, вдох-выдох, и начни заново. Так рука будет спокойнее.",
        "warning",
      );
      return;
    }

    if (!isHoldingBreath || holdBreathTime <= 5) {
      breathWarningActiveRef.current = false;
    }
  }, [addCoachMessage, holdBreathTime, isHoldingBreath]);

  useEffect(() => {
    if (!lastShot || lastShotIdRef.current === lastShot.id) return;
    lastShotIdRef.current = lastShot.id;
    let cancelled = false;

    const shotData: TelemetryFeedbackInput = {
      score: lastShot.score,
      deltaX: lastShot.deltaX,
      deltaY: lastShot.deltaY,
      clickX: lastShot.clickX,
      clickY: lastShot.clickY,
      isSightingMode,
      holdBreathTime: lastShot.holdBreathTime,
      levelId,
    };

    const fallback = getTelemetryFeedback(shotData);
    const type = feedbackType(shotData);
    const hasSightingCorrection = isSightingMode && (Math.abs(shotData.clickX) > 0 || Math.abs(shotData.clickY) > 0);

    if (hasSightingCorrection) {
      addCoachMessage(fallback, type);
      return;
    }

    void getAiCoachFeedback({ data: { ...shotData, fallback } })
      .then((result) => {
        if (!cancelled) addCoachMessage(result.text, type);
      })
      .catch(() => {
        if (!cancelled) addCoachMessage(fallback, type);
      });

    return () => {
      cancelled = true;
    };
  }, [addCoachMessage, isSightingMode, lastShot, levelId]);
}
