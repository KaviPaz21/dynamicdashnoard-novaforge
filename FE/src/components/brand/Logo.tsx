const INK = "#0b0b0d";

/** NovaForge wordmark: one italic word, "Nova" in black and "Forge" in white inside a black rounded box, on white. */
export function Logo({ size = 22, chip = false, upright = false, className = "" }: { size?: number; chip?: boolean; upright?: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label="NovaForge"
      className={`inline-flex items-center font-sans leading-none font-bold tracking-tight whitespace-nowrap select-none ${upright ? "" : "italic"} ${
        chip ? "rounded-xl bg-white shadow-sm" : ""
      } ${className}`}
      style={{ fontSize: size, color: INK, padding: chip ? `${size * 0.42}px ${size * 0.55}px` : undefined }}
    >
      <span aria-hidden>Nova</span>
      <span
        aria-hidden
        className="rounded-[0.42em] text-white"
        style={{ background: INK, marginLeft: "0.05em", padding: "0.1em 0.32em 0.16em" }}
      >
        Forge
      </span>
    </span>
  );
}

/** Compact mark for the collapsed sidebar. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="NovaForge"
      className="inline-grid place-items-center rounded-xl bg-white font-sans font-bold italic shadow-sm select-none"
      style={{ width: size, height: size, fontSize: size * 0.42, color: INK }}
    >
      <span className="rounded-[0.4em] text-white" style={{ background: INK, padding: "0.08em 0.28em 0.14em" }}>NF</span>
    </span>
  );
}
