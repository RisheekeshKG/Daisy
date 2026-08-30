import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DaisyMascotAvatar } from "./DaisyAgent";

interface OnboardingModalProps {
  open: boolean;
  onSubmit: (name: string) => void;
}

const FALLBACK_NAME = "Friend";

/**
 * First-run "what should I call you?" prompt. Daisy's greetings, title bar,
 * and chat system prompt all address the user by name, and this project has
 * no single owner baked in — so the name has to come from whoever is running
 * it, asked once here rather than hardcoded.
 */
export default function OnboardingModal({ open, onSubmit }: OnboardingModalProps) {
  const [value, setValue] = useState("");

  const submit = (name: string) => {
    onSubmit(name.trim() || FALLBACK_NAME);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-sm bg-white/95 border border-zinc-200 rounded-3xl p-7 shadow-2xl relative text-center"
          >
            <div className="flex justify-center mb-4">
              <DaisyMascotAvatar className="w-16 h-16" />
            </div>
            <h3 className="text-lg font-black text-zinc-900 tracking-tight mb-1.5">
              Welcome to Daisy
            </h3>
            <p className="text-xs text-zinc-500 font-semibold mb-5 leading-relaxed">
              What should she call you?
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(value);
              }}
            >
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Your name"
                maxLength={40}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-800 text-center outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 transition-all mb-4"
              />
              <button
                type="submit"
                className="w-full px-4 py-2.5 text-sm font-bold bg-amber-400 hover:bg-amber-500 text-amber-950 rounded-xl shadow-md transition-all cursor-pointer"
              >
                Get started
              </button>
            </form>
            <button
              onClick={() => submit("")}
              className="mt-3 text-[11px] font-bold text-zinc-400 hover:text-zinc-600 cursor-pointer transition-all"
            >
              Skip for now
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
