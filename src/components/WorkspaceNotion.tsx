import React, { useState } from "react";
import { Plus, Trash, FileText, Search, Tag, Eye, EyeOff, ShieldCheck, Sparkles, CornerDownLeft } from "lucide-react";
import { Note } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface WorkspaceNotionProps {
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (id: string | null) => void;
  onAddNote: (note: { title: string; content: string; tags: string[] }) => void;
  onDeleteNote: (id: string) => void;
  onUpdateNote: (note: Note) => void;
  isEncryptionActive: boolean;
}

export default function WorkspaceNotion({
  notes,
  selectedNoteId,
  onSelectNote,
  onAddNote,
  onDeleteNote,
  onUpdateNote,
  isEncryptionActive,
}: WorkspaceNotionProps) {
  const [search, setSearch] = useState("");
  const [tagInput, setTagInput] = useState("");
  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  // Filter notes based on title, content, or tags
  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.content.toLowerCase().includes(search.toLowerCase()) ||
      n.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreateNewNote = () => {
    onAddNote({
      title: "Untitled Note Draft",
      content: "# Workspace Note\nStart typing secure ideas here...",
      tags: ["draft"],
    });
  };

  const handleTextChange = (content: string) => {
    if (selectedNote) {
      onUpdateNote({
        ...selectedNote,
        content,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleTitleChange = (title: string) => {
    if (selectedNote) {
      onUpdateNote({
        ...selectedNote,
        title,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagInput.trim() || !selectedNote) return;
    if (!selectedNote.tags.includes(tagInput.trim().toLowerCase())) {
      onUpdateNote({
        ...selectedNote,
        tags: [...selectedNote.tags, tagInput.trim().toLowerCase()],
        updatedAt: new Date().toISOString(),
      });
    }
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!selectedNote) return;
    onUpdateNote({
      ...selectedNote,
      tags: selectedNote.tags.filter((t) => t !== tagToRemove),
      updatedAt: new Date().toISOString(),
    });
  };

  // Quick rich markdown inserts
  const insertMarkdown = (syntax: string) => {
    if (!selectedNote) return;
    const textarea = document.getElementById("note-editor-textarea") as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selection = text.substring(start, end);
    
    let replacement = "";
    if (syntax === "h1") replacement = `# ${selection || "Heading 1"}`;
    else if (syntax === "h2") replacement = `## ${selection || "Heading 2"}`;
    else if (syntax === "bold") replacement = `**${selection || "bold text"}**`;
    else if (syntax === "italic") replacement = `*${selection || "italic text"}*`;
    else if (syntax === "code") replacement = `\`${selection || "codeBlock"}\``;
    else if (syntax === "bullet") replacement = `\n- ${selection || "List item"}`;

    const newContent = text.substring(0, start) + replacement + text.substring(end);
    handleTextChange(newContent);
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 50);
  };

  // Simulated AI Summary trigger
  const handleAISummarize = async () => {
    if (!selectedNote) return;
    try {
      // Direct Jarvis core API fetch for summary
      const response = await fetch("/api/jarvis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Please summarize the following note content in 2 concise bullets. Note: "${selectedNote.content}"`,
          context: { currentTime: new Date().toISOString() },
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const summary = `\n\n---\n**🤖 JARVIS Neural Summary:**\n${data.text || "Summary compilation failed."}`;
        handleTextChange(selectedNote.content + summary);
      }
    } catch (err) {
      console.error("AI summarization failed", err);
    }
  };

  return (
    <div id="workspace_notion_view" className="h-full max-md:h-auto flex flex-col p-4 md:p-6 text-zinc-800 overflow-hidden max-md:overflow-y-auto">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200/60 pb-4 mb-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl relative text-amber-600 shadow-sm">
            <FileText className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-pink-400 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-zinc-900 tracking-tight">
              Daisy Task & Notes Workspace
            </h1>
            <p className="text-xs text-zinc-500 font-medium">Delightfully organized, offline-first secure drafts 🌸</p>
          </div>
        </div>

        {/* Search & Action Buttons */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-40 sm:w-56 bg-zinc-50 hover:bg-zinc-100/70 focus:bg-white border border-zinc-200 rounded-2xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300/50 focus:border-amber-400 text-zinc-800 placeholder-zinc-400 transition-all shadow-sm"
            />
          </div>

          <button
            onClick={handleCreateNewNote}
            className="flex items-center gap-1.5 px-4.5 py-2 bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold rounded-full shadow-md hover:shadow-lg hover:scale-102 active:scale-98 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>New Note</span>
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        {/* Left Column: Sidebar Note List (lg:col-span-4) */}
        <div className="lg:col-span-4 flex flex-col bg-white/15 backdrop-blur-xl border border-white/30 rounded-[28px] p-4 min-h-[300px] lg:h-full lg:min-h-0 shadow-inner">
          <div className="flex items-center justify-between text-xs font-bold text-zinc-500 mb-3 px-1 tracking-wider uppercase">
            <span>Documents ({filteredNotes.length})</span>
            {isEncryptionActive && (
              <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full text-[10px]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>SECURED</span>
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            <AnimatePresence>
              {filteredNotes.map((note) => {
                const isSelected = note.id === selectedNoteId;
                return (
                  <motion.div
                    key={note.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    whileHover={{ scale: 1.01 }}
                    onClick={() => onSelectNote(note.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer group flex flex-col justify-between h-24 shadow-sm backdrop-blur-md ${
                      isSelected
                        ? "bg-white/70 border-amber-400 shadow-md ring-2 ring-amber-400/20"
                        : "bg-white/30 border-white/40 hover:bg-white/50 hover:border-white/60"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 min-w-0">
                      <h4 className={`text-xs font-bold truncate flex-1 ${isSelected ? "text-amber-600 font-extrabold" : "text-zinc-800"}`}>
                        {note.title || "Untitled draft"}
                      </h4>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNote(note.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-rose-500 transition-all cursor-pointer"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[11px] text-zinc-500 truncate line-clamp-2 pr-2 leading-relaxed">
                      {note.content.replace(/[#*`\-]/g, "")}
                    </p>

                    <div className="flex justify-between items-center text-[9px] font-mono text-zinc-400">
                      <span>
                        {new Date(note.updatedAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="flex gap-1">
                        {note.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="bg-amber-100/50 border border-amber-200/60 text-amber-700 px-1.5 py-0.5 rounded text-[8px] font-bold"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Column: Editor Workspace (lg:col-span-8) */}
        <div className="lg:col-span-8 flex flex-col bg-white/20 backdrop-blur-xl border border-white/40 rounded-[28px] p-5 md:p-6 min-h-[450px] lg:h-full lg:min-h-0 shadow-[0_8px_32px_rgba(251,191,36,0.04)] relative">
          {selectedNote ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Editor controls */}
              <div className="flex flex-wrap items-center justify-between border-b border-zinc-100 pb-3 mb-4 gap-3">
                {/* Title */}
                <input
                  type="text"
                  value={selectedNote.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="bg-transparent border-none text-base font-extrabold text-zinc-800 focus:outline-none w-full sm:w-60 focus:ring-0"
                  placeholder="Note Title"
                />

                {/* Format buttons shelf */}
                <div className="flex items-center gap-1.5 bg-white/40 backdrop-blur-sm border border-white/40 p-1 rounded-xl text-xs shadow-sm">
                  <button
                    onClick={() => insertMarkdown("h1")}
                    className="p-1 hover:bg-white rounded text-zinc-700 font-bold cursor-pointer w-7 h-7 flex items-center justify-center transition-colors"
                    title="Header 1"
                  >
                    H1
                  </button>
                  <button
                    onClick={() => insertMarkdown("h2")}
                    className="p-1 hover:bg-white rounded text-zinc-700 font-bold cursor-pointer w-7 h-7 flex items-center justify-center transition-colors"
                    title="Header 2"
                  >
                    H2
                  </button>
                  <div className="w-px h-4 bg-zinc-200" />
                  <button
                    onClick={() => insertMarkdown("bold")}
                    className="p-1 hover:bg-white rounded text-zinc-700 font-semibold cursor-pointer w-7 h-7 flex items-center justify-center transition-colors"
                    title="Bold"
                  >
                    B
                  </button>
                  <button
                    onClick={() => insertMarkdown("italic")}
                    className="p-1 hover:bg-white rounded text-zinc-700 italic cursor-pointer w-7 h-7 flex items-center justify-center transition-colors"
                    title="Italic"
                  >
                    I
                  </button>
                  <button
                    onClick={() => insertMarkdown("code")}
                    className="p-1 hover:bg-white rounded text-zinc-700 font-mono cursor-pointer w-7 h-7 flex items-center justify-center transition-colors"
                    title="Code"
                  >
                    &lt;/&gt;
                  </button>
                  <button
                    onClick={() => insertMarkdown("bullet")}
                    className="p-1 hover:bg-white rounded text-zinc-700 cursor-pointer px-1.5 h-7 flex items-center justify-center transition-colors text-[10px]"
                    title="List"
                  >
                    • List
                  </button>
                  <div className="w-px h-4 bg-zinc-200" />
                  <button
                    onClick={handleAISummarize}
                    className="p-1 px-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 rounded-lg text-white flex items-center gap-1 text-[10px] font-bold shadow-sm hover:scale-105 active:scale-95 transition-all cursor-pointer h-7"
                    title="AI Summarize"
                  >
                    <Sparkles className="w-3 h-3 text-white fill-white" />
                    <span>DAISY AI</span>
                  </button>
                </div>
              </div>

              {/* Text Area */}
              <div className="flex-1 flex flex-col min-h-0 relative">
                <textarea
                  id="note-editor-textarea"
                  value={selectedNote.content}
                  onChange={(e) => handleTextChange(e.target.value)}
                  className="w-full flex-1 bg-transparent border-none text-xs text-zinc-700 focus:outline-none resize-none leading-relaxed font-sans scroll-smooth h-full pr-1 focus:ring-0"
                  placeholder="Draft encrypted ideas here..."
                />
              </div>

              {/* Footer and Tag Management */}
              <div className="mt-4 pt-3 border-t border-zinc-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                {/* Active Tags tags */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-amber-500" />
                  {selectedNote.tags.map((t) => (
                    <span
                      key={t}
                      onClick={() => handleRemoveTag(t)}
                      className="group/tag bg-amber-100 hover:bg-rose-100 border border-amber-200 hover:border-rose-200 px-2.5 py-0.5 rounded-lg text-[10px] text-amber-700 hover:text-rose-700 transition-all cursor-pointer flex items-center gap-1 font-semibold"
                    >
                      <span>#{t}</span>
                      <span className="text-[8px] opacity-40 group-hover/tag:opacity-100">×</span>
                    </span>
                  ))}
                  
                  {/* Tag addition input */}
                  <form onSubmit={handleAddTag} className="inline-flex items-center">
                    <input
                      type="text"
                      placeholder="+ Tag"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      className="bg-transparent border-b border-zinc-200 focus:border-amber-400 text-[10px] text-zinc-700 focus:outline-none w-16 px-1 py-0.5"
                    />
                  </form>
                </div>

                <div className="text-[10px] text-zinc-400 font-mono">
                  Saved locally: {new Date(selectedNote.updatedAt).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
              <div className="relative mb-4">
                <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center text-amber-500 relative">
                  <FileText className="w-8 h-8" />
                  {/* Cute daisy petal overlay */}
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full border-2 border-white flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  </div>
                </div>
              </div>
              <h3 className="text-sm font-bold text-zinc-800">Select or Create a Document</h3>
              <p className="text-xs text-zinc-500 max-w-xs mt-1 leading-relaxed font-medium">
                Your workspace documents are secure and offline-first. Use the AI Summarize feature to compile insights immediately.
              </p>
              <button
                onClick={handleCreateNewNote}
                className="mt-5 px-5 py-2.5 bg-gradient-to-r from-amber-400 to-orange-400 text-white text-xs font-bold rounded-full hover:from-amber-500 hover:to-orange-500 cursor-pointer shadow-md hover:scale-102 transition-all"
              >
                Create Document Draft
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
