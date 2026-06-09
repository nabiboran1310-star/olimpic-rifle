import { useEffect, useRef } from "react";
import { getAiCoachFeedback } from "@/lib/api/coach.functions";
import type { CoachMessageType, CoachShotTelemetry, TelemetryFeedbackInput } from "@/types/coach";

const BREATH_FEEDBACK = [
  "Слишком долго держал дыхание. Рука начала дрожать. Отпусти прицел и начни заново.",
  "Не держи дыхание так долго. Вдохни, выдохни и попробуй еще раз спокойно.",
  "Ты передержал прицел. Лучше отпустить мышку, отдохнуть секунду и снова навести.",
  "Выстрел затянулся. Если не успел быстро нажать, начинай попытку заново.",
] as const;

const MATCH_EXCELLENT = [
  "Отлично. Навел спокойно и нажал без рывка.",
  "Хороший выстрел. Продолжай в таком же спокойном темпе.",
  "Вот так надо. Не дергай мышь перед выстрелом.",
  "Очень ровно. Повтори все так же на следующем выстреле.",
  "Попал хорошо. Главное сейчас не спешить.",
  "Классно. Рука была спокойная, кнопка нажата мягко.",
  "Отличная попытка. Сохрани этот ритм.",
  "Все получилось чисто. Делай следующий выстрел так же.",
  "Хорошо легло. Не меняй движения резко.",
  "Супер. Ты спокойно навелся и спокойно нажал.",
] as const;

const MATCH_STABLE = [
  "Нормально. Чуть мягче веди мышь перед выстрелом.",
  "Неплохо. На следующем выстреле нажимай левую кнопку спокойнее.",
  "Попадание рядом. Не меняй все сразу, просто не спеши.",
  "Хорошо. Следи, чтобы рука не дернулась в момент нажатия.",
  "Рабочий выстрел. Перед следующим спокойно вдохни и выдохни.",
  "Все нормально. Наводи прицел плавнее.",
  "Можно лучше, но ошибка небольшая. Следующий делай спокойнее.",
  "Ты почти там. Не зажимай мышь слишком сильно.",
  "Попал рядом с центром. Продолжай без резких движений.",
  "Нормальная попытка. Главное - не дергай кнопку.",
] as const;

const MATCH_LOW = [
  "Поторопился. Сначала наведи прицел, потом мягко нажми левую кнопку.",
  "Рука дернулась в конце. Расслабь кисть и попробуй спокойнее.",
  "Слишком резко нажал. Лучше медленно нажать, чем быстро дернуть.",
  "Не догоняй центр силой. Дождись удобного момента и жми плавно.",
  "Выстрел вышел резким. Сделай вдох-выдох и начни заново.",
  "Ты поспешил. Лучше потратить секунду, но нажать спокойно.",
  "Мышь дернулась. Держи ее мягче перед следующим выстрелом.",
  "Не дави на кнопку рывком. Нажимай плавно.",
  "Промах из-за спешки. Спокойно навелся, спокойно нажал.",
  "Слишком много силы в руке. Ослабь хват и повтори.",
] as const;

const SIGHTING_ADVICE = [
  "После этого сделай еще один пробный выстрел и проверь, стало ли лучше.",
  "Нажми поправку спокойно и проверь следующим пробным выстрелом.",
  "Не меняй положение руки после поправки, иначе будет трудно сравнить.",
  "Запомни, как держал прицел, и повтори так же.",
  "Сначала нажми поправку, потом спокойно сделай еще один пробный.",
  "После поправки стреляй в том же темпе, без спешки.",
  "Сразу проверь поправку вторым выстрелом.",
  "Не пытайся исправлять руками. Исправляй стрелками поправок.",
  "Следующий пробный сделай так же спокойно.",
  "Не переходи сразу в зачет. Сначала проверь вторым попаданием.",
] as const;

