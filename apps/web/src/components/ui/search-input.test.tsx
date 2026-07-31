import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "./input";
import { SearchInput } from "./search-input";
import { Textarea } from "./textarea";

describe("SearchInput", () => {
  it("renders the shared default search field contract", () => {
    const markup = renderToStaticMarkup(
      <SearchInput aria-label="Search files" containerClassName="search-container" placeholder="Search files..." />,
    );

    expect(markup).toContain('data-slot="search-field"');
    expect(markup).toContain("search-container");
    expect(markup).toContain('type="search"');
    expect(markup).toContain('data-size="default"');
    expect(markup).toContain("hover:border-foreground/25");
    expect(markup).toContain("has-focus-visible:ring-0");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("keeps the compact size available for content find bars", () => {
    const markup = renderToStaticMarkup(<SearchInput aria-label="Find in terminal" size="sm" />);

    expect(markup).toContain('data-size="sm"');
    expect(markup).toContain("h-7");
    expect(markup).toContain("min-h-7");
  });

  it("shares the same quiet field shell with regular inputs and textareas", () => {
    const inputMarkup = renderToStaticMarkup(<Input aria-label="Name" />);
    const textareaMarkup = renderToStaticMarkup(<Textarea aria-label="Comment" />);

    for (const markup of [inputMarkup, textareaMarkup]) {
      expect(markup).toContain("border-border");
      expect(markup).toContain("bg-foreground/2");
      expect(markup).toContain("hover:border-foreground/25");
      expect(markup).toContain("has-focus-visible:border-foreground/25");
      expect(markup).toContain("has-focus-visible:ring-0");
    }
    expect(inputMarkup).toContain("overflow-x-hidden");
    expect(textareaMarkup).toContain("overflow-x-hidden");
    expect(textareaMarkup).toContain("whitespace-pre-wrap");
    expect(textareaMarkup).toContain("[overflow-wrap:anywhere]");
  });

  it("keeps standard inputs and search fields at the same exact height", () => {
    const inputMarkup = renderToStaticMarkup(<Input aria-label="Name" />);
    const searchMarkup = renderToStaticMarkup(<SearchInput aria-label="Search" />);

    for (const markup of [inputMarkup, searchMarkup]) {
      expect(markup).toContain("h-8");
      expect(markup).toContain("min-h-8");
    }
  });

  it("keeps the native input borderless inside the single field shell", () => {
    const markup = renderToStaticMarkup(<SearchInput aria-label="Search" nativeInput />);

    expect(markup).toMatch(/data-slot="input-control"[^>]*>.*class="[^"]*border-0[^"]*"[^>]*data-slot="input"/);
  });

  it("keeps form-sized inputs on the shared 38px height", () => {
    const inputMarkup = renderToStaticMarkup(<Input aria-label="Name" size="lg" />);

    expect(inputMarkup).toContain("h-[38px]");
    expect(inputMarkup).toContain("min-h-[38px]");
  });
});
