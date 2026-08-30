/**
 * The block model behind the Notion-style note editor.
 *
 * Notes stay stored as Markdown in `Note.content` — Daisy writes notes herself
 * via the ADD_NOTE command, search greps the raw string, and existing notes on
 * disk are already Markdown. So blocks are a *view*: parsed on open, serialized
 * on every edit. The round trip has to be lossless for anything the editor can
 * produce, which is what blocks.test.ts pins down.
 */

export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bulleted"
  | "numbered"
  | "todo"
  | "quote"
  | "code"
  | "divider";

export interface EditorBlock {
  id: string;
  type: BlockType;
  text: string;
  /** Only meaningful for `todo`. */
  checked?: boolean;
}

/** Blocks that continue themselves when you press Enter (like Notion). */
export const CONTINUING: BlockType[] = ["bulleted", "numbered", "todo"];

let counter = 0;
function newBlockId(): string {
  // Stable, cheap, and unique within a session — these never persist.
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}`;
}

export function makeBlock(type: BlockType = "paragraph", text = ""): EditorBlock {
  return { id: newBlockId(), type, text, ...(type === "todo" ? { checked: false } : {}) };
}

const TODO = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DIVIDER = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const FENCE = /^\s*```(\w*)\s*$/;

export function markdownToBlocks(markdown: string): EditorBlock[] {
  const lines = (markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: EditorBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push(makeBlock("code", body.join("\n")));
      continue;
    }
    if (!line.trim()) continue;
    if (DIVIDER.test(line)) {
      blocks.push(makeBlock("divider"));
      continue;
    }

    const todo = TODO.exec(line);
    if (todo) {
      const block = makeBlock("todo", todo[2]);
      block.checked = todo[1].toLowerCase() === "x";
      blocks.push(block);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(makeBlock(`h${heading[1].length}` as BlockType, heading[2]));
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      blocks.push(makeBlock("bulleted", bullet[1]));
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      blocks.push(makeBlock("numbered", numbered[1]));
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      blocks.push(makeBlock("quote", quote[1]));
      continue;
    }

    blocks.push(makeBlock("paragraph", line));
  }

  // An empty note still needs one block to put the cursor in.
  return blocks.length ? blocks : [makeBlock("paragraph")];
}

export function blocksToMarkdown(blocks: EditorBlock[]): string {
  let ordinal = 0;
  const lines = blocks.map((b) => {
    if (b.type !== "numbered") ordinal = 0;
    switch (b.type) {
      case "h1":
        return `# ${b.text}`;
      case "h2":
        return `## ${b.text}`;
      case "h3":
        return `### ${b.text}`;
      case "bulleted":
        return `- ${b.text}`;
      case "numbered":
        ordinal += 1;
        return `${ordinal}. ${b.text}`;
      case "todo":
        return `- [${b.checked ? "x" : " "}] ${b.text}`;
      case "quote":
        return `> ${b.text}`;
      case "code":
        return `\`\`\`\n${b.text}\n\`\`\``;
      case "divider":
        return "---";
      default:
        return b.text;
    }
  });
  return lines.join("\n");
}

/**
 * Notion's defining input trick: typing "# ", "- ", "1. ", "[] " or "> " at the
 * start of a block converts the block itself and swallows the shorthand.
 * Returns null when the text isn't a shortcut.
 */
export function matchInputShortcut(text: string): { type: BlockType; rest: string } | null {
  const rules: Array<[RegExp, BlockType]> = [
    [/^#\s$/, "h1"],
    [/^##\s$/, "h2"],
    [/^###\s$/, "h3"],
    [/^[-*+]\s$/, "bulleted"],
    [/^1[.)]\s$/, "numbered"],
    [/^\[\]\s$/, "todo"],
    [/^\[\s\]\s$/, "todo"],
    [/^>\s$/, "quote"],
    [/^```$/, "code"],
    [/^---$/, "divider"],
  ];
  for (const [re, type] of rules) {
    if (re.test(text)) return { type, rest: "" };
  }
  return null;
}

/** Human labels for the slash menu and the block-type switcher. */
export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Text",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bulleted: "Bulleted list",
  numbered: "Numbered list",
  todo: "To-do list",
  quote: "Quote",
  code: "Code",
  divider: "Divider",
};

export const BLOCK_HINTS: Record<BlockType, string> = {
  paragraph: "Just start writing with plain text.",
  h1: "Big section heading.",
  h2: "Medium section heading.",
  h3: "Small section heading.",
  bulleted: "Create a simple bulleted list.",
  numbered: "Create a list with numbering.",
  todo: "Track tasks with a checkbox.",
  quote: "Capture a quote.",
  code: "Capture a code snippet.",
  divider: "Visually divide blocks.",
};
