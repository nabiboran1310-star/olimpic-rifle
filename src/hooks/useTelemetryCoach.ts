import { useEffect, useRef } from "react";
import { getAiCoachFeedback } from "@/lib/api/coach.functions";
import type { CoachMessageType, CoachShotTelemetry, TelemetryFeedbackInput } from "@/types/coach";

const HYPOXIA_FEEDBACK = [
  "Передержка дыхания завалила координацию. Начался тремор из-за гипоксии - обрабатывай спуск быстрее.",
  "Кислородное голодание заблокировало стабильность. Отпускай прицел, если не успел выстрелить за 5 секунд.",
] as const;

const MATCH_EXCELLENT = [
  "Великолепный вынос. Чистая работа со спуском.",
  "Идеальное удержание.",
] as const;

const MATCH_STABLE = [
  "Хороший рабочий выстрел, но контролируй пульс.",
  "Габарит удержал.",
] as const;

const MATCH_LOW = [
  "Поспешил с обработкой триггера. Концентрируйся на мушке.",
  "Резкий сдерг при спуске.",
] as const;

const LEVEL_TACTICS: Record<number, string> = {
  2: "Цель движется по фиксированной горизонтальной направляющей. Исключи вертикальные колебания, работай корпусом на упреждение хода мишени.",
  3: "Дистанция 50 метров увеличивает влияние атмосферы. Отслеживай поведение флюгера ветра перед выстрелом.",
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
    return pick(HYPOXIA_FEEDBACK, score + deltaX + deltaY);
  }

  if (!isSightingMode) {
    if (score >= 10.5) return pick(MATCH_EXCELLENT, score + deltaX);
    if (score >= 9.5) return pick(MATCH_STABLE, score + deltaY);
    return pick(MATCH_LOW, score + deltaX - deltaY);
  }

  if (score >= 10.8) {
    return "СТП приведена к абсолютному нулю. Можно переходить в зачетную серию.";
  }

  const gabarits = Math.max(0, 10 - Math.floor(score));
  const clicks = gabarits * 4;
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  const vertical = Math.abs(deltaY) > Math.abs(deltaX);

  if (horizontal && deltaX < 0) {
    return `Наблюдаю увод СТП влево на ${gabarits} габарита. Требуется внести ровно ${clicks} кликов ВЛЕВО [◀], чтобы компенсировать смещение.`;
  }

  if (horizontal && deltaX > 0) {
    return `Смещение пули вправо на ${gabarits} габарита. Крути барабанчик на ${clicks} кликов ВПРАВО [▶] для центровки.`;
  }

  if (vertical && deltaY > 0) {
    return `Пробоина легла выше оси на ${gabarits} габарита. Сделай ${clicks} кликов ВВЕРХ [▲] на панели поправок.`;
  }

  if (vertical && deltaY < 0) {
    return `Занижение выстрела на ${gabarits} габарита. Сделай ${clicks} кликов ВНИЗ [▼], чтобы поднять СТП к центру.`;
  }

  return `СТП смещена диагонально на ${gabarits} габарита. Начни с ${clicks} кликов по доминирующей оси попадания.`;
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
  const hypoxiaActiveRef = useRef(false);
  const lastShotIdRef = useRef<number | null>(null);

  useEffect(() => {
    announcedLevelsRef.current.clear();
    hypoxiaActiveRef.current = false;
    lastShotIdRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!levelId || !LEVEL_TACTICS[levelId] || announcedLevelsRef.current.has(levelId)) return;
    announcedLevelsRef.current.add(levelId);
    addCoachMessage(LEVEL_TACTICS[levelId], "tactical");
  }, [addCoachMessage, levelId]);

  useEffect(() => {
    if (isHoldingBreath && holdBreathTime > 5 && !hypoxiaActiveRef.current) {
      hypoxiaActiveRef.current = true;
      addCoachMessage(
        "Передержка дыхания активировала тремор из-за гипоксии. Отпусти прицел, сделай цикл вдоха-выдоха и начни обработку спуска заново.",
        "warning",
      );
      return;
    }

    if (!isHoldingBreath || holdBreathTime <= 5) {
      hypoxiaActiveRef.current = false;
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
