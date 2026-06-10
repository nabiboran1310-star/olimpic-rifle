import { useEffect, useState } from "react";
import type { CoachMessage } from "@/types/coach";

type CoachPanelProps = {
  messages: CoachMessage[];
  mobile?: boolean;
};

const TYPE_CLASS: Record<CoachMessage["type"], string> = {
  telemetry: "border-sky-300/45 text-slate-100",
  tactical: "border-cyan-300/45 text-slate-100",
  warning: "border-amber-300/70 text-amber-50",
  success: "border-emerald-300/70 text-emerald-50",
};

const TYPE_LABEL: Record<CoachMessage["type"], string> = {
  telemetry: "смотрю пробный",
  tactical: "подсказываю",
  warning: "осторожно",
  success: "хорошо",
};

export function CoachPanel({ messages, mobile = false }: CoachPanelProps) {
  const latest = messages[messages.length - 1];
  const [typedMessage, setTypedMessage] = useState({ id: "", text: "" });

  useEffect(() => {
    if (!latest) {
      setTypedMessage({ id: "", text: "" });
      return;
    }

    const chars = Array.from(latest.text);
    let index = 0;
    let timeoutId = 0;
    let active = true;

    setTypedMessage({ id: latest.id, text: "" });

    const typeNext = () => {
      if (!active) return;

      index += 1;
      setTypedMessage({ id: latest.id, text: chars.slice(0, index).join("") });

      if (index < chars.length) {
        timeoutId = window.setTimeout(typeNext, 18);
      }
    };

    timeoutId = window.setTimeout(typeNext, 40);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [latest?.id, latest?.text]);

  const visibleMessages = messages.length === 0 ? [] : messages.slice(-1);

  return (
    <div className={`${mobile ? "absolute left-2 right-2 top-14" : "absolute left-2 right-2 top-14 md:left-auto md:right-4 md:top-16 md:w-[260px]"} z-30 pointer-events-none`}>
      <div className="overflow-hidden border border-amber-200/30 bg-slate-950/72 backdrop-blur-sm text-slate-100 shadow-xl shadow-slate-950/25">
        <div className={`${mobile ? "hidden" : "flex"} items-center gap-2 border-b border-amber-100/10 bg-slate-900/60 px-2.5 py-2`}>
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-amber-200/40 bg-gradient-to-b from-slate-700 to-slate-950">
            <div className="absolute left-1/2 top-2 h-4 w-4 -translate-x-1/2 rounded-full bg-amber-100/85" />
            <div className="absolute left-1/2 top-6 h-8 w-9 -translate-x-1/2 rounded-t-full bg-slate-300/85" />
            <div className="absolute left-2 top-7 h-2 w-8 rounded-full bg-amber-300/70" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black tracking-wide text-amber-100">Тренер Руслан</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">короткая подсказка</div>
          </div>
        </div>
        <div className="space-y-1.5 px-2.5 py-2">
          {messages.length === 0 ? (
            <div className="rounded-sm border border-slate-600/35 bg-slate-900/40 px-2.5 py-2 text-[11px] leading-snug text-slate-300">
              Я рядом. Сделай пробный выстрел, посмотрим, что поправить.
            </div>
          ) : (
            visibleMessages.map((message) => {
              const isTyping = message.id === latest?.id && typedMessage.id === message.id;
              const text = isTyping ? typedMessage.text : message.text;

              return (
                <div
                  key={message.id}
                  className={`relative rounded-sm border-l-2 bg-slate-900/50 px-2.5 py-2 text-[11px] leading-snug shadow-sm ${TYPE_CLASS[message.type]}`}
                >
                  <div className="mb-1 text-[8px] uppercase tracking-[0.18em] text-slate-400">
                    {TYPE_LABEL[message.type]}
                  </div>
                  {text}
                  {isTyping && typedMessage.text.length < message.text.length && (
                    <span className="ml-0.5 animate-pulse text-amber-200">|</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
