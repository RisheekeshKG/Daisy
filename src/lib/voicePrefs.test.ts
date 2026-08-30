import { describe, it, expect, beforeEach } from "vitest";
import { VOICE_PREF_KEYS, readVoicePref, writeVoicePref } from "./voicePrefs";

describe("voicePrefs", () => {
  beforeEach(() => localStorage.clear());

  it("returns the fallback when nothing is stored", () => {
    expect(readVoicePref("speakReplies", true)).toBe(true);
    expect(readVoicePref("speakReplies", false)).toBe(false);
  });

  it("round-trips both boolean values", () => {
    writeVoicePref("alwaysListening", true);
    expect(readVoicePref("alwaysListening", false)).toBe(true);
    writeVoicePref("alwaysListening", false);
    expect(readVoicePref("alwaysListening", true)).toBe(false);
  });

  it("falls back rather than reading junk as false", () => {
    // An older build wrote something else under this key; a toggle defaulting
    // to on must not silently flip off because of it.
    localStorage.setItem(VOICE_PREF_KEYS.alwaysListening, "yes");
    expect(readVoicePref("alwaysListening", true)).toBe(true);
  });

  it("writes the keys the rest of the app already reads", () => {
    writeVoicePref("speakReplies", true);
    expect(localStorage.getItem("daisy_voice_enabled")).toBe("true");
  });
});
