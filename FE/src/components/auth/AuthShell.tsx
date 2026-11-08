import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { HalftoneArt } from "./HalftoneArt";

/** Full-screen split: form on the left, halftone artwork on the right. Colours are fixed, not theme tokens. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 grid overflow-y-auto bg-white text-[#0b0b0d] lg:grid-cols-[5fr_6fr]">
      <main className="flex min-h-full flex-col justify-center px-8 py-10 sm:px-[16%] lg:px-[15%]">
        <Logo size={22} className="mb-12" />
        {children}
      </main>
      <div className="relative hidden lg:block" aria-hidden>
        <div className="absolute inset-0">
          <HalftoneArt />
        </div>
      </div>
    </div>
  );
}

const mono = "font-mono";
export const field = `w-full rounded-full border border-neutral-300 bg-white px-4 py-2.5 ${mono} text-[13px] text-[#0b0b0d] outline-none transition placeholder:text-neutral-400 focus:border-[#0b0b0d] focus:ring-2 focus:ring-[#0b0b0d]/12 disabled:opacity-60`;
export const label = `mb-1.5 block ${mono} text-xs font-semibold`;
export const primaryBtn = `w-full rounded-full bg-[#0b0b0d] px-5 py-2.5 ${mono} text-[13px] font-semibold text-white transition hover:bg-[#2a2a2e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b0b0d] disabled:cursor-not-allowed disabled:opacity-45`;
export const secondaryBtn = `w-full rounded-full border border-neutral-300 bg-white px-5 py-2.5 ${mono} text-[13px] font-semibold text-[#0b0b0d] transition hover:border-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b0b0d] disabled:opacity-50`;
export const heading = "text-[34px] leading-tight font-semibold tracking-tight";
export const subhead = `mt-2 ${mono} text-[13px] text-neutral-500`;
