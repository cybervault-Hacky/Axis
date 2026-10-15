import type { ExamplePrompt } from "../types";

/**
 * Static example prompts shown on Home and AI Workspace. Clicking one only
 * populates the composer — AXIS does not execute or simulate a response in
 * this phase.
 */
export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = [
  {
    id: "summarize-doc",
    title: "Summarize a document",
    prompt: "Summarize the attached quarterly report into five concise bullet points for a leadership update."
  },
  {
    id: "draft-email",
    title: "Draft a follow-up email",
    prompt: "Draft a polite follow-up email to a client who hasn't responded to a proposal sent last week."
  },
  {
    id: "compare-options",
    title: "Compare two options",
    prompt: "Compare the pros and cons of two project management tools for a 12-person engineering team."
  },
  {
    id: "plan-steps",
    title: "Plan next steps",
    prompt: "Break down migrating a desktop app from JavaScript to TypeScript into a clear, ordered checklist."
  }
] as const;
