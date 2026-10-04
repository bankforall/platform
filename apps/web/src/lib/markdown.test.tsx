import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Markdown, parseMarkdown } from "./markdown";

describe("legal markdown", () => {
  it("parses headings, paragraphs, nested lists and quotes", () => {
    const blocks = parseMarkdown(
      ["# Title", "", "> **draft**", "", "Line one", "line two", "", "1. first", "2. second", "   - nested", "", "---"].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "quote", blocks: [{ type: "paragraph", text: "**draft**" }] },
      { type: "paragraph", text: "Line one line two" },
      {
        type: "list",
        ordered: true,
        items: [
          { text: "first", children: null },
          { text: "second", children: { type: "list", ordered: false, items: [{ text: "nested", children: null }] } },
        ],
      },
      { type: "hr" },
    ]);
  });

  it("renders inline markup as elements and never as raw HTML", () => {
    const { container } = render(
      <MemoryRouter>
        <Markdown
          source={'# T\n\n**bold** [[fill me]] [in app](/privacy) [ext](https://example.com) [bad](javascript:alert(1)) <img src=x onerror=alert(1)> {{APP_NAME}}'}
          vars={{ APP_NAME: "วงดี" }}
          skipTitle
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("h2")).toBeNull(); // title skipped
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("mark")).toHaveTextContent("fill me");
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/privacy", "https://example.com"]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("วงดี");
  });
});
