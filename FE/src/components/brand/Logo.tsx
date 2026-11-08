const INK = "#0b0b0d";

/** NovaForge wordmark: one italic word. On light: "Nova" black, "Forge" white in a black box. `onDark` inverts it for the black
 *  sidebar: "Nova" white, "Forge" black in a white box. */
export function Logo({
  size = 22, upright = false, onDark = false, className = "",
}: { size?: number; upright?: boolean; onDark?: boolean; className?: string }) {
  const text = onDark ? "#ffffff" : INK;
  const box = onDark ? "#ffffff" : INK;
  const boxText = onDark ? INK : "#ffffff";
  return (
    <span
      role="img"
      aria-label="NovaForge"
      className={`inline-flex items-center font-sans leading-none font-bold tracking-tight whitespace-nowrap select-none ${upright ? "" : "italic"} ${className}`}
      style={{ fontSize: size, color: text }}
    >
      <span aria-hidden>Nova</span>
      <span
        aria-hidden
        className="rounded-[0.42em]"
        style={{ background: box, color: boxText, marginLeft: "0.05em", padding: "0.1em 0.32em 0.16em" }}
      >
        Forge
      </span>
    </span>
  );
}

/** Compact mark for the collapsed (black) sidebar: white box, black letters. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="NovaForge"
      className="inline-grid place-items-center rounded-[0.42em] bg-white font-sans font-bold italic select-none"
      style={{ width: size, height: size, fontSize: size * 0.42, color: INK }}
    >
      NF
    </span>
  );
}
