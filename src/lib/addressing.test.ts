import { describe, expect, it } from "vitest";
import { classifyAddressee, normalizeTranscript, stripDirectAddress } from "./addressing";

const decide = (text: string, conversationOpen = false) =>
  classifyAddressee(text, { conversationOpen }).decision;

describe("normalizeTranscript", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTranscript("  play   some   jazz  ")).toBe("play some jazz");
  });

  it("returns an empty string for null/undefined input", () => {
    expect(normalizeTranscript(null as unknown as string)).toBe("");
    expect(normalizeTranscript(undefined as unknown as string)).toBe("");
  });
});

describe("stripDirectAddress", () => {
  it("strips a leading name", () => {
    expect(stripDirectAddress("Daisy, play some jazz")).toEqual({
      named: true,
      rest: "play some jazz",
    });
  });

  it("strips a leading greeting + name", () => {
    expect(stripDirectAddress("Hey Daisy what's on my calendar")).toEqual({
      named: true,
      rest: "what's on my calendar",
    });
  });

  it("strips a trailing name", () => {
    expect(stripDirectAddress("play some jazz, Daisy")).toEqual({
      named: true,
      rest: "play some jazz",
    });
  });

  it("accepts common mis-transcriptions of her name", () => {
    for (const variant of ["Daisey", "Daizy", "Dazy", "Daysi", "Daisie"]) {
      expect(stripDirectAddress(`${variant}, play music`).rest).toBe("play music");
    }
  });

  it("leaves an unaddressed utterance alone", () => {
    expect(stripDirectAddress("play some jazz")).toEqual({
      named: false,
      rest: "play some jazz",
    });
  });
});

describe("classifyAddressee — explicit address", () => {
  it("always wins, whatever else the sentence contains", () => {
    // "he" would otherwise be a strong ignore signal.
    expect(decide("Daisy, what did he say about the meeting")).toBe("address");
  });

  it("reports the name and strips it from the forwarded text", () => {
    const result = classifyAddressee("Hey Daisy, play some jazz");
    expect(result.named).toBe(true);
    expect(result.text).toBe("play some jazz");
  });
});

describe("classifyAddressee — clearly for Daisy", () => {
  const forDaisy = [
    "play some jazz",
    "skip this song",
    "turn down the volume",
    // Object-first phrasings are at least as common as "turn down the X".
    "turn it down a bit",
    "turn it up",
    "turn the volume down",
    "what's on my calendar",
    "do i have anything at three",
    "am i free thursday afternoon",
    "schedule a meeting tomorrow at two",
    "add a note about the security draft",
    "can you play my focus playlist",
    "send an email to the design team",
    "what time is it",
    "set a timer for ten minutes",
    "read my inbox",
  ];

  for (const text of forDaisy) {
    it(`addresses: "${text}"`, () => {
      expect(decide(text)).toBe("address");
    });
  }
});

describe("classifyAddressee — clearly room conversation", () => {
  const notForDaisy = [
    "yeah i totally agree with that",
    "he said he was going to be late",
    "did you see what she posted",
    "dude that was hilarious",
    "hey mark can you grab the door",
    "what do you think about the new place",
    "we went to that ramen spot last night",
    "i was telling him about the trip",
    "how's it going",
    "nah i don't think so",
    "she told me they were moving",
    "oh my god that's so funny",
  ];

  for (const text of notForDaisy) {
    it(`ignores: "${text}"`, () => {
      expect(decide(text)).toBe("ignore");
    });
  }
});

describe("classifyAddressee — ambiguous goes to the model", () => {
  const ambiguous = ["put that on", "the second one", "no the other one", "go back"];

  for (const text of ambiguous) {
    it(`is unsure about: "${text}"`, () => {
      expect(decide(text)).toBe("unsure");
    });
  }

  it("resolves ambiguity toward Daisy while an exchange is open", () => {
    expect(decide("the second one", true)).toBe("address");
    expect(decide("put that on", true)).toBe("address");
  });

  it("still ignores obvious room chatter mid-exchange", () => {
    // An open conversation lowers the bar, but shouldn't drag in a sentence
    // that is plainly about someone else.
    expect(decide("he said he was going to be late", true)).toBe("ignore");
    expect(decide("dude that was hilarious", true)).toBe("ignore");
  });
});

describe("classifyAddressee — bias", () => {
  it("treats an empty transcript as nothing to act on", () => {
    expect(decide("")).toBe("ignore");
    expect(decide("   ")).toBe("ignore");
  });

  it("never silently guesses 'address' with no positive evidence", () => {
    // Neutral filler carries no capability signal, so it must not reach the
    // "act on it" branch on its own.
    expect(decide("the thing on the table over there")).not.toBe("address");
  });

  it("exposes the signals that fired for the debug readout", () => {
    const result = classifyAddressee("he said to play the song");
    expect(result.reasons).toContain("third-person");
    expect(result.reasons).toContain("reported-speech");
  });
});
