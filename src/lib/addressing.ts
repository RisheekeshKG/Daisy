/**
 * Deciding whether an overheard utterance was aimed at Daisy.
 *
 * With no wake word, the mic hears everything in the room — the user talking
 * to Daisy, and the user talking to whoever else is around. This module is the
 * first, local stage of telling those apart, and it runs on every transcript
 * before anything is sent anywhere.
 *
 * It deliberately produces three outcomes rather than a boolean:
 *
 *   "ignore"  — confidently room conversation. Dropped on the machine; never
 *               reaches the network, which is what keeps always-listening from
 *               becoming "stream my friends to a model".
 *   "address" — confidently a request for Daisy. Acted on immediately.
 *   "unsure"  — genuinely ambiguous. Only these go to the LLM for a second
 *               opinion (see notForMe in the backend prompt), because a cheap
 *               keyword scorer cannot resolve "put that on" without knowing
 *               what is happening in the room.
 *
 * The scoring is intentionally asymmetric. A false "address" is loud and
 * embarrassing — Daisy interrupts a conversation she wasn't part of — while a
 * false "ignore" just means you repeat yourself, or say her name. So the
 * evidence needed to speak up is higher than the evidence needed to stay quiet.
 */

export type AddressDecision = "address" | "ignore" | "unsure";

export interface AddressResult {
  decision: AddressDecision;
  score: number;
  /** Which signals fired, for the debug line under the waveform. */
  reasons: string[];
  /** Transcript with a leading "Daisy," stripped — what to send to the LLM. */
  text: string;
  /** True when her name was used as a direct address. */
  named: boolean;
}

export interface AddressOptions {
  /**
   * True while an exchange is still open — Daisy just asked something, or
   * said she was waiting. The user is demonstrably already talking to her, so
   * ambiguity resolves toward her instead of against.
   */
  conversationOpen?: boolean;
}

export function normalizeTranscript(raw: string): string {
  return (raw || "").trim().replace(/\s+/g, " ");
}

/**
 * Her name used as direct address: at the start ("Daisy, play something") or
 * tacked on the end ("play something, Daisy"). Whisper's initial_prompt biases
 * toward the correct spelling but near-misses still come back, so the common
 * ones are accepted too.
 */
const NAME = "(?:dais(?:y|ey|ie)|daizy|dazy|daysi)";
const GREETING = "(?:hey|hi|hello|ok(?:ay)?|yo)";
const NAME_LEADING = new RegExp(`^\\s*(?:\\b${GREETING}\\b[\\s,]*)?\\b${NAME}\\b[\\s,.!?-]*`, "i");
const NAME_TRAILING = new RegExp(`[\\s,]+${NAME}\\s*[.!?]*\\s*$`, "i");

/** Strip a direct address off the utterance, leaving the request itself. */
export function stripDirectAddress(text: string): { named: boolean; rest: string } {
  const leading = text.match(NAME_LEADING);
  if (leading) return { named: true, rest: text.slice(leading[0].length).trim() };

  const trailing = text.match(NAME_TRAILING);
  if (trailing) return { named: true, rest: text.slice(0, trailing.index).trim() };

  return { named: false, rest: text };
}

// --- Signals that this was NOT for Daisy -----------------------------------

/**
 * Talking *about* people rather than to an assistant. Daisy is never a "he",
 * "she" or "they", so a third-person subject is the single most reliable sign
 * that the sentence belongs to a conversation she isn't in.
 */
const THIRD_PERSON = /\b(?:he|she|they|him|her|them|his|hers|their|theirs)\b/i;

/** Reported speech — recounting a conversation, not making a request. */
const REPORTED_SPEECH = /\b(?:said|says|saying|told|telling|asked|asking|mentioned|was like|were like)\b/i;

/** Openers that belong to human conversation, never to a command. */
const BACKCHANNEL =
  /^(?:yeah|yea|yep|yup|nah|nope|uh|um|erm|oh|ah|hmm+|wow|haha+|hehe|lol|lmao|dude|bro|bruh|man|girl|right|exactly|true|seriously|honestly|anyway|anyways|whatever|well|so|like|i mean|you know|wait what|oh my god|omg)\b/i;

/** Addressing a person who is not Daisy ("hey Mark", "yo Sam"). */
const OTHER_ADDRESSEE = new RegExp(`^\\s*\\b${GREETING}\\b[\\s,]+(?!${NAME}\\b)[a-z]+\\b`, "i");

/** First-person narrative — recounting events rather than asking for something. */
const PAST_NARRATIVE =
  /\b(?:i|we|you)\s+(?:was|were|went|did|had|got|saw|came|tried|thought|used to|wanted|couldn't|didn't|wasn't|weren't)\b/i;

/** Opinion/social questions aimed at a person, not an assistant. */
const SOCIAL_QUESTION =
  /\b(?:what do you think|you think|do you wanna|you wanna|wanna|do you want to (?:go|come|grab|get)|how are you|how's it going|what's up|sup)\b/i;

// --- Signals that this WAS for Daisy ---------------------------------------

/**
 * Imperative verbs matching something Daisy can actually do. Anchored to the
 * start because that is what makes a sentence a command rather than a mention:
 * "play something" is a request, "we should play tennis" is not.
 *
 * Deliberately excludes catch-all verbs like "make" and "get" — Daisy has no
 * "make X" surface, so "make some coffee" said across the room would otherwise
 * score as a command on the strength of the verb alone.
 */
