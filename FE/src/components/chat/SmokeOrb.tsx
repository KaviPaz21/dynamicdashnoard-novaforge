"use client";

import { useId, useSyncExternalStore } from "react";

const reducedQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(reducedQuery);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

export function SmokeOrb({ size = 64, busy = false }: { size?: number; busy?: boolean }) {
  const id = useId();
  const calm = useReducedMotion();
  const spd = busy ? 0.32 : 1;
  const d = (s: number) => `${(s * spd).toFixed(2)}s`;

  const fog = (rgb: [number, number, number], gain: number, bias: number) =>
    `0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  ${gain} 0 0 0 ${bias}`;

  return (
    <span className="smoke-orb" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 64 64" width={size} height={size} focusable="false">
        <defs>
          <clipPath id={`${id}-clip`}>
            <circle cx="32" cy="32" r="32" />
          </clipPath>
          <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2a2e" />
            <stop offset="0.34" stopColor="#77777c" />
            <stop offset="0.7" stopColor="#d4d4d8" />
            <stop offset="1" stopColor="#efeff1" />
          </linearGradient>
          <radialGradient id={`${id}-depth`} cx="42%" cy="34%" r="70%">
            <stop offset="0.55" stopColor="#55555a" stopOpacity="0" />
            <stop offset="1" stopColor="#3a3a3f" stopOpacity="0.28" />
          </radialGradient>

          <filter id={`${id}-fogA`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.036" numOctaves="3" seed="11" result="n">
              {!calm && <animate attributeName="baseFrequency" dur={d(16)} values="0.022 0.04;0.03 0.05;0.022 0.04" repeatCount="indefinite" />}
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values={fog([1, 1, 1], 3.0, -1.2)} />
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          <filter id={`${id}-fogB`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.03 0.018" numOctaves="3" seed="23" result="n">
              {!calm && <animate attributeName="baseFrequency" dur={d(20)} values="0.03 0.018;0.022 0.026;0.03 0.018" repeatCount="indefinite" />}
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values={fog([0.18, 0.18, 0.2], 2.6, -1.0)} />
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
          <filter id={`${id}-fogC`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.016 0.03" numOctaves="3" seed="5" result="n">
              {!calm && <animate attributeName="baseFrequency" dur={d(24)} values="0.016 0.03;0.024 0.022;0.016 0.03" repeatCount="indefinite" />}
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values={fog([0.55, 0.55, 0.58], 2.4, -1.0)} />
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          <filter id={`${id}-fogD`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.026 0.02" numOctaves="3" seed="31" result="n">
              {!calm && <animate attributeName="baseFrequency" dur={d(18)} values="0.026 0.02;0.02 0.03;0.026 0.02" repeatCount="indefinite" />}
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values={fog([0.35, 0.35, 0.38], 2.6, -1.1)} />
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <filter id={`${id}-fogE`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.028" numOctaves="3" seed="47" result="n">
              {!calm && <animate attributeName="baseFrequency" dur={d(22)} values="0.02 0.028;0.028 0.02;0.02 0.028" repeatCount="indefinite" />}
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values={fog([0.78, 0.78, 0.8], 2.6, -1.12)} />
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <filter id={`${id}-blob`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <g clipPath={`url(#${id}-clip)`}>
          <rect width="64" height="64" fill={`url(#${id}-base)`} />
          <g className="smoke-c" style={{ animationDuration: d(26) }}>
            <rect x="-40" y="-40" width="150" height="150" filter={`url(#${id}-fogC)`} opacity="0.3" />
          </g>
          <g className="smoke-d" style={{ animationDuration: d(21) }}>
            <rect x="-40" y="-40" width="150" height="150" filter={`url(#${id}-fogD)`} opacity="0.5" />
          </g>
          <g className="smoke-e" style={{ animationDuration: d(23) }}>
            <rect x="-40" y="-40" width="150" height="150" filter={`url(#${id}-fogE)`} opacity="0.28" />
          </g>
          <g className="smoke-b" style={{ animationDuration: d(19) }}>
            <rect x="-40" y="-40" width="150" height="150" filter={`url(#${id}-fogB)`} opacity="0.62" />
          </g>
          <g className="smoke-a" style={{ animationDuration: d(14) }}>
            <rect x="-40" y="-40" width="150" height="150" filter={`url(#${id}-fogA)`} opacity="0.95" />
          </g>
          <g className="orbit" style={{ animationDuration: d(7) }}>
            <circle cx="32" cy="13" r="8" fill="#ffffff" opacity="0.48" filter={`url(#${id}-blob)`} />
          </g>
          <g className="orbit orbit-rev" style={{ animationDuration: d(10) }}>
            <circle cx="32" cy="50" r="9" fill="#9a9a9f" opacity="0.34" filter={`url(#${id}-blob)`} />
          </g>
          <g className="orbit" style={{ animationDuration: d(13) }}>
            <circle cx="49" cy="32" r="8" fill="#4a4a4f" opacity="0.32" filter={`url(#${id}-blob)`} />
          </g>
          <rect width="64" height="64" fill={`url(#${id}-depth)`} />
        </g>
      </svg>
    </span>
  );
}
