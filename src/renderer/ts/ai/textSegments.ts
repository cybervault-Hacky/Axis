/**
 * Safe, dependency-free splitting of AI response text into plain-text and
 * fenced-code segments.
 *
 * This is deliberately NOT a Markdown-to-HTML renderer. AXIS never turns
 * model output into HTML and never uses `innerHTML` with untrusted text —
 * every segment produced here is rendered by the caller using `textContent`
 * only (see conversationView.ts), so there is no path by which
 * model-generated text could ever be interpreted as markup or executed.
 * The only "parsing" done is locating ``` fenced blocks so they can be
 * shown in a monospace block with a copy action, which is what the Phase 4
 * brief asks for ("readable ... code blocks") without taking on a Markdown
 * dependency or building an unsafe HTML renderer.
 */

export interface TextSegment {
  type: "text";
  content: string;
}

export interface CodeSegment {
  type: "code";
  language: string | null;
  content: string;
}

export type ResponseSegment = TextSegment | CodeSegment;

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

export function splitIntoSegments(raw: string): ResponseSegment[] {
  if (raw.length === 0) return [];
  const segments: ResponseSegment[] = [];
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: raw.slice(lastIndex, match.index) });
    }
    const language = (match[1] ?? "").trim();
    const code = (match[2] ?? "").replace(/\n$/, "");
    segments.push({ type: "code", language: language.length > 0 ? language : null, content: code });
    lastIndex = FENCE_RE.lastIndex;
  }

  if (lastIndex < raw.length) {
    segments.push({ type: "text", content: raw.slice(lastIndex) });
  }

  return segments;
}
