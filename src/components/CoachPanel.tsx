import { useEffect, useState } from "react";
import type { CoachMessage } from "@/types/coach";

type CoachPanelProps = {
  messages: CoachMessage[];
};

const TYPE_CLASS: Record<CoachMessage["type"], string> = {
  telemetry: "border-cyan-300/50 text-cyan-100",
  tactical: "border-sky-300/50 text-sky-100",
  warning: "border-amber-300/70 text-amber-100",
  success: "border-emerald-300/70 text-emerald-100",
};

export function CoachPanel({ messages }: CoachPanelProps) {
  const latest = messages[messages.length - 1];
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (!latest) {
      setTypedText("");
      return;
    }

    setTypedText("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedText(latest.text.slice(0, index));
      if (index >= latest.text.length) window.clearInterval(timer);
    }, 16);

    return () => window.clearInterval(timer);
  }, [latest?.id, latest?.text]);

  return (
    <div className="absolute top-16 left-2 md:left-4 z-20 w-[min(330px,calc(100%-1rem))] pointer-events-none">
      <div className="bg-slate-900/80 backdrop-blur border border-slate-500/50 shadow-2xl shadow-slate-950/30 font-mono text-slate-100">
        <div className="border-b border-slate-500/40 bg-slate-950/50 px-3 py-2 text-[10px] font-bold tracking-[0.28em] text-cyan-100">
          ТЕЛЕМЕТРИЯ И АНАЛИЗ
        </div>
        <div className="space-y-2 px-3 py-3">
          {messages.length === 0 ? (
            <div className="border border-slate-600/40 bg-slate-950/35 px-2 py-2 text-[11px] leading-relaxed text-slate-400">
              Ожидание данных стрельбы...
            </div>
          ) : (
            messages.map((message) => {
              const text = message.id === latest?.id ? typedText : message.text;

              return (
                <div
                  key={message.id}
                  className={`border-l-2 bg-slate-950/35 px-2 py-2 text-[11px] leading-relaxed ${TYPE_CLASS[message.type]}`}
                >
                  {text}
                  {message.id === latest?.id && typedText.length < message.text.length && (
                    <span className="ml-0.5 animate-pulse text-cyan-200">_</span>
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
