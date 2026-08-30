import { beforeEach, describe, expect, it, vi } from "vitest";
import { daisyListener, encodeWav } from "./listen";

/** Read a little-endian uint32/uint16 out of a Blob's already-buffered bytes. */
async function readWavHeader(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const readStr = (offset: number, len: number) =>
    String.fromCharCode(...new Uint8Array(buf, offset, len));
  return {
    riff: readStr(0, 4),
    wave: readStr(8, 4),
    fmt: readStr(12, 4),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: readStr(36, 4),
    dataSize: view.getUint32(40, true),
    byteLength: buf.byteLength,
  };
}

describe("encodeWav", () => {
  it("writes a valid mono 16-bit PCM WAV header", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav(samples, 16000);
    const header = await readWavHeader(blob);

    expect(header.riff).toBe("RIFF");
    expect(header.wave).toBe("WAVE");
    expect(header.fmt).toBe("fmt ");
    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(16000);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataTag).toBe("data");
    expect(header.dataSize).toBe(samples.length * 2);
    expect(header.byteLength).toBe(44 + samples.length * 2);
  });

  it("clamps out-of-range samples instead of wrapping", async () => {
    const samples = new Float32Array([2, -2]); // way outside [-1, 1]
    const blob = encodeWav(samples, 16000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(32767); // clamped +1 -> max positive
    expect(view.getInt16(46, true)).toBe(-32768); // clamped -1 -> max negative
  });

  it("produces an empty data chunk for zero samples", async () => {
    const blob = encodeWav(new Float32Array([]), 16000);
    const header = await readWavHeader(blob);
    expect(header.dataSize).toBe(0);
    expect(header.byteLength).toBe(44);
  });
});

/**
 * Mic + Web Audio doubles that record everything they hand out, so a test can
 * assert on how many capture graphs are actually left running.
 */
function installAudioMocks(gumDelayMs: number) {
  const processors: any[] = [];
  const streams: any[] = [];
  const contexts: any[] = [];

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        await new Promise((r) => setTimeout(r, gumDelayMs));
        const tracks = [{ stop: vi.fn() }];
        const stream = { getTracks: () => tracks, tracks };
        streams.push(stream);
        return stream;
      },
    },
  });

  class FakeAudioContext {
    sampleRate = 16000;
    state = "running";
    destination = {};
    closed = false;
    constructor() {
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect: vi.fn() };
    }
    createAnalyser() {
      return { fftSize: 512, getByteTimeDomainData: vi.fn(), connect: vi.fn() };
    }
    createScriptProcessor() {
      const p = { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() };
      processors.push(p);
      return p;
    }
    createGain() {
      return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      this.closed = true;
    }
  }
  (window as any).AudioContext = FakeAudioContext;
  (window as any).SpeechRecognition = undefined;
  (window as any).webkitSpeechRecognition = undefined;

  return {
    liveProcessors: () => processors.filter((p) => p.onaudioprocess !== null),
    liveStreams: () => streams.filter((s) => s.tracks[0].stop.mock.calls.length === 0),
    openContexts: () => contexts.filter((c) => !c.closed),
  };
}

describe("daisyListener start/stop lifecycle", () => {
  beforeEach(() => daisyListener.stop());

  /**
   * React StrictMode mounts, unmounts and remounts before the first
   * getUserMedia ever resolves. Both start() calls pass the `running` guard,
   * and without an epoch check the loser's ScriptProcessor stays wired to its
   * own stream — two capture graphs writing frames into one shared utterance
   * buffer, which is audio Whisper cannot transcribe.
   */
  it("leaves a single capture graph when mount/unmount/mount races getUserMedia", async () => {
    const audio = installAudioMocks(10);
    const handlers = { onTranscript: vi.fn() };

    const first = daisyListener.start(handlers);
    daisyListener.stop();
    const second = daisyListener.start(handlers);
    await Promise.all([first, second]);

    expect(audio.liveProcessors()).toHaveLength(1);
    expect(audio.liveStreams()).toHaveLength(1);
    expect(audio.openContexts()).toHaveLength(1);
    expect(daisyListener.isActive()).toBe(true);
  });

  it("releases the microphone when stop() beats getUserMedia", async () => {
    const audio = installAudioMocks(10);

    const pending = daisyListener.start({ onTranscript: vi.fn() });
    daisyListener.stop();
    await pending;

    expect(audio.liveStreams()).toHaveLength(0);
    expect(audio.liveProcessors()).toHaveLength(0);
    expect(daisyListener.isActive()).toBe(false);
  });

  it("resumes an AudioContext that Chromium created suspended", async () => {
    const audio = installAudioMocks(0);
    const RealCtx = (window as any).AudioContext;
    (window as any).AudioContext = class extends RealCtx {
      state = "suspended";
    };

    await daisyListener.start({ onTranscript: vi.fn() });

    // A suspended context never fires onaudioprocess, so the mic would read as
    // live while capturing nothing at all.
    expect(audio.openContexts()[0].state).toBe("running");
    daisyListener.stop();
  });
});

