"use client";

import { COLORS, type Colors } from "@/lib/palette";
import { useApp } from "@/store/useApp";

export function useColors(): Colors {
  return COLORS[useApp((s) => s.theme)];
}
