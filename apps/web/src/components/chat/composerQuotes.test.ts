import { describe, expect, it } from "vitest";

import { COMPOSER_QUOTES, formatComposerQuote, pickComposerQuoteIndex } from "./composerQuotes";

describe("composer quotes", () => {
  it("keeps the approved quote pool and attribution together", () => {
    expect(COMPOSER_QUOTES).toHaveLength(10);
    expect(COMPOSER_QUOTES).toContainEqual({
      text: "The world is my representation.",
      author: "Arthur Schopenhauer",
    });
    expect(COMPOSER_QUOTES).toContainEqual({
      text: "All the world’s a stage.",
      author: "William Shakespeare",
    });
    expect(COMPOSER_QUOTES.some(({ text }) => text.includes("samsara"))).toBe(false);
    expect(COMPOSER_QUOTES.some(({ text }) => text.startsWith("Storytelling reveals"))).toBe(false);
  });

  it("does not repeat the current quote when the panel opens again", () => {
    expect(pickComposerQuoteIndex(0, () => 0)).toBe(1);
    expect(pickComposerQuoteIndex(4, () => 0.999)).toBe(9);
  });

  it("formats a quote and its attribution as composer placeholder copy", () => {
    expect(formatComposerQuote(COMPOSER_QUOTES[0]!)).toBe(
      "“One must imagine Sisyphus happy.” — Albert Camus",
    );
  });
});
