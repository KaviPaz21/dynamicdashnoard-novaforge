import "@flaticon/flaticon-uicons/css/solid/rounded.css";

export type IconName =
  | "pulse" | "exclamation" | "triangle-warning" | "arrow-small-down" | "arrow-small-up" | "arrow-up"
  | "arrow-trend-up" | "arrow-trend-down" | "minus" | "check" | "check-circle" | "angle-small-down"
  | "angle-small-right" | "angle-double-small-left" | "angle-double-small-right" | "clock" | "database"
  | "dollar" | "document" | "filter-slash" | "flame" | "flask" | "tachometer-average" | "menu-dots-vertical"
  | "hastag" | "link" | "spinner" | "map-marker" | "expand" | "compress" | "moon" | "sun" | "cursor-finger"
  | "package" | "paperclip-vertical" | "percentage" | "plus" | "disk" | "search" | "shopping-cart" | "table"
  | "target" | "thermometer-half" | "trash" | "truck-side" | "cloud-upload" | "users" | "wind" | "cross-small"
  | "dashboard";

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <i
      className={`fi-sr-${name} inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ fontSize: size, width: size, height: size, lineHeight: 1 }}
      aria-hidden
    />
  );
}
