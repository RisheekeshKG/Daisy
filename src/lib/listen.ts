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
 *
 * Whisper (backend `/api/stt`) is the only transcription engine — everything
 * stays on-device, no OS-specific native helper required.
 */

export type ListenState = "idle" | "listening" | "recording" | "transcribing";

export interface ListenHandlers {
  onTranscript: (text: string) => void;
  onPartialTranscript?: (text: string) => void;
  onState?: (state: ListenState) => void;
  /** Voice is broken and capture has stopped (e.g. mic permission refused). */
  onError?: (err: unknown) => void;
  /** Something went wrong for one utterance, but the mic is still live. */
  onNotice?: (message: string) => void;
  /** Return true to suspend capture (e.g. while Daisy is talking). */
  isBlocked?: () => boolean;
}

/** Error surfaced through onError, carrying a machine-readable reason. */
export class ListenError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message || code);
    this.name = "ListenError";
  }
}

/** Human-readable explanation for the mic UI. */
export function describeListenError(err: unknown): string {
  const code = err instanceof ListenError ? err.code : "";
  switch (code) {
    case "mic":
      return "Microphone access was refused — allow it in System Settings → Privacy & Security.";
    case "audio":
      return "Couldn't open the audio input.";
    default:
      return "Voice input stopped unexpectedly.";
  }
}

// Whisper works at 16kHz mono; asking the AudioContext for that rate lets the
// browser's own high-quality resampler do the work, so we never resample here.
const TARGET_SAMPLE_RATE = 16000;
// ~64ms per block at 16kHz: fine-grained enough for responsive VAD.
const FRAME_SIZE = 1024;

// Audio kept *before* speech is detected, so word onsets survive. The threshold
// crossing always happens a little after speech actually starts.
const PREROLL_MS = 400;
// Pause that ends an utterance. Whisper cannot start decoding until the whole
// clip is captured, so this has to be long enough to survive a natural
// mid-sentence pause — cutting it short splits one request into two and the
// second half arrives with no wake word attached.
const SILENCE_MS = 850;
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

// Music playing in the room is a different problem from a noisy room. Speaking
// over a song only clears it by roughly 5-6dB at the mic, so the quiet-room
// margin of 3.5x (~11dB) is a bar the user physically cannot reach — it makes
// Daisy deaf for exactly as long as the song lasts. When we know music is
// playing we drop to a margin speech can actually beat, and accept that some
// clips will be music: those get ducked, transcribed, and thrown away by the
// backend's no-speech filter, which is far cheaper than not hearing at all.
const MUSIC_START_MARGIN = 1.8;
const MUSIC_KEEP_MARGIN = 1.25;

// The margin slides between the two profiles based on how loud the room has
// actually become, rather than waiting to be told. A learned noise floor this
// low is a quiet room; this high is something loud and steady playing. Doing
// it from the floor means it works for a song on a laptop, a TV, or a
// housemate's speaker — not just for audio Daisy happens to control.
const QUIET_FLOOR = 0.015;
const LOUD_FLOOR = 0.04;

/**
 * How long a single unbroken stretch of above-threshold audio has to run
 * before we stop believing it is speech.
 *
 * This is the escape hatch from a deadlock: the noise floor only adapts
 * between utterances, so when a song starts mid-session it trips the VAD on
 * its first beat and then never dips again. Recording never ends, the floor
 * never learns the room got louder, and nothing is ever sent. Detecting that
 * lets us re-baseline the floor to what we just heard and carry on.
 */
const SUSTAINED_BACKGROUND_MS = 5000;
/**
 * The longest pause allowed inside that stretch for it to still count as
 * background. People breathe; songs do not, so a stretch with no gap at all is
 * the tell. Kept well under SILENCE_MS so a genuinely long request, which
 * always has small gaps between words, is never mistaken for background.
 */
const MAX_BACKGROUND_GAP_MS = 150;

