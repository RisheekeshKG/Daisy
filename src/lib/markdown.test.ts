import { describe, expect, it } from "vitest";
import { isSafeHref, markdownToPlainText, parseMarkdown, type Block } from "./markdown";

const text = (b: Block): string =>
  "children" in b
    ? b.children.map((c) => ("value" in c ? c.value : "")).join("")
    : "";

describe("parseMarkdown — blocks", () => {
  it("parses the note from the screenshot", () => {
    const blocks = parseMarkdown(
      "# Today Schedule\n" +
        "- 1:15 PM to 3:00 PM: Study Block - 2 (Resume Topics Finalize)\n" +
        "- 3:00 PM to 4:00 PM: Talking to parents"
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("heading");
    expect(text(blocks[0])).toBe("Today Schedule");
    expect(blocks[1]).toMatchObject({ type: "list", ordered: false });
    expect((blocks[1] as any).items).toHaveLength(2);
  });

  it("keeps hyphens inside list item text", () => {
    // The old preview stripped every "-", turning "Study Block - 2" into
    // "Study Block  2" and "well-known" into "wellknown".
    const out = markdownToPlainText("- Study Block - 2 (well-known case)");
    expect(out).toContain("Study Block - 2");
    expect(out).toContain("well-known");
  });

  it("parses all heading levels", () => {
    for (let n = 1; n <= 6; n++) {
      const [b] = parseMarkdown(`${"#".repeat(n)} Title`);
      expect(b).toMatchObject({ type: "heading", level: n });
    }
  });

  it("groups consecutive bullets into one list and splits on a blank line", () => {
    const blocks = parseMarkdown("- a\n- b\n\n- c");
    expect(blocks.filter((b) => b.type === "list")).toHaveLength(2);
  });

  it("parses ordered lists", () => {
    const [b] = parseMarkdown("1. first\n2. second");
    expect(b).toMatchObject({ type: "list", ordered: true });
    expect((b as any).items).toHaveLength(2);
  });

  it("parses fenced code without touching its contents", () => {
    const [b] = parseMarkdown("```js\nconst a = **not bold**;\n```");
    expect(b).toMatchObject({ type: "code", lang: "js" });
    expect((b as any).value).toBe("const a = **not bold**;");
  });

  it("parses quotes and horizontal rules", () => {
    expect(parseMarkdown("> quoted")[0].type).toBe("quote");
    expect(parseMarkdown("---")[0].type).toBe("hr");
  });

  it("joins wrapped lines into one paragraph", () => {
    const blocks = parseMarkdown("one line\nsecond line");
    expect(blocks).toHaveLength(1);
    expect(text(blocks[0])).toBe("one line second line");
  });

  it("returns nothing for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("parseMarkdown — inline", () => {
  const inline = (src: string) => (parseMarkdown(src)[0] as any).children;

  it("parses bold, italic, strike and code", () => {
    expect(inline("**b**")[0].type).toBe("bold");
    expect(inline("__b__")[0].type).toBe("bold");
    expect(inline("*i*")[0].type).toBe("italic");
    expect(inline("_i_")[0].type).toBe("italic");
    expect(inline("~~s~~")[0].type).toBe("strike");
    expect(inline("`c`")[0]).toMatchObject({ type: "code", value: "c" });
  });

  it("does not parse markup inside inline code", () => {
    const nodes = inline("`**not bold**`");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: "code", value: "**not bold**" });
  });

  it("keeps surrounding text around a span", () => {
    const nodes = inline("say **hi** now");
    expect(nodes.map((n: any) => n.type)).toEqual(["text", "bold", "text"]);
    expect(nodes[0].value).toBe("say ");
    expect(nodes[2].value).toBe(" now");
  });

  it("parses links", () => {
    expect(inline("[docs](https://example.com)")[0]).toMatchObject({
      type: "link",
      href: "https://example.com",
    });
  });
});

describe("isSafeHref", () => {
  it("allows http, https and mailto", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.com")).toBe(true);
  });

  it("rejects schemes that would navigate or execute", () => {
    // Notes can be written by the model via ADD_NOTE, and a navigation inside
    // Electron is far more dangerous than in a browser tab.
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>",
      "vbscript:msgbox",
      "  javascript:alert(1)",
    ]) {
      expect(isSafeHref(href), href).toBe(false);
    }
  });
});

describe("markdownToPlainText", () => {
  it("flattens markup for list previews", () => {
    expect(markdownToPlainText("# Title\n\nSome **bold** and `code`.")).toBe(
      "Title Some bold and code."
    );
  });

  it("uses the link label, not the URL", () => {
    expect(markdownToPlainText("see [the docs](https://example.com)")).toBe("see the docs");
  });
});
