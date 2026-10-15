import { describe, expect, it } from "vitest";
import { splitIntoSegments } from "../src/renderer/ts/ai/textSegments";

describe("splitIntoSegments", () => {
  it("returns no segments for empty input", () => {
    expect(splitIntoSegments("")).toEqual([]);
  });

  it("returns a single text segment for plain text with no code fences", () => {
    expect(splitIntoSegments("Hello, world.")).toEqual([{ type: "text", content: "Hello, world." }]);
  });

  it("extracts a labelled fenced code block surrounded by text", () => {
    const raw = "Here is some code:\n```js\nconsole.log('hi');\n```\nThat's it.";
    const segments = splitIntoSegments(raw);
    expect(segments).toEqual([
      { type: "text", content: "Here is some code:\n" },
      { type: "code", language: "js", content: "console.log('hi');" },
      { type: "text", content: "\nThat's it." }
    ]);
  });

  it("extracts an unlabelled fenced code block as language: null", () => {
    const segments = splitIntoSegments("```\nplain code\n```");
    expect(segments).toEqual([{ type: "code", language: null, content: "plain code" }]);
  });

  it("handles multiple code blocks in one response", () => {
    const raw = "```py\na = 1\n```\nmiddle\n```py\nb = 2\n```";
    const segments = splitIntoSegments(raw);
    expect(segments.filter((s) => s.type === "code")).toHaveLength(2);
    expect(segments.map((s) => s.content.trim())).toEqual(["a = 1", "middle", "b = 2"]);
  });

  it("treats an unterminated trailing fence as plain text rather than guessing at a code block", () => {
    const raw = "Some text and an unterminated fence:\n```js\nstill typing...";
    const segments = splitIntoSegments(raw);
    expect(segments).toEqual([{ type: "text", content: raw }]);
  });

  it("never interprets HTML-looking text as markup — it always stays a plain string in the segment", () => {
    const raw = "<img src=x onerror=alert(1)>Hello & <b>world</b>";
    const segments = splitIntoSegments(raw);
    expect(segments).toEqual([{ type: "text", content: raw }]);
  });
});
