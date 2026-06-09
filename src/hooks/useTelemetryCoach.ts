import { useEffect, useRef } from "react";
import { getAiCoachFeedback } from "@/lib/api/coach.functions";
import type { CoachMessageType, CoachShotTelemetry, TelemetryFeedbackInput } from "@/types/coach";

const BREATH_FEEDBACK = [
  "Долго держал дыхание, и рука начала плыть. В следующий раз не тяни: поймал картинку, мягко нажал, выдохнул.",
  "Передержал прицел. Лучше отпусти, вдох-выдох, и заходи на выстрел заново.",
  "Дыхание затянул. Сбрось напряжение, верни ровную картинку и только потом жми.",
  "Поздно обработал спуск. Не держи силой, лучше перезайди спокойно.",
] as const;

const MATCH_EXCELLENT = [
  "Вот это чисто. Прицел вел спокойно, спуск не дернул.",
  "Отличный выстрел. Сохрани этот темп и не начинай спешить.",
  "Хорошая работа. Рука шла мягко, выстрел вышел без рывка.",
  "Так и надо. Картинку удержал, спуск прошел ровно.",
  "Плотный выстрел. Не меняй темп, продолжай так же спокойно.",
  "Серия складывается. Держи тот же ритм и не добавляй силы.",
  "Очень уверенно. Плечо спокойно, палец сработал мягко.",
  "Выстрел зрелый. Повтори тот же заход без лишней паузы.",
  "Классно легло. Главное сейчас не начать торопиться.",
  "Чистая техника. Запомни это ощущение на спуске.",
] as const;

const MATCH_STABLE = [
  "Нормальный рабочий выстрел. Только не зажимай плечо, держи движение мягче.",
  "Хорошо удержал. Чуть спокойнее на спуске, и будет плотнее.",
  "Попадание рабочее. На следующем выстреле раньше отпускай лишнее напряжение.",
  "Неплохо. Следи, чтобы палец нажимал назад, а не в сторону.",
  "Зона нормальная. Теперь добавь терпения на последней доле спуска.",
  "Хорошая база. Не дожимай оружие рукой, дай прицелу идти ровно.",
  "Можно лучше, но выстрел не сорван. Спуск делай длиннее.",
  "Держишь неплохо. На следующем заходе мягче входи в центр.",
  "Рабочий результат. Проверь дыхание перед следующим подъемом.",
  "Попадание рядом. Не меняй всё сразу, поправь только темп спуска.",
] as const;

const MATCH_LOW = [
  "Поторопился со спуском. Смотри на мушку и дави плавно, без рывка.",
  "Выстрел сорвал рукой. Расслабь кисть и начни обработку спокойнее.",
  "Рванул в конце. Верни внимание на мушку и нажимай без удара.",
  "Слишком резко. Не спасай выстрел пальцем, лучше перезайди.",
  "Промах пошел от спешки. Дыши, останови корпус и работай мягче.",
  "Не догоняй центр. Подожди ровную картинку и нажимай спокойно.",
  "Срыв заметный. Сними лишнее усилие с кисти перед следующим.",
  "Палец дернул оружие. Дави назад, будто тянешь нитку.",
  "Поспешил. Лучше потерять секунду, чем ломать весь выстрел.",
  "Выстрел получился резким. Верни мягкий темп и не зажимай плечо.",
] as const;

const SIGHTING_ADVICE = [
  "После клика сделай еще одну пробную, не переходи в зачет вслепую.",
  "Поправку внеси спокойно и проверь второй пробоиной.",
  "Не меняй стойку после поправки, иначе проверка будет грязной.",
  "Запомни картинку прицела и повтори такой же заход.",
  "Сначала поправка, потом контроль дыхания и еще один ровный выстрел.",
  "После поправки не дергай темп, нужен такой же спокойный спуск.",
  "Проверь поправку сразу, пока положение головы и плеча то же.",
  "Внеси клики и не подстраивайся руками, пусть работает барабан.",
  "Следующий пробный делай с тем же удержанием, иначе сравнение сломается.",
  "Не спеши в зачет, сначала подтвердим поправку второй пробоиной.",
] as const;

const CENTER_ADVICE = [
  "Центр хороший. Не трогай барабаны, держи тот же заход.",
  "Поправки оставь. Сейчас важнее не ускориться на зачете.",
  "Оружие приведено. Переходи в серию и не ломай темп.",
  "Картинка правильная. Дальше работай ровно, без лишних движений.",
  "Настройка нормальная. Сохрани стойку и переходи к зачету.",
  "Поправки не нужны. Теперь решает только качество спуска.",
  "Проверка хорошая. Не крути лишнего, начинай серию спокойно.",
  "Центр подтвержден. Дыши ровно и держи тот же ритм.",
  "Пристрелка сошлась. Не ищи проблему там, где её нет.",
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

function combineCorrectionWithAdvice(correction: string, shotId: number, recent: readonly string[]) {
  const available = SIGHTING_ADVICE.filter((text) => !recent.includes(text));
  const advice = (available.length ? available : SIGHTING_ADVICE)[shotId % (available.length || SIGHTING_ADVICE.length)];
  return `${correction}. ${advice}`;
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