const CENTER_ADVICE = [
  "Центр хороший. Поправки не нажимай, переходи к зачету.",
  "Все ровно. Теперь просто стреляй спокойно.",
  "Настройка хорошая. Можно начинать зачетную серию.",
  "Попадание в центре. Не трогай стрелки поправок.",
  "Все получилось. Дальше держи тот же спокойный темп.",
  "Поправки не нужны. Сосредоточься на плавном нажатии.",
  "Пробный хороший. Можешь переходить в зачет.",
  "Центр есть. Дыши ровно и не спеши.",
  "Все нормально. Не ищи лишнюю проблему.",
] as const;

const LEVEL_TACTICS: Record<number, string> = {
  2: "Мишень едет в сторону. Веди прицел вместе с ней и не дергай вверх-вниз.",
  3: "Здесь дальше расстояние. Смотри на ветер и нажимай кнопку без спешки.",
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

function combineCorrectionWithAdvice(correction: string, shotId: number, recent: readonly string[]) {
  const available = SIGHTING_ADVICE.filter((text) => !recent.includes(text));
  const advice = (available.length ? available : SIGHTING_ADVICE)[shotId % (available.length || SIGHTING_ADVICE.length)];
  return `Поправка: ${correction}. ${advice}`;
}

function chooseDifferent(items: readonly string[], seed: number, recent: readonly string[]) {
  const available = items.filter((text) => !recent.includes(text));
  const pool = available.length ? available : items;
  return pick(pool, seed);
}

export function getTelemetryFeedback(shotData: TelemetryFeedbackInput): string {
  const { id = 0, score, deltaX, deltaY, clickX, clickY, isSightingMode, holdBreathTime } = shotData;
  const recent = shotData.recentMessages ?? [];

  if (holdBreathTime > 5 && score < 9.5) {
    return chooseDifferent(BREATH_FEEDBACK, score + deltaX + deltaY + id, recent);
  }

  if (!isSightingMode) {
    if (score >= 10.5) return chooseDifferent(MATCH_EXCELLENT, score + deltaX + id, recent);
    if (score >= 9.5) return chooseDifferent(MATCH_STABLE, score + deltaY + id, recent);
    return chooseDifferent(MATCH_LOW, score + deltaX - deltaY + id, recent);
  }

  const absClickX = Math.abs(clickX);
  const absClickY = Math.abs(clickY);
  const hasCorrection = absClickX > 0 || absClickY > 0;

  if (score >= 10.8 && !hasCorrection) {
    return chooseDifferent(CENTER_ADVICE, score + id, recent);
  }

  if (absClickX >= absClickY && absClickX > 0) {
    return combineCorrectionWithAdvice(conciseCorrection(absClickX, clickX < 0 ? "влево" : "вправо"), id, recent);
  }

  if (absClickY > 0) {
    return combineCorrectionWithAdvice(conciseCorrection(absClickY, clickY < 0 ? "вверх" : "вниз"), id, recent);
  }

  return chooseDifferent(CENTER_ADVICE, score + deltaX + deltaY + id, recent);
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
  const recentRepliesRef = useRef<string[]>([]);

  useEffect(() => {
    announcedLevelsRef.current.clear();
    breathWarningActiveRef.current = false;
    lastShotIdRef.current = null;
    recentRepliesRef.current = [];
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
        "Слишком долго держишь дыхание. Отпусти правую кнопку, вдохни-выдохни и начни заново.",
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
      id: lastShot.id,
      recentMessages: recentRepliesRef.current,
    };

    const fallback = getTelemetryFeedback(shotData);
    const type = feedbackType(shotData);
    const hasSightingCorrection = isSightingMode && (Math.abs(shotData.clickX) > 0 || Math.abs(shotData.clickY) > 0);

    const rememberAndAdd = (text: string) => {
      recentRepliesRef.current = [...recentRepliesRef.current, text].slice(-8);
      addCoachMessage(text, type);
    };

    if (hasSightingCorrection) {
      rememberAndAdd(fallback);
      return;
    }

    void getAiCoachFeedback({ data: { ...shotData, fallback } })
      .then((result) => {
        if (!cancelled) rememberAndAdd(recentRepliesRef.current.includes(result.text) ? fallback : result.text);
      })
      .catch(() => {
        if (!cancelled) rememberAndAdd(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [addCoachMessage, isSightingMode, lastShot, levelId]);
}
