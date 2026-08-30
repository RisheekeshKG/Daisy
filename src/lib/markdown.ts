/**
 * A small Markdown parser for note previews.
 *
 * Written in-house rather than pulling in `marked`/`remark` for two reasons:
 * the note toolbar only emits a handful of constructs, and — more importantly —
 * every off-the-shelf renderer hands back an HTML *string*, which in React
 * means `dangerouslySetInnerHTML`. Note content is not always typed by the
 * user: Daisy writes notes herself via the ADD_NOTE command, so the content can
 * originate from model output. Parsing to a typed tree that the renderer turns
 * into React elements means untrusted text can never become markup.
 *
 * Deliberately limited to what the editor can produce. Anything unrecognised
 * falls through as literal text rather than being silently swallowed.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; lang: string; value: string }
  | { type: "hr" };

/**
 * Only these schemes are allowed to become a clickable link. A note could
 * contain `[click me](javascript:…)`, and in Electron a navigation is a far
 * bigger deal than in a browser tab.
 */
const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i;

export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href.trim());
}

/** Inline spans of a single line — used by the block editor's rendered view. */
export function parseInlineMarkdown(src: string): Inline[] {
  return parseInline(src);
}

/** Inline spans, innermost-last so nesting works: **bold with `code`**. */
function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;

  // Ordered by precedence: code first so its contents are never re-parsed.
  const RULES: Array<[RegExp, (m: RegExpExecArray) => Inline]> = [
    [/`([^`]+)`/, (m) => ({ type: "code", value: m[1] })],
    [/\*\*([^*]+)\*\*/, (m) => ({ type: "bold", children: parseInline(m[1]) })],
    [/__([^_]+)__/, (m) => ({ type: "bold", children: parseInline(m[1]) })],
    [/~~([^~]+)~~/, (m) => ({ type: "strike", children: parseInline(m[1]) })],
    [/\*([^*]+)\*/, (m) => ({ type: "italic", children: parseInline(m[1]) })],
    [/_([^_]+)_/, (m) => ({ type: "italic", children: parseInline(m[1]) })],
    [
      /\[([^\]]*)\]\(([^)\s]+)\)/,
      (m) => ({ type: "link", href: m[2], children: parseInline(m[1]) }),
    ],
  ];

  while (rest) {
    let bestIndex = Infinity;
    let bestMatch: RegExpExecArray | null = null;
    let bestBuild: ((m: RegExpExecArray) => Inline) | null = null;

    for (const [re, build] of RULES) {
      const m = re.exec(rest);
      if (m && m.index < bestIndex) {
        bestIndex = m.index;
        bestMatch = m;
        bestBuild = build;
      }
    }

    if (!bestMatch || !bestBuild) {
      out.push({ type: "text", value: rest });
      break;
    }

    if (bestIndex > 0) out.push({ type: "text", value: rest.slice(0, bestIndex) });
    out.push(bestBuild(bestMatch));
    rest = rest.slice(bestIndex + bestMatch[0].length);
  }

  return out.filter((n) => n.type !== "text" || n.value !== "");
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const FENCE = /^\s*```(\w*)\s*$/;

export function parseMarkdown(src: string): Block[] {
  const lines = (src || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const lang = fence[1] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (HR.test(line)) {
      flushParagraph();
      blocks.push({ type: "hr" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      });
      continue;
    }

    // Consecutive bullets/numbers collapse into one list, the way they read.
    const isBullet = BULLET.test(line);
    const isOrdered = !isBullet && ORDERED.test(line);
    if (isBullet || isOrdered) {
      flushParagraph();
      const matcher = isBullet ? BULLET : ORDERED;
      const items: Inline[][] = [];
      while (i < lines.length && matcher.test(lines[i])) {
        items.push(parseInline(matcher.exec(lines[i])![1]));
        i++;
      }
      i--;
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const body = [quote[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        body.push(QUOTE.exec(lines[++i])![1]);
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ")) });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/** Plain text of a note, for list previews and search. */
export function markdownToPlainText(src: string): string {
  const strip = (nodes: Inline[]): string =>
    nodes
      .map((n) =>
        n.type === "text" ? n.value : n.type === "code" ? n.value : strip(n.children)
      )
      .join("");

  return parseMarkdown(src)
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "paragraph":
        case "quote":
          return strip(b.children);
        case "list":
          return b.items.map(strip).join(" ");
        case "code":
          return b.value;
        case "hr":
          return "";
      }
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
