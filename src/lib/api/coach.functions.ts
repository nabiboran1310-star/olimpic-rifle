import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const coachInputSchema = z.object({
  score: z.number(),
  deltaX: z.number(),
  deltaY: z.number(),
  clickX: z.number(),
  clickY: z.number(),
  isSightingMode: z.boolean(),
  holdBreathTime: z.number(),
  levelId: z.number().nullable(),
  fallback: z.string().min(1),
});

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function cleanCoachText(text: string | undefined, fallback: string) {
  const cleaned = (text ?? "")
    .replace(/[`*_#]/g, "")
    .replace(/[«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 10) return fallback;
  if (/^(.)\1{2,}$/.test(cleaned)) return fallback;
  if (/^(ок|да|нет|отлично)$/i.test(cleaned)) return fallback;
  if (/(стп|габарит|флюгер|спуск|вынос|тремор|гипокси)/i.test(cleaned)) return fallback;

  return cleaned;
}

export const getAiCoachFeedback = createServerFn({ method: "POST" })
  .inputValidator(coachInputSchema)
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    if (!apiKey) {
      return { text: data.fallback, source: "fallback" as const };
    }

    const prompt = [
      "Ты живой тренер по спортивной стрельбе, стоишь рядом со стрелком на рубеже.",
      "Говори так, будто игрок вообще не разбирается в стрельбе и впервые держит мышь в этой игре.",
      "Ответь одной короткой фразой на русском языке, как реальный тренер: спокойно, по-человечески, без роботского тона.",
      "Не используй сложные стрелковые термины. Запрещены слова: СТП, габарит, флюгер, спуск, вынос, тремор, гипоксия.",
      "Вместо терминов говори простыми действиями: наведи прицел, нажми левую кнопку, держи правую кнопку, отпусти и начни заново.",
      "Не используй слова: Обучение, Туториал, Помощь, Инструкция, Урок.",
      "Не говори, что ты ИИ, модель, ассистент или API.",
      "Если режим пробный и clickX/clickY не ноль, ответь очень просто: Поправка: 2 влево или Поправка: 16 вверх.",
      "Не отменяй поправку из-за высокого счета. Если есть clickX/clickY, игроку нужно нажать стрелки поправок.",
      "Если режим зачетный, не считай поправки, оцени только сам выстрел простыми словами.",
      "Начинай сразу с полной фразы. Не ставь кавычки вокруг ответа.",
      "Сокращай количество слов, а не сами слова. Не пиши аббревиатуры.",
      "Не длиннее 80 символов. Без markdown. Без кавычек.",
      "",
      `Данные: score=${data.score}, deltaX=${data.deltaX.toFixed(2)}, deltaY=${data.deltaY.toFixed(2)}, clickX=${data.clickX}, clickY=${data.clickY}, isSightingMode=${data.isSightingMode}, holdBreathTime=${data.holdBreathTime.toFixed(2)}, levelId=${data.levelId ?? "none"}.`,
      `Основа для реплики: ${data.fallback}`,
    ].join("\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 96,
          },
        }),
      });

      if (!response.ok) {
        return { text: data.fallback, source: "fallback" as const };
      }

      const payload = (await response.json()) as GeminiResponse;
      const text = cleanCoachText(
        payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join(""),
        data.fallback,
      );

      return {
        text,
        source: text === data.fallback ? ("fallback" as const) : ("gemini" as const),
      };
    } catch {
      return { text: data.fallback, source: "fallback" as const };
    } finally {
      clearTimeout(timeout);
    }
  });
