import React, { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Check } from "lucide-react";
import {
  BLOCK_HINTS,
  BLOCK_LABELS,
  CONTINUING,
  blocksToMarkdown,
  makeBlock,
  markdownToBlocks,
  matchInputShortcut,
  type BlockType,
  type EditorBlock,
} from "../lib/blocks";
import { renderInlineMarkdown } from "./InlineMarkdown";

/**
 * A Notion-style block editor.
 *
 * Each block is its own uncontrolled `contentEditable`. Uncontrolled matters:
 * writing React state back into a focused contentEditable on every keystroke
 * resets the DOM selection and sends the caret to position 0, which is the
 * classic way these editors end up feeling broken. So the DOM owns the text
 * while a block has focus, React owns it the rest of the time, and the two are
 * only synced when the block is *not* focused (see BlockRow's effect).
 *
 * `contentEditable="plaintext-only"` keeps pasted markup out — everything that
 * lands in a block is text, so nothing can inject markup. Inline formatting is
 * rendered by our own React renderer when a block is blurred, never by
 * assigning innerHTML.
 */

const SLASH_ITEMS: BlockType[] = [
  "paragraph", "h1", "h2", "h3", "bulleted", "numbered", "todo", "quote", "code", "divider",
];

const TYPE_CLASS: Record<BlockType, string> = {
  paragraph: "text-[15px] leading-[1.65] text-[#37352F]",
  h1: "text-[26px] font-bold leading-[1.3] text-[#37352F] mt-6 first:mt-0",
  h2: "text-[20px] font-bold leading-[1.3] text-[#37352F] mt-5 first:mt-0",
  h3: "text-[16px] font-bold leading-[1.3] text-[#37352F] mt-4 first:mt-0",
  bulleted: "text-[15px] leading-[1.65] text-[#37352F]",
  numbered: "text-[15px] leading-[1.65] text-[#37352F]",
  todo: "text-[15px] leading-[1.65] text-[#37352F]",
  quote: "text-[15px] leading-[1.65] text-[#37352F] italic",
  code: "text-[13px] leading-[1.6] font-mono text-[#37352F]",
  divider: "",
};

const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bulleted: "List",
  numbered: "List",
  todo: "To-do",
  quote: "Empty quote",
  code: "Code",
};

/** Caret offset within a block, so Backspace/Arrow behaviour can be correct. */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length;
}

function placeCaret(el: HTMLElement, atEnd: boolean) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

interface BlockRowProps {
  block: EditorBlock;
  index: number;
  focused: boolean;
  onChange: (text: string) => void;
  onEnter: (caret: number) => void;
  onBackspaceAtStart: () => void;
  onArrow: (dir: -1 | 1) => void;
  onSlash: (rect: DOMRect) => void;
  onToggleCheck: () => void;
  onFocus: () => void;
  onAddBelow: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDropTarget: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
}

