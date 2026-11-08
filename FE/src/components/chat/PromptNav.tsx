"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export interface PromptRef {
  id: string;
  text: string;
}

/** A column of dots on the right edge of the conversation, one per user prompt. Click to jump; while scrolling (or hovering)
 *  the prompt you're currently looking at is shown next to its dot. Each prompt element carries `data-prompt`. */
export function PromptNav({ scroller, prompts }: { scroller: RefObject<HTMLDivElement | null>; prompts: PromptRef[] }) {
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = prompts.length;

  useEffect(() => {
    const el = scroller.current;
    if (!el || count < 2) return;
    const locate = () => {
      const nodes = el.querySelectorAll<HTMLElement>("[data-prompt]");
      const probe = el.scrollTop + el.clientHeight * 0.35;
      let idx = 0;
      nodes.forEach((n, i) => {
        if (n.offsetTop <= probe) idx = i;
      });
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 8) idx = nodes.length - 1;
      setActive(Math.max(0, idx));
    };
    const onScroll = () => {
      locate();
      setPeek(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPeek(false), 1400);
    };
    locate();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scroller, count]);

  if (count < 2) return null;

  const jump = (i: number) => {
    const el = scroller.current;
    const node = el?.querySelectorAll<HTMLElement>("[data-prompt]")[i];
    if (el && node) el.scrollTo({ top: Math.max(0, node.offsetTop - 12), behavior: "smooth" });
  };

  return (
    <nav aria-label="Jump to a prompt" className="pointer-events-none absolute top-1/2 right-1 z-10 flex max-h-[80%] -translate-y-1/2 flex-col items-center gap-1">
      {prompts.map((p, i) => {
        const on = i === active;
        const label = hover === i || (peek && on);
        return (
          <div key={p.id} className="pointer-events-auto relative">
            <button
              onClick={() => jump(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`Prompt ${i + 1}: ${p.text.slice(0, 80)}`} aria-current={on ? "true" : undefined}
              className="grid h-4 w-4 place-items-center rounded-full"
            >
              <span className={`block rounded-full transition-all duration-200 ${on ? "h-2.5 w-2.5 bg-accent" : "h-1.5 w-1.5 bg-ink/25 hover:bg-ink/50"}`} />
            </button>
            {label && (
              <span role="tooltip" className="rise pointer-events-none absolute top-1/2 right-6 w-max max-w-[210px] -translate-y-1/2 rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-left text-[11.5px] leading-snug text-ink shadow-[var(--drag-shadow)]">
                <span className="mr-1.5 font-mono text-[10px] text-accent">{i + 1}/{count}</span>
                <span className="line-clamp-3">{p.text}</span>
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
