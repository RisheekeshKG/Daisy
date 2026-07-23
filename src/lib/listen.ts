/**
 * DaisyListener — always-on voice capture with simple voice-activity detection.
 *
 * Flow: continuously monitor the mic. When the user starts speaking, record the
 * utterance; when they go quiet for a moment, stop and POST the audio to the
 * backend `/api/stt` (local faster-whisper) and hand the transcript back.
 *
 * While Daisy herself is speaking (isBlocked), capture is paused so she doesn't
 * transcribe her own voice.
 *
 * Capture is raw PCM rather than MediaRecorder/WebM. That buys two things that
 * matter a lot for recognition accuracy:
 *   - a *pre-roll* buffer, so the word onset that trips the VAD threshold is
 *     included in the clip instead of being clipped off the front;
 *   - a VAD driven by the audio callback rather than requestAnimationFrame,
 *     which browsers throttle (or stop entirely) when the window is hidden.
 */

export type ListenState = "idle" | "listening" | "recording" | "transcribing";

export interface ListenHandlers {
  onTranscript: (text: string) => void;
  onPartialTranscript?: (text: string) => void;
  onState?: (state: ListenState) => void;
  onError?: (err: unknown) => void;
  /** Return true to suspend capture (e.g. while Daisy is talking). */
  isBlocked?: () => boolean;
}

// Whisper works at 16kHz mono; asking the AudioContext for that rate lets the
// browser's own high-quality resampler do the work, so we never resample here.
const TARGET_SAMPLE_RATE = 16000;
// ~64ms per block at 16kHz: fine-grained enough for responsive VAD.
const FRAME_SIZE = 1024;

// Audio kept *before* speech is detected, so word onsets survive. The threshold
// crossing always happens a little after speech actually starts.
const PREROLL_MS = 400;
const SILENCE_MS = 850; // pause that ends an utterance (long enough to survive natural pauses)
const MIN_UTTERANCE_MS = 300; // ignore blips shorter than this
const MAX_UTTERANCE_MS = 20000; // hard cap so a stuck VAD can't record forever
const POST_SPEECH_COOLDOWN_MS = 250; // ignore mic right after Daisy stops talking

// Voice-activity thresholds are derived from a running estimate of the room's
// noise floor, so a quiet talker or a noisy room both work. These are the floors
// that estimate can never drop below.
const MIN_START_THRESHOLD = 0.012;
const MIN_KEEP_THRESHOLD = 0.006;
const START_MARGIN = 3.5; // speech must beat the noise floor by this factor
const KEEP_MARGIN = 2.0;
const NOISE_ADAPT = 0.05; // EMA weight for noise-floor tracking