function BlockRow({
  block, focused, onChange, onEnter, onBackspaceAtStart, onArrow, onSlash,
  onToggleCheck, onFocus, onAddBelow, onDragStart, onDragOver, onDrop,
  isDropTarget, registerRef,
}: BlockRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Only push state into the DOM when this block isn't being typed in —
  // otherwise every keystroke would reset the caret to the start.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.textContent !== block.text) {
      el.textContent = block.text;
    }
  }, [block.text]);

  useEffect(() => {
    registerRef(ref.current);
    return () => registerRef(null);
  });

  if (block.type === "divider") {
    return (
      <div
        className="group relative flex items-center py-2"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <BlockControls onAdd={onAddBelow} onDragStart={onDragStart} />
        {isDropTarget && <DropLine />}
        <hr className="w-full border-t border-[#E9E9E7]" />
      </div>
    );
  }

  const showPlaceholder = !block.text && (isFocused || block.type !== "paragraph");
  const placeholder = isFocused && block.type === "paragraph"
    ? "Type '/' for commands…"
    : PLACEHOLDER[block.type] ?? "";

  const editable = (
    <div
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={BLOCK_LABELS[block.type]}
      data-placeholder={showPlaceholder ? placeholder : ""}
      onFocus={() => { setIsFocused(true); onFocus(); }}
      onBlur={(e) => { setIsFocused(false); onChange(e.currentTarget.textContent ?? ""); }}
      onInput={(e) => onChange(e.currentTarget.textContent ?? "")}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
          e.preventDefault();
          onEnter(caretOffset(el));
        } else if (e.key === "Backspace" && caretOffset(el) === 0 && !window.getSelection()?.toString()) {
          e.preventDefault();
          onBackspaceAtStart();
        } else if (e.key === "ArrowUp" && caretOffset(el) === 0) {
          e.preventDefault();
          onArrow(-1);
        } else if (e.key === "ArrowDown" && caretOffset(el) === (el.textContent ?? "").length) {
          e.preventDefault();
          onArrow(1);
        } else if (e.key === "/" && !el.textContent) {
          // Defer so the "/" is in the DOM before the menu measures position.
          requestAnimationFrame(() => onSlash(el.getBoundingClientRect()));
        }
      }}
      className={`outline-none w-full whitespace-pre-wrap break-words empty:before:content-[attr(data-placeholder)] before:text-[#C7C6C4] before:pointer-events-none ${TYPE_CLASS[block.type]} ${
        block.type === "todo" && block.checked ? "line-through text-[#9B9A97]" : ""
      }`}
    />
  );

  return (
    <div
      className="group relative flex items-start gap-1 rounded-[3px] hover:bg-[#37352F]/[0.02] transition-colors"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {isDropTarget && <DropLine />}
      <BlockControls onAdd={onAddBelow} onDragStart={onDragStart} />

      {/* Leading marker: bullet, number, checkbox or quote bar */}
      {block.type === "bulleted" && (
        <span className="select-none text-[#37352F] pt-[3px] w-4 text-center leading-[1.65]">•</span>
      )}
      {block.type === "numbered" && (
        <span className="select-none text-[#37352F] pt-[3px] w-4 text-right text-[14px] leading-[1.65] tabular-nums">
          {(block as EditorBlock & { ordinal?: number }).ordinal ?? 1}.
        </span>
      )}
      {block.type === "todo" && (
        <button
          onClick={onToggleCheck}
          role="checkbox"
          aria-checked={!!block.checked}
          aria-label={block.text || "To-do"}
          className={`mt-[5px] w-[15px] h-[15px] shrink-0 rounded-[3px] border flex items-center justify-center transition-colors cursor-pointer ${
            block.checked
              ? "bg-[#2383E2] border-[#2383E2]"
              : "border-[#B1B0AE] hover:bg-[#37352F]/5"
          }`}
        >
          {block.checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
        </button>
      )}

      <div
        className={`flex-1 min-w-0 py-[3px] ${
          block.type === "quote" ? "border-l-[3px] border-[#37352F] pl-3.5" : ""
        } ${block.type === "code" ? "bg-[#F7F6F3] rounded-[3px] p-4 font-mono" : ""}`}
      >
        {/* Unfocused blocks show rendered inline formatting; focused blocks
            show the raw text you're editing, so markers stay reachable. */}
        {focused || isFocused || !block.text ? (
          editable
        ) : (
          <div
            onClick={(e) => placeCaret(e.currentTarget.parentElement!.querySelector("[contenteditable]") as HTMLElement ?? e.currentTarget, true)}
            className={`${TYPE_CLASS[block.type]} ${
              block.type === "todo" && block.checked ? "line-through text-[#9B9A97]" : ""
            } whitespace-pre-wrap break-words cursor-text`}
          >
            {renderInlineMarkdown(block.text)}
            <div className="hidden">{editable}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function DropLine() {
  return <div className="absolute -top-[1px] left-0 right-0 h-[2px] bg-[#2383E2] rounded-full z-10" />;
}

function BlockControls({ onAdd, onDragStart }: { onAdd: () => void; onDragStart: () => void }) {
  return (
    <div className="absolute -left-[52px] top-[2px] flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={onAdd}
        aria-label="Add block below"
        title="Click to add a block below"
        className="w-6 h-6 rounded flex items-center justify-center text-[#9B9A97] hover:bg-[#37352F]/8 cursor-pointer"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        draggable
        onDragStart={onDragStart}
        aria-label="Drag to reorder"
        title="Drag to move"
        className="w-4 h-6 rounded flex items-center justify-center text-[#9B9A97] hover:bg-[#37352F]/8 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface NotionEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
}

export default function NotionEditor({ markdown, onChange }: NotionEditorProps) {
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => markdownToBlocks(markdown));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ blockId: string; top: number; left: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<{ id: string; atEnd: boolean } | null>(null);

  // Reload when a *different* note is opened. Comparing serialized output means
  // our own edits (which already match) don't clobber the blocks being typed in.
  const lastSerialized = useRef(markdown);
  useEffect(() => {
    if (markdown !== lastSerialized.current) {
      lastSerialized.current = markdown;
      setBlocks(markdownToBlocks(markdown));
    }
  }, [markdown]);

  const commit = useCallback(
    (next: EditorBlock[]) => {
      setBlocks(next);
      const md = blocksToMarkdown(next);
      lastSerialized.current = md;
      onChange(md);
    },
    [onChange]
  );

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const el = refs.current.get(target.id);
    if (el) {
      placeCaret(el, target.atEnd);
      pendingFocus.current = null;
    }
  });

  const update = (id: string, patch: Partial<EditorBlock>) =>
    commit(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const handleText = (id: string, text: string) => {
    const shortcut = matchInputShortcut(text);
    if (shortcut) {
      pendingFocus.current = { id, atEnd: true };
      const el = refs.current.get(id);
      if (el) el.textContent = "";
      commit(
        blocks.map((b) =>
          b.id === id
            ? { ...b, type: shortcut.type, text: shortcut.rest, ...(shortcut.type === "todo" ? { checked: false } : {}) }
            : b
        )
      );
      return;
    }
    // Typing edits the DOM directly; only mirror into state, never back out.
    setBlocks((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, text } : b));
      const md = blocksToMarkdown(next);
      lastSerialized.current = md;
      onChange(md);
      return next;
    });
  };

  const insertAfter = (id: string, type: BlockType = "paragraph") => {
    const i = blocks.findIndex((b) => b.id === id);
    const block = makeBlock(type);
    const next = [...blocks.slice(0, i + 1), block, ...blocks.slice(i + 1)];
    pendingFocus.current = { id: block.id, atEnd: false };
    commit(next);
  };

  const handleEnter = (id: string, caret: number) => {
    const i = blocks.findIndex((b) => b.id === id);
    const block = blocks[i];

    // Enter on an empty continuing block exits the list, as Notion does.
    if (CONTINUING.includes(block.type) && !block.text) {
      pendingFocus.current = { id, atEnd: false };
      update(id, { type: "paragraph" });
      return;
    }

    const text = refs.current.get(id)?.textContent ?? block.text;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    // Lists and to-dos continue themselves; headings drop back to plain text.
    const nextType: BlockType = CONTINUING.includes(block.type) ? block.type : "paragraph";
    const created = makeBlock(nextType, after);

    const next = [...blocks];
    next[i] = { ...block, text: before };
    next.splice(i + 1, 0, created);
    const el = refs.current.get(id);
    if (el) el.textContent = before;
    pendingFocus.current = { id: created.id, atEnd: false };
    commit(next);
  };

  const handleBackspace = (id: string) => {
    const i = blocks.findIndex((b) => b.id === id);
    const block = blocks[i];

    // First press converts a styled block back to plain text.
    if (block.type !== "paragraph") {
      pendingFocus.current = { id, atEnd: false };
      update(id, { type: "paragraph" });
      return;
    }
    if (i === 0) return;

    // Merge into the previous block, caret landing at the seam.
    const prev = blocks[i - 1];
    if (prev.type === "divider") {
      commit(blocks.filter((b) => b.id !== prev.id));
      return;
    }
    const merged = { ...prev, text: prev.text + block.text };
    const next = [...blocks.slice(0, i - 1), merged, ...blocks.slice(i + 1)];
    const el = refs.current.get(prev.id);
    if (el) el.textContent = merged.text;
    pendingFocus.current = { id: prev.id, atEnd: true };
    commit(next);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id);
    const target = blocks[i + dir];
    if (!target) return;
    const el = refs.current.get(target.id);
    if (el) placeCaret(el, dir === -1);
  };

  const applySlash = (type: BlockType) => {
    if (!slash) return;
    const id = slash.blockId;
    const el = refs.current.get(id);
    if (el) el.textContent = "";
    setSlash(null);
    setSlashIndex(0);
    pendingFocus.current = { id, atEnd: true };
    commit(
      blocks.map((b) =>
        b.id === id
          ? { ...b, type, text: "", ...(type === "todo" ? { checked: false } : {}) }
          : b
      )
    );
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return setDropId(null);
    const from = blocks.findIndex((b) => b.id === dragId);
    const to = blocks.findIndex((b) => b.id === targetId);
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    setDropId(null);
    commit(next);
  };

  // Ordinals for numbered lists, recomputed so display matches serialization.
  let ordinal = 0;
  const withOrdinals = blocks.map((b) => {
    if (b.type !== "numbered") ordinal = 0;
    else ordinal += 1;
    return { ...b, ordinal };
  });

  return (
    <div className="relative pl-[52px] pr-2">
      {withOrdinals.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          index={index}
          focused={focusId === block.id}
          registerRef={(el) => {
            if (el) refs.current.set(block.id, el);
            else refs.current.delete(block.id);
          }}
          onFocus={() => setFocusId(block.id)}
          onChange={(text) => handleText(block.id, text)}
          onEnter={(caret) => handleEnter(block.id, caret)}
          onBackspaceAtStart={() => handleBackspace(block.id)}
          onArrow={(dir) => move(block.id, dir)}
          onSlash={(rect) => {
            setSlash({ blockId: block.id, top: rect.bottom + 6, left: rect.left });
            setSlashIndex(0);
          }}
          onToggleCheck={() => update(block.id, { checked: !block.checked })}
          onAddBelow={() => insertAfter(block.id)}
          onDragStart={() => setDragId(block.id)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragId) setDropId(block.id);
          }}
          onDrop={() => handleDrop(block.id)}
          isDropTarget={dropId === block.id && dragId !== block.id}
        />
      ))}

      {/* Click the empty space under the last block to keep writing. */}
      <div
        onClick={() => {
          const last = blocks[blocks.length - 1];
          if (last && last.type === "paragraph" && !last.text) {
            refs.current.get(last.id)?.focus();
          } else if (last) {
            insertAfter(last.id);
          }
        }}
        className="h-24 cursor-text"
      />

      {slash && (
        <SlashMenu
          top={slash.top}
          left={slash.left}
          index={slashIndex}
          onIndexChange={setSlashIndex}
          onPick={applySlash}
          onClose={() => setSlash(null)}
        />
      )}
    </div>
  );
}

