import React from "react";
import { parseInlineMarkdown, isSafeHref, type Inline } from "../lib/markdown";
import { daisyBridge } from "../lib/daisyBridge";

/**
 * Renders a single line's inline formatting as React elements.
 *
 * Shared by the block editor (for blocks that aren't currently focused) and
 * anywhere else a one-line preview needs bold/italic/code to actually look
 * like bold/italic/code. As with Markdown.tsx, this builds elements rather
 * than HTML, so note text that came from the model can never become markup.
 */

function render(nodes: Inline[], keyPrefix = ""): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case "text":
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case "bold":
        return <strong key={key} className="font-semibold">{render(node.children, `${key}-`)}</strong>;
      case "italic":
        return <em key={key}>{render(node.children, `${key}-`)}</em>;
      case "strike":
        return <s key={key} className="text-[#9B9A97]">{render(node.children, `${key}-`)}</s>;
      case "code":
        return (
          <code
            key={key}
            className="font-mono text-[0.85em] bg-[#EB5757]/10 text-[#EB5757] rounded px-1 py-[1px]"
          >
            {node.value}
          </code>
        );
      case "link": {
        const label = render(node.children, `${key}-`);
        if (!isSafeHref(node.href)) return <React.Fragment key={key}>{label}</React.Fragment>;
        return (
          <a
            key={key}
            href={node.href}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              daisyBridge?.openExternal?.(node.href) ?? window.open(node.href, "_blank");
            }}
            className="underline decoration-[#37352F]/30 underline-offset-2 hover:decoration-[#37352F] cursor-pointer"
          >
            {label}
          </a>
        );
      }
    }
  });
}

export function renderInlineMarkdown(text: string): React.ReactNode {
  return render(parseInlineMarkdown(text));
}

export default function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInlineMarkdown(text)}</>;
}
