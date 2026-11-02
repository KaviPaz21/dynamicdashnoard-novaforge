"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { iconKey, type IconKey } from "@/lib/icons";
import type { Widget } from "@/lib/types";
import { useApp } from "@/store/useApp";

const ICONS: Record<IconKey, IconName> = {
  profit: "arrow-trend-up", money: "dollar", orders: "shopping-cart", units: "package", people: "users",
  percent: "percentage", fire: "flame", temp: "thermometer-half", wind: "wind", gauge: "tachometer-average",
  lab: "flask", time: "clock", place: "map-marker", truck: "truck-side", target: "target", count: "hastag",
  activity: "pulse",
};
const HUES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s6)"];

export function IconBadge({ widget, size = 30 }: { widget: Widget; size?: number }) {
  const order = useApp((s) => s.dashboard.widgets.filter((w) => w.type === "card").findIndex((w) => w.id === widget.id));
  const hue = HUES[Math.max(order, 0) % HUES.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${hue} 16%, transparent)`, color: hue }}
      aria-hidden
    >
      <Icon name={ICONS[iconKey(widget)]} size={Math.round(size * 0.5)} />
    </span>
  );
}
