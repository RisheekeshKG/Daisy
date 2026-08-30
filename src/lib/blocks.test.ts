import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  markdownToBlocks,
  matchInputShortcut,
  makeBlock,
  type EditorBlock,
} from "./blocks";

const types = (blocks: EditorBlock[]) => blocks.map((b) => b.type);
const texts = (blocks: EditorBlock[]) => blocks.map((b) => b.text);

describe("markdownToBlocks", () => {
  it("parses the note from the screenshot", () => {
    const blocks = markdownToBlocks(
      "# Today Schedule\n" +
        "- 1:15 PM to 3:00 PM: Study Block - 2 (Resume Topics Finalize)\n" +
        "- 3:00 PM to 4:00 PM: Talking to parents"
    );
    expect(types(blocks)).toEqual(["h1", "bulleted", "bulleted"]);
    expect(blocks[0].text).toBe("Today Schedule");
    // The hyphen inside the item text must survive the list marker strip.
    expect(blocks[1].text).toBe("1:15 PM to 3:00 PM: Study Block - 2 (Resume Topics Finalize)");
  });

  it("parses every block type", () => {
    const blocks = markdownToBlocks(
      "# h1\n## h2\n### h3\n- bullet\n1. numbered\n- [ ] todo\n- [x] done\n> quote\n---\nplain"
    );
    expect(types(blocks)).toEqual([
      "h1", "h2", "h3", "bulleted", "numbered", "todo", "todo", "quote", "divider", "paragraph",
    ]);
    expect(blocks[5].checked).toBe(false);
    expect(blocks[6].checked).toBe(true);
    expect(blocks[6].text).toBe("done");
  });

  it("keeps fenced code as one block, contents untouched", () => {
    const blocks = markdownToBlocks("```js\nconst a = 1;\n// - not a bullet\n```");
    expect(types(blocks)).toEqual(["code"]);
    expect(blocks[0].text).toBe("const a = 1;\n// - not a bullet");
  });

  it("always yields at least one block to focus", () => {
    expect(markdownToBlocks("")).toHaveLength(1);
    expect(markdownToBlocks("   \n\n ")).toHaveLength(1);
    expect(markdownToBlocks("")[0].type).toBe("paragraph");
  });

  it("gives every block a unique id", () => {
    const blocks = markdownToBlocks("a\nb\nc\nd");
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
});

describe("blocksToMarkdown", () => {
  it("renumbers ordered lists independently of what was typed", () => {
    const blocks: EditorBlock[] = [
      makeBlock("numbered", "one"),
      makeBlock("numbered", "two"),
      makeBlock("numbered", "three"),
    ];
    expect(blocksToMarkdown(blocks)).toBe("1. one\n2. two\n3. three");
  });

  it("restarts numbering after a different block interrupts the list", () => {
    const blocks: EditorBlock[] = [
      makeBlock("numbered", "one"),
      makeBlock("paragraph", "break"),
      makeBlock("numbered", "restarted"),
    ];
    expect(blocksToMarkdown(blocks)).toBe("1. one\nbreak\n1. restarted");
  });

  it("writes todo checkboxes in Markdown task syntax", () => {
    const done = makeBlock("todo", "shipped");
    done.checked = true;
    expect(blocksToMarkdown([makeBlock("todo", "open"), done])).toBe("- [ ] open\n- [x] shipped");
  });
});

describe("round trip", () => {
  // Notes live on disk as Markdown, so anything the editor can build must
  // survive save -> reopen unchanged.
  const samples = [
    "# Today Schedule\n- 1:15 PM to 3:00 PM: Study Block - 2\n- Talking to parents",
    "# h1\n## h2\n### h3",
    "- [ ] open task\n- [x] done task",
    "1. one\n2. two\n3. three",
    "> a quote\n---\nplain paragraph",
    "```\nconst a = 1;\n```",
    "Text with **bold**, *italic*, `code` and a [link](https://example.com).",
  ];

  for (const md of samples) {
    it(`is stable for: ${md.split("\n")[0].slice(0, 32)}…`, () => {
      const once = blocksToMarkdown(markdownToBlocks(md));
      const twice = blocksToMarkdown(markdownToBlocks(once));
      expect(once).toBe(md);
      expect(twice).toBe(once);
    });
  }
});

describe("matchInputShortcut", () => {
  it("recognises Notion's markdown shortcuts", () => {
    expect(matchInputShortcut("# ")).toMatchObject({ type: "h1" });
    expect(matchInputShortcut("## ")).toMatchObject({ type: "h2" });
    expect(matchInputShortcut("### ")).toMatchObject({ type: "h3" });
    expect(matchInputShortcut("- ")).toMatchObject({ type: "bulleted" });
    expect(matchInputShortcut("* ")).toMatchObject({ type: "bulleted" });
    expect(matchInputShortcut("1. ")).toMatchObject({ type: "numbered" });
    expect(matchInputShortcut("[] ")).toMatchObject({ type: "todo" });
    expect(matchInputShortcut("> ")).toMatchObject({ type: "quote" });
    expect(matchInputShortcut("```")).toMatchObject({ type: "code" });
    expect(matchInputShortcut("---")).toMatchObject({ type: "divider" });
  });

  it("swallows the shorthand rather than leaving it in the text", () => {
    expect(matchInputShortcut("# ")!.rest).toBe("");
  });

  it("does not fire mid-sentence or on ordinary text", () => {
    expect(matchInputShortcut("hello # world")).toBeNull();
    expect(matchInputShortcut("#hashtag")).toBeNull();
    expect(matchInputShortcut("2. ")).toBeNull(); // only "1." starts a list
    expect(matchInputShortcut("")).toBeNull();
  });
});