/** Encode mono float samples as a 16-bit PCM WAV blob. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
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
  /**
   * Bumped by every start() and stop(). start() has to await getUserMedia, and
   * React StrictMode mounts -> unmounts -> mounts before that first promise
   * ever resolves, so two start() calls can be in flight at once with
   * `running` still false in both guards. Whichever resolves second used to
   * overwrite this.processor/this.stream while the first graph stayed wired
   * up and kept firing onAudio — two mic streams interleaving frames into one
   * shared utterance buffer, which is audio Whisper cannot transcribe. The
   * epoch lets a superseded start() recognise it lost and tear itself down.
   */
  private startEpoch = 0;
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
  /** True while a song is playing, which relaxes the VAD margins. */
  private musicPlaying = false;
  /** Running mean level of the current utterance, for re-baselining. */
  private utteranceLevelSum = 0;
  private utteranceLevelCount = 0;
  /** Longest pause seen inside the current utterance. */
  private longestGapMs = 0;
  private blockedUntil = 0;
  private partialFinalText = "";
  private partialInterimText = "";

  isActive(): boolean {
    return this.running;
  }

  /** Which engine is producing transcripts right now. */
  getEngine(): "whisper" | "none" {
    return this.running ? "whisper" : "none";
  }

  /**
   * Tell the listener a song is playing, which relaxes the VAD margins so
   * speech over music can still trip it. Driven by Spotify's now-playing
   * state; the sustained-background detector below covers the window before
   * that poll catches up.
   */
  setMusicPlaying(playing: boolean): void {
    if (this.musicPlaying === playing) return;
    this.musicPlaying = playing;

    if (playing) {
      // Whatever the mic is hearing at the moment we learn a song is on *is*
      // the song, so seed the floor from it. Without this the first beat trips
      // the VAD, and because a track never pauses the recording it starts can
      // only end at the sustained-background timeout seconds later — seconds
      // in which Daisy is deaf. Anything already recording is that same song.
      this.noiseFloor = Math.max(this.noiseFloor, this.lastLevel);
      if (this.isRecording) this.abortRecording();
      return;
    }

    // Music stopped: the floor is now far too high and would swallow ordinary
    // speech. Drop it and let the idle EMA find the quiet room again.
    this.noiseFloor = MIN_START_THRESHOLD;
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
    const epoch = ++this.startEpoch;
    this.handlers = handlers;
    // Held locally, not on `this`, until we know this start() is still the
    // current one — otherwise a superseded call overwrites the live stream.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
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
      // A superseded start losing the mic race is not a fault the UI should
      // report — the start that won is the one that speaks for the mic.
      if (epoch === this.startEpoch) {
        this.handlers.onError?.(new ListenError("mic", String(err)));
      }
      throw err;
    }

    // A stop() or a newer start() landed while we were waiting on the mic.
    // Release this stream and leave the winner's graph untouched.
    if (epoch !== this.startEpoch) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

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

    // Chromium creates an AudioContext suspended when the page has had no
    // user gesture, and a suspended context never fires onaudioprocess — the
    // mic reads as live while no audio is ever captured. Electron's default
    // autoplay policy exempts it, but a plain `npm run dev` browser tab does
    // not, so ask for it explicitly.
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume().catch(() => {});
      // resume() is another await, so re-check: a stop() during it has already
      // torn this graph down and must not be undone by the lines below.
      if (epoch !== this.startEpoch) return;
    }

    this.noiseFloor = 0.01;
    this.running = true;
    this.setState("listening");

    this.startSpeechRecognition();
  }

  stop(): void {
    // Invalidates any start() still waiting on getUserMedia, so it tears its
    // own stream down instead of coming back to life after we've stopped.
    this.startEpoch++;
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

  /**
   * How far above the noise floor speech has to sit, blended between the
   * quiet-room and over-music profiles. Knowing a song is playing pins it to
   * the relaxed end immediately; otherwise the learned floor decides, which
   * covers the first few seconds before the now-playing poll catches up and
   * every audio source Daisy has no control over.
   */
  private margins(): { start: number; keep: number } {
    const loudness = this.musicPlaying
      ? 1
      : Math.min(1, Math.max(0, (this.noiseFloor - QUIET_FLOOR) / (LOUD_FLOOR - QUIET_FLOOR)));
    return {
      start: START_MARGIN + (MUSIC_START_MARGIN - START_MARGIN) * loudness,
      keep: KEEP_MARGIN + (MUSIC_KEEP_MARGIN - KEEP_MARGIN) * loudness,
    };
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

    if (this.handlers?.isBlocked?.()) {
      // Daisy is talking — drop everything, including pre-roll, so none of her
      // voice can leak into the next utterance.
      this.blockedUntil = now + POST_SPEECH_COOLDOWN_MS;
      if (this.isRecording) this.abortRecording();
      else this.resetBuffers();
      return;
    }
    if (now < this.blockedUntil) return;

    const { start: startMargin, keep: keepMargin } = this.margins();
    const startThreshold = Math.max(MIN_START_THRESHOLD, this.noiseFloor * startMargin);
    const keepThreshold = Math.max(MIN_KEEP_THRESHOLD, this.noiseFloor * keepMargin);

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
    this.utteranceLevelSum += level;
    this.utteranceLevelCount++;
    if (level > keepThreshold) this.lastVoiceTime = now;

    const gap = now - this.lastVoiceTime;
    if (gap > this.longestGapMs) this.longestGapMs = gap;

    const elapsed = now - this.recordStart;

    // Ran this long without ever pausing: not a person talking. Learn the
    // level as the new noise floor so the next frame sees a threshold that
    // sits above it, and drop the clip rather than sending Whisper a
    // five-second block of song.
    if (elapsed > SUSTAINED_BACKGROUND_MS && this.longestGapMs < MAX_BACKGROUND_GAP_MS) {
      this.rebaselineNoiseFloor();
      this.abortRecording();
      return;
    }

    if (gap > SILENCE_MS || elapsed > MAX_UTTERANCE_MS) {
      this.finishRecording(now);
    }
  };

  /**
   * Adopt the level of whatever we just recorded as the noise floor. Used when
   * a "recording" turns out to have been steady background, which the
   * between-utterances EMA can never learn on its own because it only runs
   * while idle — and background keeps us out of idle.
   */
  private rebaselineNoiseFloor() {
    if (!this.utteranceLevelCount) return;
    const mean = this.utteranceLevelSum / this.utteranceLevelCount;
    // Only ever raise the floor here. Lowering it is the idle EMA's job, which
    // reacts quickly once the room is actually quiet again.
    this.noiseFloor = Math.max(this.noiseFloor, mean);
  }

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
    this.utteranceLevelSum = 0;
    this.utteranceLevelCount = 0;
    this.longestGapMs = 0;
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
      } else {
        // A failed utterance is not a broken mic: the backend may still be
        // warming the model, or Whisper may have choked on one clip. Say so and
        // keep listening rather than switching voice off for the whole session.
        this.notifyTranscribeFailure(`/api/stt returned ${res.status}`);
      }
    } catch (err) {
      this.notifyTranscribeFailure(String(err));
    } finally {
      this.isTranscribing = false;
      this.resetPartialTranscript();
      if (this.running) this.setState("listening");
    }
  }

  private notifyTranscribeFailure(detail: string) {
    console.error(`Daisy STT failed: ${detail}`);
    this.handlers?.onNotice?.("Couldn't transcribe that — is the backend running?");
  }
}

export const daisyListener = new DaisyListener();
