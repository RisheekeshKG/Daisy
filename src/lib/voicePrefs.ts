/**
 * The voice preferences Settings edits.
 *
 * These keys were already being written from three different places (App's
 * mic toggle, the voice engine's own setters, the dashboard's mute button).
 * Reading them through one module keeps Settings showing what is actually in
 * effect rather than its own idea of it, and gives the values somewhere
 * testable to live.
 */

export const VOICE_PREF_KEYS = {
  alwaysListening: "daisy_always_listening",
  speakReplies: "daisy_voice_enabled",
} as const;

export type VoicePrefKey = keyof typeof VOICE_PREF_KEYS;

/**
 * Read a stored boolean.
 *
 * Anything that isn't a stored "true"/"false" — absent, or a value written by
 * an older build — falls back to `fallback` rather than reading as false, so a
 * first run doesn't silently present every toggle as off.
 */
export function readVoicePref(key: VoicePrefKey, fallback: boolean): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VOICE_PREF_KEYS[key]);
  } catch {
    return fallback;
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function writeVoicePref(key: VoicePrefKey, value: boolean): void {
  try {
    localStorage.setItem(VOICE_PREF_KEYS[key], String(value));
  } catch {
    /* a full or disabled store shouldn't take the toggle down with it */
  }
}
