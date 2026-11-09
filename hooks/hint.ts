// The one-line formatting hint glass hands the model: sent with the first
// prompt of a session and again with the first one after a compaction (the
// summary drops it), never every prompt. It replaces the longer per-prompt
// hint of prismantis 0.40.0 (MIT, Copyright (c) 2026 Nahum Litvin).
export const HINT =
  'Glass renders replies: use GFM tables; > [!NOTE|TIP|IMPORTANT|WARNING|CAUTION] alerts; ```mermaid (flowchart, sequenceDiagram, xychart-beta bar/line, pie, gantt); ```figure with {accent|warn|ok|note|dim|strong:text}; runnable commands in fenced blocks.'
