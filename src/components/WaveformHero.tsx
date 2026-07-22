import React, { useEffect, useRef } from "react";
import { daisyListener } from "../lib/listen";

interface WaveformHeroProps {
  playing: boolean;
  transcript?: string;
  /** True while Daisy is transcribing/thinking — renders the waveform gray
   * instead of the amber→pink gradient, so it's visually obvious she isn't
   * actively listening or speaking right now. */
  processing?: boolean;
  onTalk: () => void;
}

/**
 * A glowing, animated audio waveform — amber→pink — on the page background
 * (no panel). Its amplitude reacts in real time to your microphone level, and
 * idles gently when quiet.
 */
export default function WaveformHero({ playing, transcript, processing }: WaveformHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);
  const slowPhaseRef = useRef<number>(0);
  const energyRef = useRef<number>(0);
  const playingRef = useRef<boolean>(playing);
  const processingRef = useRef<boolean>(!!processing);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    processingRef.current = !!processing;
  }, [processing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const midY = height / 2;

      // Detected-audio level drives the amplitude. Spotify plays on a separate
      // device, so the mic is the only signal we can actually measure.
      const detected = daisyListener.getLevel();
      const active = detected > 0.04 || playingRef.current;
      // A gentle idle baseline keeps it looking like a full waveform when
      // quiet; detected audio swells it further in real time.
      const target = 0.5 + detected * 1.4;
      energyRef.current += (target - energyRef.current) * 0.12;
      const energy = Math.min(1.7, energyRef.current);

      phaseRef.current += active ? 0.17 : 0.06;
      slowPhaseRef.current += 0.012;
      const phase = phaseRef.current;
      const slow = slowPhaseRef.current;

      const maxAmp = height * 0.42 * energy;
      const carrierFreq = 24;

      const build = () => {
        ctx.beginPath();
        const steps = Math.max(120, Math.floor(width));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const spindle = Math.pow(Math.sin(Math.PI * t), 0.85);
          const beat = 0.6 + 0.4 * Math.sin(t * Math.PI * 3 - slow * 2);
          const envelope = spindle * beat;
          const carrier = Math.sin(t * carrierFreq * Math.PI * 2 - phase);
          const x = t * width;
          const y = midY + carrier * envelope * maxAmp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      if (processingRef.current) {
        gradient.addColorStop(0, "#a1a1aa");
        gradient.addColorStop(0.5, "#d4d4d8");
        gradient.addColorStop(1, "#a1a1aa");
      } else {
        gradient.addColorStop(0, "#f59e0b");
        gradient.addColorStop(0.45, "#fbbf24");
        gradient.addColorStop(0.75, "#fb7185");
        gradient.addColorStop(1, "#f472b6");
      }

      // Soft glow
      ctx.save();
      ctx.strokeStyle = gradient;
      ctx.shadowColor = processingRef.current ? "rgba(161, 161, 170, 0.45)" : "rgba(251, 146, 178, 0.55)";
      ctx.shadowBlur = 18;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      build();
      ctx.stroke();
      ctx.restore();

      // Crisp core
      ctx.save();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      build();
      ctx.stroke();
      ctx.restore();

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="mb-10 relative z-20">
      <div ref={containerRef} className="relative h-40 sm:h-48">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="mt-3 min-h-6 flex items-center justify-center px-4 text-center">
        <p
          aria-live="polite"
          className="max-w-3xl text-sm sm:text-base font-semibold text-zinc-700 tracking-tight transition-opacity duration-200"
        >
          {transcript?.trim() || ""}
        </p>
      </div>
    </div>
  );
}
