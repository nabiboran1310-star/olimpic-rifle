import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const coachInputSchema = z.object({
  score: z.number(),
  deltaX: z.number(),
  deltaY: z.number(),
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

export const getAiCoachFeedback = createServerFn({ method: "POST" })
  .inputValidator(coachInputSchema)
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { text: data.fallback, source: "fallback" as const };
    }

    const prompt = [
      "Ты скрытый спортивный ИИ-аналитик в симуляторе олимпийской стрельбы.",
      "Дай одну короткую профессиональную реплику на русском языке.",
      "Не используй слова: Обучение, Туториал, Помощь, Инструкция, Урок.",
      "Не раскрывай, что ты языковая модель. Не упоминай API.",
      "Если режим пробный, можно советовать поправки. Если режим зачетный, не считай клики.",
      "Ориентируйся на базовый расчет, но формулируй живее и точнее.",
      "",
      `Данные: score=${data.score}, deltaX=${data.deltaX.toFixed(2)}, deltaY=${data.deltaY.toFixed(2)}, isSightingMode=${data.isSightingMode}, holdBreathTime=${data.holdBreathTime.toFixed(2)}, levelId=${data.levelId ?? "none"}.`,
      `Базовый расчет: ${data.fallback}`,
    ].join("\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
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
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

      return {
        text: text || data.fallback,
        source: text ? ("gemini" as const) : ("fallback" as const),
      };
    } catch {
      return { text: data.fallback, source: "fallback" as const };
    } finally {
      clearTimeout(timeout);
    }
  });