const SR = 16000;
const FRAME = 1024;
const FRAME_MS = (FRAME / SR) * 1000; // 64ms per block

/**
 * Drives the listener's real onaudioprocess path with synthetic audio at a
 * chosen loudness, on a clock we control, and records what would have been
 * POSTed to /api/stt. Lets the VAD be exercised end to end without a mic.
 */
async function installVadHarness() {
  let clock = 0;
  const clips: number[] = [];
  const processors: any[] = [];

  vi.stubGlobal("performance", { now: () => clock });
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
  });

  class Ctx {
    sampleRate = SR;
    state = "running";
    destination = {};
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData: vi.fn(), connect: vi.fn() }; }
    createScriptProcessor() {
      const p = { onaudioprocess: null as any, connect: vi.fn(), disconnect: vi.fn() };
      processors.push(p);
      return p;
    }
    createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; }
    async resume() {}
    async close() {}
  }
  (window as any).AudioContext = Ctx;
  (window as any).SpeechRecognition = undefined;
  (window as any).webkitSpeechRecognition = undefined;

  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    // WAV header is 44 bytes, samples are 16-bit.
    clips.push((((init.body as Blob).size - 44) / 2 / SR) * 1000);
    return { ok: true, json: async () => ({ text: "transcribed" }) };
  });

  await daisyListener.start({ onTranscript: vi.fn() });
  const processor = processors[processors.length - 1];

  return {
    clips,
    /** Push `ms` of noise at the given RMS through the VAD. */
    feed(rms: number, ms: number) {
      for (let n = 0; n < Math.round(ms / FRAME_MS); n++) {
        const buf = new Float32Array(FRAME);
        for (let i = 0; i < FRAME; i++) buf[i] = (Math.random() * 2 - 1) * rms * Math.sqrt(3);
        processor.onaudioprocess({ inputBuffer: { getChannelData: () => buf } });
        clock += FRAME_MS;
      }
    },
  };
}

const SILENCE = 0.002;
const MUSIC = 0.05;
const SPEECH = 0.09;
// Speech and music are uncorrelated, so at the mic their RMS adds in power —
// talking over a song clears it by far less than it clears a quiet room.
const SPEECH_OVER_MUSIC = Math.sqrt(SPEECH ** 2 + MUSIC ** 2);

describe("voice activity detection", () => {
  beforeEach(() => daisyListener.stop());

  it("captures one utterance in a quiet room", async () => {
    const vad = await installVadHarness();
    vad.feed(SILENCE, 2000);
    vad.feed(SPEECH, 1500);
    vad.feed(SILENCE, 1500);

    expect(vad.clips).toHaveLength(1);
    // Pre-roll ahead of the onset, the speech itself, and the silence tail.
    expect(vad.clips[0]).toBeGreaterThan(1500);
    expect(vad.clips[0]).toBeLessThan(3200);
  });

  /**
   * A song trips the VAD on its first beat and then never dips, so recording
   * used to run until the 20s cap while the noise floor — which only adapts
   * between utterances — never got the chance to learn the room had got
   * louder. Nothing was ever sent for as long as the music played.
   */
  it("still hears speech once a song has started", async () => {
    const vad = await installVadHarness();
    vad.feed(SILENCE, 1000);
    vad.feed(MUSIC, 6000); // song playing, nobody talking
    vad.feed(SPEECH_OVER_MUSIC, 1500); // user talks over it
    vad.feed(MUSIC, 2000);

    expect(vad.clips.length).toBeGreaterThan(0);
    // What we send must be the sentence, not a slab of song.
    expect(vad.clips[vad.clips.length - 1]).toBeLessThan(3500);
  });

  it("does not send the song itself to Whisper", async () => {
    const vad = await installVadHarness();
    vad.feed(SILENCE, 1000);
    vad.feed(MUSIC, 12000); // a song and nothing else

    expect(vad.clips).toHaveLength(0);
  });

  /**
   * The now-playing poll tells the listener a song started. That has to be
   * enough on its own: waiting for the sustained-background timeout to work it
   * out leaves Daisy deaf for the first few seconds of every track.
   */
  it("hears speech straight away when told a song just started", async () => {
    const vad = await installVadHarness();
    vad.feed(SILENCE, 800);
    vad.feed(MUSIC, 900); // song audible before the poll notices
    daisyListener.setMusicPlaying(true);
    vad.feed(MUSIC, 400);
    vad.feed(SPEECH_OVER_MUSIC, 1200);
    vad.feed(MUSIC, 1500);

    expect(vad.clips).toHaveLength(1);
    expect(vad.clips[0]).toBeLessThan(3000);
    daisyListener.setMusicPlaying(false);
  });
});
