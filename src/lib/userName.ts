/**
 * The person Daisy is talking to. Asked once on first launch (see
 * OnboardingModal) instead of a name baked into the source — this project is
 * meant to be cloned and run by anyone, not just the original author.
 */

const STORAGE_KEY = "daisy_user_name";
const MAX_LENGTH = 40;

export function getUserName(): string {
  return (localStorage.getItem(STORAGE_KEY) || "").trim();
}

export function hasUserName(): boolean {
  return getUserName().length > 0;
}

export function setUserName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH);
  localStorage.setItem(STORAGE_KEY, clean);
  return clean;
}
