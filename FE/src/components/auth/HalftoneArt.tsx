"use client";

import { useEffect, useRef } from "react";

// Smooth value noise, seeded so the artwork is identical on every load
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + 17.3) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(x: number, y: number) {
  let v = 0, amp = 0.5;
  for (let o = 0; o < 4; o++) {
    v += amp * noise(x, y);
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return v;
}

/** Black halftone diamonds on white: a cloud-like mass whose dots grow denser away from its ragged left edge. */
export function HalftoneArt({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b0b0d";
      const cell = Math.max(9, Math.round(w / 62));
      for (let j = 0; j * cell < h + cell; j++) {
        for (let i = 0; i * cell < w + cell; i++) {
          const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
          const u = x / w, v = y / h;
          // ragged left edge of the mass, then density grows to the right
          const edge = 0.06 + 0.26 * fbm(v * 2.4 + 3.1, 1.7) + 0.16 * Math.sin(v * 5.2 + 0.8);
          const depth = (u - edge) / 0.55;
          if (depth <= 0) continue;
          const tone = fbm(u * 4.2 + 8.4, v * 4.2 + 2.2);
          const holes = fbm(u * 7 + 1.3, v * 7 + 9.1);
          let d = Math.min(1, depth) * 0.75 + tone * 0.65 - 0.42;
          if (holes > 0.64) d -= (holes - 0.64) * 3.2; // pale pockets inside the mass
          if (d <= 0.06) continue;
          const r = Math.min(cell * 0.62, cell * 0.6 * Math.sqrt(Math.min(1, d)) + 0.6);
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.fill();
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return <canvas ref={ref} aria-hidden className={`h-full w-full ${className}`} />;
}
