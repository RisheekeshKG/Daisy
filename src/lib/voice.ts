/**
 * HTML5 SpeechSynthesis Voice Module for Daisy
 * A bright, energetic English kid-girl voice — cheerful, expressive, and full
 * of emotion. Speaks clear English (no accent), with lively pitch and pacing.
 */

// Known male voice names to explicitly reject, since the Web Speech API
// exposes no gender field and some platforms otherwise default to a male
// system voice (e.g. Alex/Daniel/Fred on macOS, David/Mark on Windows).
const MALE_VOICE_NAME_BLOCKLIST = [
  "alex", "daniel", "fred", "david", "mark", "james", "george", "tom", "guy", "rishi", "oliver", "arthur",
];

function isBlockedMaleVoice(name: string): boolean {
  if (name.includes("female")) return false;
  return MALE_VOICE_NAME_BLOCKLIST.some((blocked) => name.includes(blocked));
}

/**
 * Nudge pitch/rate based on the emotional tone of the text, so Daisy sounds
 * expressive rather than monotone — excited when happy, gentler when apologetic.
 */
function emotionAdjust(text: string): { pitch: number; rate: number } {
  const lower = text.toLowerCase();
  const excited = /[!]{1,}|yay|woohoo|yes|awesome|great|amazing|love|hooray|wonderful|super/.test(lower);
  const curious = /\?/.test(lower);
  const gentle = /sorry|oops|hmm|uh oh|careful|sadly|unfortunately/.test(lower);

  // Keep variation subtle so speed stays normal and the voice sounds natural.
  if (gentle) return { pitch: -0.06, rate: 0 };
  if (excited) return { pitch: 0.06, rate: 0 };
  if (curious) return { pitch: 0.04, rate: 0 };
  return { pitch: 0, rate: 0 };
}

class DaisyVoiceEngine {
  private isVoiceEnabled: boolean = true;
  private isAnimeMode: boolean = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private onSpeakingStateChange: ((speaking: boolean) => void) | null = null;
  private voicesCache: SpeechSynthesisVoice[] = [];

  // Backend (Piper) TTS playback
  private audio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private isPlayingAudio: boolean = false;
  // Bumped every time speak()/cancel() is called, so stale async responses
  // from a superseded request don't start playing over a newer one.
  private speakToken: number = 0;
  // True for the whole speak() lifecycle — see isBusy().
  private busy: boolean = false;

  constructor() {
    const savedVoice = localStorage.getItem("daisy_voice_enabled");
    if (savedVoice !== null) {
      this.isVoiceEnabled = savedVoice === "true";
    }
    const savedAnime = localStorage.getItem("daisy_anime_voice_enabled");
    if (savedAnime !== null) {
      this.isAnimeMode = savedAnime === "true";
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      // Voices frequently aren't populated synchronously on first load
      // (a well-known Web Speech API quirk) — cache them as they arrive.
      this.refreshVoicesCache();
      window.speechSynthesis.addEventListener("voiceschanged", () => this.refreshVoicesCache());

      // Add liveness checking for speaking state (browser speech OR backend audio)
      setInterval(() => {
        if (this.onSpeakingStateChange) {
          this.onSpeakingStateChange(window.speechSynthesis.speaking || this.isPlayingAudio);
        }
      }, 300);
    }
  }