/** Encode mono float samples as a 16-bit PCM WAV blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function concatFrames(frames: Float32Array[], totalSamples: number): Float32Array {
  const out = new Float32Array(totalSamples);
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

class DaisyListener {
  private handlers: ListenHandlers | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private speechRecognition: any = null;
  private data: Uint8Array | null = null;

  private running = false;
  private isRecording = false;
  private isTranscribing = false;

  /** Rolling pre-speech audio, trimmed to PREROLL_MS. */
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;
  /** Frames belonging to the utterance currently being captured. */
  private utterance: Float32Array[] = [];
  private utteranceSamples = 0;

  private noiseFloor = 0.01;
  private lastLevel = 0;
  private lastVoiceTime = 0;
  private recordStart = 0;
  private blockedUntil = 0;
  private partialFinalText = "";
  private partialInterimText = "";

  /** True while Apple's recognizer is driving transcription instead of Whisper. */
  private native = false;
  private nativeUnsubscribe: (() => void) | null = null;
  private nativePaused = false;
  /** Bumped on every start/stop so late events from an old helper are ignored. */
  private nativeSession = 0;

  isActive(): boolean {
    return this.running;
  }

  /** Which engine is producing transcripts right now. */
  getEngine(): "apple" | "whisper" | "none" {
    if (!this.running) return "none";
    return this.native ? "apple" : "whisper";
  }

  /** Current normalized mic loudness (0..1) — for visualizers. */
  getLevel(): number {
    if (!this.running) return 0;
    // Read the analyser directly so visualizers stay smooth at their own frame
    // rate, rather than stepping once per audio block.
    return Math.min(1, this.analyserRms() * 3.2);
  }

  async start(handlers: ListenHandlers): Promise<void> {
    if (this.running) return;
    this.handlers = handlers;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Echo cancellation stays on — Daisy speaks through the same speakers.
          echoCancellation: true,
          // Noise suppression and AGC are tuned for human listeners, not for
          // ASR: they smear consonants and pump the levels our VAD reads.
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (err) {
      this.handlers.onError?.(err);
      throw err;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE });
    // Chromium honours the requested rate, but if it ever doesn't we simply
    // record at whatever rate we got and declare it in the WAV header.
    const source = this.audioCtx.createMediaStreamSource(this.stream);

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.data = new Uint8Array(this.analyser.fftSize);
    source.connect(this.analyser);

    this.processor = this.audioCtx.createScriptProcessor(FRAME_SIZE, 1, 1);
    this.processor.onaudioprocess = this.onAudio;
    source.connect(this.processor);
    // A ScriptProcessor only fires while connected to the destination; route it
    // through a silent gain node so nothing is actually monitored aloud.
    this.sink = this.audioCtx.createGain();
    this.sink.gain.value = 0;
    this.processor.connect(this.sink);
    this.sink.connect(this.audioCtx.destination);

    this.noiseFloor = 0.01;
    this.running = true;
    this.setState("listening");

    // Start on the Whisper path, then offer the mic to Apple's on-device
    // recognizer: it streams partials and returns a transcript the moment you
    // stop talking, whereas Whisper can only begin decoding once the whole
    // utterance has been captured. If it comes up it takes over on "ready";
    // if it never does, nothing changes and Whisper carries on.
    this.startSpeechRecognition();
    void this.startNative();
  }

  /**
   * Attempt to hand transcription to Apple's recognizer via the Electron main
   * process. Silently leaves `native` false on any platform or build where the
   * helper isn't present, so the Whisper path stays the default everywhere else.
   *
   * Note this never awaits readiness: `native` is flipped on only by the helper's
   * own "ready" event (see onNativeEvent). Spawning succeeding tells us nothing —
   * macOS aborts the helper the instant it touches the Speech framework without
   * permission, which lands *before* start() resolves. Gating on "ready" means a
   * helper that dies on launch simply never takes over, and Whisper keeps going.
   */
  private async startNative(): Promise<void> {
    const speech = (window as any).daisy?.speech;
    if (!speech) return;

    const session = ++this.nativeSession;
    try {
      const { supported } = await speech.isAvailable();
      if (!supported || session !== this.nativeSession) return;

      this.nativeUnsubscribe = speech.onEvent((payload: any) => {
        // Ignore stragglers from a helper belonging to an earlier start().
        if (session === this.nativeSession) this.onNativeEvent(payload);
      });
      const result = await speech.start();
      if (!result?.ok) this.stopNative();
    } catch {
      this.stopNative();
    }
  }

  private onNativeEvent(payload: any) {
    if (!payload || typeof payload !== "object") return;

    switch (payload.type) {
      case "ready":
        // The helper cleared permission and is streaming: only now is it safe to
        // stop feeding the Whisper path.
        if (this.running) {
          this.native = true;
          this.nativePaused = false;
          this.resetBuffers();
          if (this.isRecording) this.abortRecording();
          this.stopSpeechRecognition();
        }
        break;

      case "partial":
        if (!this.native) break;
        this.partialInterimText = String(payload.text ?? "");
        this.publishPartialTranscript();
        break;

      case "final": {
        if (!this.native) break;
        const text = String(payload.text ?? "").trim();
        this.resetPartialTranscript();
        if (text) this.handlers?.onTranscript(text);
        break;
      }

      case "error":
      case "exit": {
        // Permission refused, helper crashed, or the recognizer became
        // unavailable. Whisper is still running on the backend, so fall back to
        // it. Deliberately *not* routed through onError: the caller treats that
        // as "voice is broken" and switches listening off, but this is a routine
        // downgrade and the mic must keep working.
        const wasNative = this.native;
        this.native = false;
        this.nativePaused = false;
        this.nativeUnsubscribe?.();
        this.nativeUnsubscribe = null;
        console.info(
          `Daisy: native speech unavailable (${payload.code ?? payload.type}); using Whisper`
        );
        if (this.running) {
          if (wasNative) this.resetBuffers();
          this.startSpeechRecognition();
        }
        break;
      }
    }
  }

  private stopNative() {
    this.nativeSession++;
    this.nativeUnsubscribe?.();
    this.nativeUnsubscribe = null;
    this.native = false;
    this.nativePaused = false;
    try {
      (window as any).daisy?.speech?.stop();
    } catch {
      /* main process already gone */
    }
  }

  stop(): void {
    this.running = false;
    this.isRecording = false;
    this.isTranscribing = false;
    this.resetBuffers();

    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    this.sink?.disconnect();
    this.sink = null;
    this.stopNative();
    this.stopSpeechRecognition();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.data = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.setState("idle");
  }

  private setState(s: ListenState) {
    this.handlers?.onState?.(s);
  }

  private resetBuffers() {
    this.preroll = [];
    this.prerollSamples = 0;
    this.utterance = [];
    this.utteranceSamples = 0;
  }

  private get sampleRate(): number {
    return this.audioCtx?.sampleRate ?? TARGET_SAMPLE_RATE;
  }

  private msToSamples(ms: number): number {
    return Math.floor((ms / 1000) * this.sampleRate);
  }

  private resetPartialTranscript() {
    this.partialFinalText = "";
    this.partialInterimText = "";
    this.handlers?.onPartialTranscript?.("");
  }

  private publishPartialTranscript() {
    const text = `${this.partialFinalText} ${this.partialInterimText}`.trim().replace(/\s+/g, " ");
    this.handlers?.onPartialTranscript?.(text);
  }

  /**
   * Live "draft" text while you speak, via the browser's SpeechRecognition.
   *
   * Progressive enhancement only — the real transcript always comes from the
   * local Whisper backend. This API is not on-device: Chromium streams audio to
   * Google's servers using API keys that only official Chrome builds carry, so
   * in Electron it always fails with error "network" (verified) and the draft
   * line simply stays empty. It does work in a normal Chrome browser build.
   */
  private startSpeechRecognition() {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = (result?.[0]?.transcript || "").trim();
          if (!transcript) continue;
          if (result.isFinal) {
            this.partialFinalText = `${this.partialFinalText} ${transcript}`.trim().replace(/\s+/g, " ");
            this.partialInterimText = "";
          } else {
            interim += `${transcript} `;
          }
        }
        this.partialInterimText = interim.trim().replace(/\s+/g, " ");
        this.publishPartialTranscript();
      };
      recognition.onerror = () => {
        this.speechRecognition = null;
      };
      recognition.onend = () => {
        if (this.running && !this.speechRecognition) return;
        if (this.running && !this.isRecording) {
          try {
            recognition.start();
            return;
          } catch {
            // ignore restart failures
          }
        }
        this.speechRecognition = null;
      };
      recognition.start();
      this.speechRecognition = recognition;
    } catch {
      this.speechRecognition = null;
    }
  }

  private stopSpeechRecognition() {
    const recognition = this.speechRecognition;
    this.speechRecognition = null;
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    } catch {
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    }
  }

  /** Loudness of the analyser's current window — used only for visualizers. */
  private analyserRms(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteTimeDomainData(this.data as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.data.length);
  }

  private static frameRms(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }

  /** Drives VAD and capture; runs once per audio block on the audio thread. */
  private onAudio = (event: AudioProcessingEvent) => {
    if (!this.running) return;
    // The event buffer is reused by the browser, so every retained frame must
    // be a copy.
    const frame = new Float32Array(event.inputBuffer.getChannelData(0));
    const level = DaisyListener.frameRms(frame);
    this.lastLevel = level;
    const now = performance.now();

    if (this.native) {
      // Apple's helper owns the mic for recognition; this graph is kept only to
      // feed the visualizer. All we do here is gate the helper so Daisy never
      // transcribes her own speech.
      const blocked = !!this.handlers?.isBlocked?.();
      if (blocked !== this.nativePaused) {
        this.nativePaused = blocked;
        const speech = (window as any).daisy?.speech;
        if (blocked) {
          speech?.pause();
          this.resetPartialTranscript();
        } else {
          speech?.resume();
        }
        this.setState(blocked ? "idle" : "listening");
      }
      return;
    }

    if (this.handlers?.isBlocked?.()) {
      // Daisy is talking — drop everything, including pre-roll, so none of her
      // voice can leak into the next utterance.
      this.blockedUntil = now + POST_SPEECH_COOLDOWN_MS;
      if (this.isRecording) this.abortRecording();
      else this.resetBuffers();
      return;
    }
    if (now < this.blockedUntil) return;

    const startThreshold = Math.max(MIN_START_THRESHOLD, this.noiseFloor * START_MARGIN);
    const keepThreshold = Math.max(MIN_KEEP_THRESHOLD, this.noiseFloor * KEEP_MARGIN);

    if (!this.isRecording) {
      // Track the noise floor only while nobody is speaking.
      if (level < startThreshold) {
        this.noiseFloor = (1 - NOISE_ADAPT) * this.noiseFloor + NOISE_ADAPT * level;
      }

      this.preroll.push(frame);
      this.prerollSamples += frame.length;
      const maxPreroll = this.msToSamples(PREROLL_MS);
      while (this.prerollSamples > maxPreroll && this.preroll.length > 1) {
        this.prerollSamples -= this.preroll.shift()!.length;
      }

      // Don't start a new utterance while the previous one is still being
      // transcribed — that overlap is exactly the "listen while still
      // answering" problem: strictly listen, then answer, then listen again.
      if (!this.isTranscribing && level > startThreshold) this.beginRecording(now);
      return;
    }

    this.utterance.push(frame);
    this.utteranceSamples += frame.length;
    if (level > keepThreshold) this.lastVoiceTime = now;

    const elapsed = now - this.recordStart;
    if (now - this.lastVoiceTime > SILENCE_MS || elapsed > MAX_UTTERANCE_MS) {
      this.finishRecording(now);
    }
  };

  private beginRecording(now: number) {
    this.resetPartialTranscript();
    // Seed the utterance with the buffered pre-roll so the opening syllable —
    // the one that crossed the threshold — is part of what Whisper hears.
    this.utterance = this.preroll;
    this.utteranceSamples = this.prerollSamples;
    this.preroll = [];
    this.prerollSamples = 0;

    this.isRecording = true;
    this.recordStart = now;
    this.lastVoiceTime = now;
    this.setState("recording");
  }

  /** Discard the current recording without transcribing (e.g. Daisy interrupted). */
  private abortRecording() {
    this.isRecording = false;
    this.resetBuffers();
    this.setState("listening");
  }

  private finishRecording(now: number) {
    const durationMs = now - this.recordStart;
    const samples = concatFrames(this.utterance, this.utteranceSamples);
    const rate = this.sampleRate;
    this.isRecording = false;
    this.resetBuffers();
    this.setState(this.running ? "listening" : "idle");

    if (durationMs >= MIN_UTTERANCE_MS && samples.length > 0) {
      this.transcribe(encodeWav(samples, rate));
    }
  }

  private async transcribe(blob: Blob) {
    this.setState("transcribing");
    this.isTranscribing = true;
    try {
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/wav" },
        body: blob,
      });
      if (res.ok) {
        const { text } = await res.json();
        const clean = (text || "").trim();
        if (clean) this.handlers?.onTranscript(clean);
      }
    } catch (err) {
      this.handlers?.onError?.(err);
    } finally {
      this.isTranscribing = false;
      this.resetPartialTranscript();
      if (this.running) this.setState("listening");
    }
  }
}

export const daisyListener = new DaisyListener();
