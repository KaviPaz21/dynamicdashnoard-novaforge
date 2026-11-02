"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Widget } from "@/lib/types";

export function InsightWidget({ widget }: { widget: Widget }) {
  return (
    <div className="md h-full overflow-auto text-[13.5px] leading-relaxed text-ink2">
      <Markdown remarkPlugins={[remarkGfm]}>{widget.content ?? ""}</Markdown>
    </div>
  );
}