  private refreshVoicesCache() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      this.voicesCache = voices;
    }
  }

  /** Resolves once the voice list is populated (handles the first-call-is-empty quirk). */
  private ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
    if (this.voicesCache.length) return Promise.resolve(this.voicesCache);

    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length) {
      this.voicesCache = immediate;
      return Promise.resolve(immediate);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (voices: SpeechSynthesisVoice[]) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        window.speechSynthesis.removeEventListener("voiceschanged", onChange);
        if (voices.length) this.voicesCache = voices;
        resolve(voices);
      };
      const onChange = () => finish(window.speechSynthesis.getVoices());
      window.speechSynthesis.addEventListener("voiceschanged", onChange);

      // Fallback poll in case voiceschanged never fires on this platform.
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        const voices = window.speechSynthesis.getVoices();
        if (voices.length || attempts > 20) {
          finish(voices);
        }
      }, 200);
    });
  }

  setSpeakingStateCallback(callback: (speaking: boolean) => void) {
    this.onSpeakingStateChange = callback;
  }

  /** True while Daisy is talking (backend audio or browser speech). */
  isSpeaking(): boolean {
    return (
      this.isPlayingAudio ||
      (typeof window !== "undefined" && !!window.speechSynthesis?.speaking)
    );
  }

  getEnabled() {
    return this.isVoiceEnabled;
  }

  setEnabled(enabled: boolean) {
    this.isVoiceEnabled = enabled;
    localStorage.setItem("daisy_voice_enabled", String(enabled));
    if (!enabled) {
      this.cancel();
    }
  }

  getAnimeMode() {
    return this.isAnimeMode;
  }

  setAnimeMode(enabled: boolean) {
    this.isAnimeMode = enabled;
    localStorage.setItem("daisy_anime_voice_enabled", String(enabled));
  }

  cancel() {
    this.speakToken++;
    this.busy = false;
    this.stopAudio();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * True from the instant speak() is called until audio actually finishes
   * (or fails to start at all) — not just while audio is audibly playing.
   * Use this (not isSpeaking) to gate mic capture during turn-taking: it
   * closes the gap between "reply is ready" and "TTS fetch has resolved
   * and playback began", which isSpeaking() alone misses.
   */
  isBusy(): boolean {
    return this.busy;
  }

  private releaseBusy(token: number) {
    if (token === this.speakToken) this.busy = false;
  }

  private stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
    }
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
    this.isPlayingAudio = false;
  }

  speak(text: string, force: boolean = false) {
    if (!this.isVoiceEnabled && !force) return;
    if (typeof window === "undefined") return;

    // Cancel anything playing (and invalidate in-flight TTS requests)
    this.cancel();
    const token = this.speakToken;
    this.busy = true;

    // Clean up markdown syntax, backticks, emojis, asterisks and code blocks
    let cleanText = text
      .replace(/```[\s\S]*?```/g, " [displays code block] ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/#+\s+(.+)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Strip every emoji/pictograph (including joiners, variation selectors,
    // skin tones and flags) rather than a hand-picked range list \u2014 local TTS
    // engines (Piper/espeak, macOS `say`) read unstripped symbols out by
    // name (e.g. "sparkles", "blossom") instead of skipping them.
    cleanText = cleanText.replace(
      /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u200D\uFE0F\u20E3]|[\u{1F1E6}-\u{1F1FF}]/gu,
      ""
    );

    // Whitelist: keep letters, numbers, and basic sentence punctuation.
    // Anything else left over (stray asterisks from unpaired markdown,
    // dingbats, box-drawing characters, etc.) also gets read out by name by
    // local TTS engines, so drop it rather than risk mispronunciation.
    cleanText = cleanText.replace(/[^\p{L}\p{N}\s.,!?'":;()-]/gu, "");

    // Collapse repeated punctuation ("!!!" -> "!") so engines that spell out
    // runs of identical punctuation don't say "exclamation mark" repeatedly.
    cleanText = cleanText.replace(/([!?.])\1+/g, "$1");

    cleanText = cleanText
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // If text is empty after cleaning, return
    if (!cleanText.trim()) {
      this.releaseBusy(token);
      return;
    }

    // Add an energetic, emotional English interjection when in expressive mode!
    if (this.isAnimeMode) {
      const prefixes = [
        "Yay! ",
        "Ooh! ",
        "Yes! ",
        "Woohoo! ",
        "Okay! ",
        "Alright! ",
        "Hehe! ",
        "Got it! ",
        "Ooh, yay! ",
        "Awesome! ",
      ];
      // Pick a prefix based on the text length so it's consistent but varied
      const index = Math.abs(cleanText.length) % prefixes.length;
      cleanText = prefixes[index] + cleanText;

      // Keep the energy up with an exclamation ending
      if (!cleanText.endsWith("!") && !cleanText.endsWith("?")) {
        cleanText += "!";
      }
    }

    // Always prefer the backend's neural girl voice (Piper). It's local and
    // fast, so we retry it on every utterance and only fall back to the
    // browser voice for this single utterance if the request truly fails.
    this.speakViaBackend(cleanText, token).catch(() => {
      if (token === this.speakToken) this.speakViaBrowser(cleanText, token);
      else this.releaseBusy(token);
    });
  }

  /**
   * Speak once the current utterance has finished rather than cutting it off.
   * Used for follow-ups (e.g. a command failing after Daisy already replied),
   * where interrupting her mid-sentence sounds broken.
   */
  async speakAfterCurrent(text: string, force: boolean = false): Promise<void> {
    const deadline = Date.now() + 15000; // never wedge on a stuck utterance
    while (this.isBusy() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    this.speak(text, force);
  }

  /** Fetch synthesized audio from the backend and play it. */
  private async speakViaBackend(text: string, token: number): Promise<void> {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);

    const blob = await res.blob();
    // A newer speak()/cancel() happened while we were waiting — drop this one.
    if (token !== this.speakToken) return;

    this.stopAudio();
    const url = URL.createObjectURL(blob);
    this.currentAudioUrl = url;

    if (!this.audio) this.audio = new Audio();
    const audio = this.audio;
    audio.src = url;
    audio.onplaying = () => {
      this.isPlayingAudio = true;
    };
    const done = () => {
      if (this.currentAudioUrl === url) {
        this.isPlayingAudio = false;
      }
      this.releaseBusy(token);
    };
    audio.onended = done;
    audio.onerror = done;

    await audio.play();
  }

  /** Browser SpeechSynthesis fallback — best available English female voice. */
  private speakViaBrowser(cleanText: string, token: number): void {
    if (!window.speechSynthesis) {
      this.releaseBusy(token);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.onend = () => this.releaseBusy(token);
    utterance.onerror = () => this.releaseBusy(token);

    this.ensureVoicesLoaded().then((voices) => {
      // Pick the best English child/female voice. Male voices are rejected
      // outright — several platforms otherwise default to one.
      const englishVoice =
        voices.find((v) => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return (
            lang.startsWith("en") &&
            !isBlockedMaleVoice(name) &&
            (name.includes("ana") ||    // Microsoft's dedicated child voice
             name.includes("kid") ||
             name.includes("child") ||
             name.includes("junior") ||
             name.includes("samantha") ||
             name.includes("aria") ||
             name.includes("jenny") ||
             name.includes("zira") ||
             name.includes("hazel") ||
             name.includes("google us english") ||
             name.includes("female") ||
             name.includes("karen"))
          );
        }) ||
        voices.find((v) => v.lang.toLowerCase().startsWith("en") && !isBlockedMaleVoice(v.name.toLowerCase()));

      if (englishVoice) {
        utterance.voice = englishVoice;
        utterance.lang = englishVoice.lang;
      } else {
        utterance.lang = "en-US";
      }

      // Natural girl voice at normal speed, with only subtle emotional lift
      // so it stays clear and pleasant (no chipmunk, no rushing).
      const emotion = emotionAdjust(cleanText);
      const basePitch = this.isAnimeMode ? 1.15 : 1.1; // gently bright, girlish
      const baseRate = 1.1;                             // a touch quicker, lively

      utterance.pitch = Math.min(2, Math.max(0, basePitch + emotion.pitch));
      utterance.rate = Math.min(2, Math.max(0.5, baseRate + emotion.rate));
      utterance.volume = 1.0;

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }
}

export const daisyVoice = new DaisyVoiceEngine();
