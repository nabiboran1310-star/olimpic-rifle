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

export function getTelemetryFeedback(shotData: TelemetryFeedbackInput): string {
  const { score, deltaX, deltaY, isSightingMode, holdBreathTime } = shotData;

  if (holdBreathTime > 5 && score < 9.5) {
    return pick(BREATH_FEEDBACK, score + deltaX + deltaY);
  }

  if (!isSightingMode) {
    if (score >= 10.5) return pick(MATCH_EXCELLENT, score + deltaX);
    if (score >= 9.5) return pick(MATCH_STABLE, score + deltaY);
    return pick(MATCH_LOW, score + deltaX - deltaY);
  }

  if (score >= 10.8) {
    return "Центр пойман. Оставляй поправки как есть и переходи в зачетную серию.";
  }

  const gabarits = Math.max(0, 10 - Math.floor(score));
  const clicks = gabarits * 4;
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  const vertical = Math.abs(deltaY) > Math.abs(deltaX);

  if (horizontal && deltaX < 0) {
    return `Пробоина ушла влево примерно на ${gabarits} габарита. Дай ${clicks} кликов влево [◀] и проверь следующую пробную.`;
  }

  if (horizontal && deltaX > 0) {
    return `Пробоина ушла вправо примерно на ${gabarits} габарита. Дай ${clicks} кликов вправо [▶] и снова проверь центр.`;
  }

  if (vertical && deltaY > 0) {
    return `Попадание выше центра на ${gabarits} габарита. Сделай ${clicks} кликов вверх [▲], потом спокойно повтори.`;
  }

  if (vertical && deltaY < 0) {
    return `Попадание ниже центра на ${gabarits} габарита. Сделай ${clicks} кликов вниз [▼] и не меняй стойку на следующем выстреле.`;
  }

  return `Увод идет по диагонали примерно на ${gabarits} габарита. Начни с ${clicks} кликов по той стороне, куда легла пробоина.`;
}

function feedbackType(shotData: TelemetryFeedbackInput): CoachMessageType {
  if (shotData.holdBreathTime > 5 && shotData.score < 9.5) return "warning";
  if (shotData.isSightingMode && shotData.score >= 10.8) return "success";
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
      isSightingMode,
      holdBreathTime: lastShot.holdBreathTime,
      levelId,
    };

    const fallback = getTelemetryFeedback(shotData);
    const type = feedbackType(shotData);

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