function SlashMenu({
  top, left, index, onIndexChange, onPick, onClose,
}: {
  top: number; left: number; index: number;
  onIndexChange: (i: number) => void;
  onPick: (t: BlockType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const items = SLASH_ITEMS.filter((t) =>
    BLOCK_LABELS[t].toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); onIndexChange((index + 1) % items.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); onIndexChange((index - 1 + items.length) % items.length); }
      else if (e.key === "Enter" && items[index]) { e.preventDefault(); onPick(items[index]); }
      else if (e.key === "Backspace" && !query) onClose();
      else if (e.key.length === 1) setQuery((q) => q + e.key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, items, query, onClose, onIndexChange, onPick]);

  if (!items.length) return null;

  return (
    <div
      style={{ top, left }}
      role="listbox"
      aria-label="Block types"
      className="fixed z-50 w-[300px] max-h-[330px] overflow-y-auto bg-white rounded-lg shadow-[0_0_0_1px_rgba(15,15,15,0.05),0_9px_24px_rgba(15,15,15,0.2)] py-1.5"
    >
      <p className="px-3 py-1.5 text-[11px] font-semibold text-[#9B9A97] uppercase tracking-wide">
        Basic blocks
      </p>
      {items.map((type, i) => (
        <button
          key={type}
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => onIndexChange(i)}
          onClick={() => onPick(type)}
          className={`w-full flex items-center gap-3 px-3 py-1.5 text-left cursor-pointer ${
            i === index ? "bg-[#37352F]/[0.06]" : ""
          }`}
        >
          <span className="w-11 h-11 shrink-0 rounded border border-[#E9E9E7] bg-white flex items-center justify-center text-[#37352F]">
            <BlockGlyph type={type} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] text-[#37352F] truncate">{BLOCK_LABELS[type]}</span>
            <span className="block text-[12px] text-[#9B9A97] truncate">{BLOCK_HINTS[type]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function BlockGlyph({ type }: { type: BlockType }) {
  const glyph: Record<BlockType, string> = {
    paragraph: "Aa", h1: "H1", h2: "H2", h3: "H3",
    bulleted: "•", numbered: "1.", todo: "☑", quote: "❝", code: "</>", divider: "—",
  };
  return <span className="text-[13px] font-semibold">{glyph[type]}</span>;
}