const CAPABILITY_IMPERATIVE =
  /^(?:please\s+)?(?:play|pause|resume|stop|skip|next|previous|queue|shuffle|repeat|mute|unmute|turn\s+(?:it\s+|that\s+|this\s+|the\s+\w+\s+)?(?:up|down|on|off)|set|add|schedule|remind|create|write|draft|send|reply|open|show|find|search|read|delete|cancel|move|rename|start)\b/i;

/** Nouns that only come up because Daisy owns that surface. */
const CAPABILITY_DOMAIN =
  /\b(?:spotify|playlist|song|track|album|artist|music|volume|calendar|meeting|appointment|event|reminder|timer|alarm|inbox|email|e-mail|mail|note|notes|task|tasks|todo|schedule|agenda)\b/i;

/** The user's own data — "my calendar", "my inbox". Nobody else owns these. */
const SELF_DATA = /\bmy\s+(?:calendar|schedule|agenda|inbox|email|e-?mails?|mail|notes?|tasks?|todos?|playlists?|music|library|day|week|meetings?|events?|reminders?)\b/i;

/** Questions about the user's own state that only an assistant would answer. */
const SELF_QUESTION =
  /\b(?:do i have|am i free|what(?:'s| is) on my|when(?:'s| is) my|what(?:'s| is) my next|how many .* do i|what time is it|what(?:'s| is) the (?:time|date|weather))\b/i;

/** Politely-framed requests: "can you …", "could you …". */
const REQUEST_FRAME = /\b(?:can you|could you|would you|will you|please)\b/i;

const SCORE_ADDRESS = 4;
const SCORE_IGNORE = -2;
/**
 * How much being mid-exchange is worth. Enough on its own to carry an
 * otherwise featureless reply ("the second one") over the line, since the user
 * has just demonstrably been talking to her.
 */
const CONVERSATION_BOOST = 4;

/**
 * Classify a single utterance. Pure and synchronous — no model call, so this
 * is safe to run on literally everything the mic picks up.
 */
export function classifyAddressee(raw: string, options: AddressOptions = {}): AddressResult {
  const text = normalizeTranscript(raw);
  const { named, rest } = stripDirectAddress(text);
  const reasons: string[] = [];

  if (!text) {
    return { decision: "ignore", score: 0, reasons: ["empty"], text: "", named: false };
  }

  // Saying her name is unambiguous and settles it on its own — it is the one
  // signal a user can reach for deliberately when the heuristics get it wrong,
  // so nothing below is allowed to override it.
  if (named) {
    return { decision: "address", score: 100, reasons: ["named"], text: rest, named: true };
  }

  const words = text.split(/\s+/).length;
  let score = 0;

  if (THIRD_PERSON.test(text)) {
    score -= 4;
    reasons.push("third-person");
  }
  if (REPORTED_SPEECH.test(text)) {
    score -= 3;
    reasons.push("reported-speech");
  }
  if (BACKCHANNEL.test(text)) {
    score -= 4;
    reasons.push("backchannel");
  }
  if (OTHER_ADDRESSEE.test(text)) {
    score -= 5;
    reasons.push("other-addressee");
  }
  if (PAST_NARRATIVE.test(text)) {
    score -= 3;
    reasons.push("past-narrative");
  }
  if (SOCIAL_QUESTION.test(text)) {
    score -= 4;
    reasons.push("social-question");
  }
  // Rambling is conversation; requests are short. Only a mild nudge, since a
  // detailed calendar request can legitimately run long.
  if (words > 18) {
    score -= 1;
    reasons.push("long-utterance");
  }

  // A capability verb in the imperative is the strongest thing short of her
  // name — on its own it is enough to act on, which is what makes "play some
  // jazz" work with no wake word.
  if (CAPABILITY_IMPERATIVE.test(text)) {
    score += 4;
    reasons.push("imperative");
  }
  if (CAPABILITY_DOMAIN.test(text)) {
    score += 2;
    reasons.push("domain");
  }
  if (SELF_DATA.test(text)) {
    score += 3;
    reasons.push("self-data");
  }
  // "do I have anything at three" has no imperative and no domain noun, but
  // nobody asks a friend that phrasing about their own schedule.
  if (SELF_QUESTION.test(text)) {
    score += 4;
    reasons.push("self-question");
  }
  if (REQUEST_FRAME.test(text)) {
    score += 2;
    reasons.push("request-frame");
  }

  // Strong evidence that this belongs to a conversation Daisy isn't in settles
  // it before the mid-exchange boost applies. Otherwise being mid-exchange
  // would drag in the next thing said to someone else in the room — the exact
  // failure that makes an always-on mic feel like it's eavesdropping.
  if (score <= SCORE_IGNORE) {
    return { decision: "ignore", score, reasons, text: rest, named: false };
  }

  // Mid-exchange the user is already, demonstrably, talking to her — so a
  // short reply that carries no keywords of its own ("the second one", "yeah
  // do that") should land rather than be thrown away for lacking evidence.
  if (options.conversationOpen) {
    score += CONVERSATION_BOOST;
    reasons.push("conversation-open");
  }

  const decision: AddressDecision =
    score >= SCORE_ADDRESS ? "address" : score <= SCORE_IGNORE ? "ignore" : "unsure";

  return { decision, score, reasons, text: rest, named: false };
}
