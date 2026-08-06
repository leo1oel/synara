export interface ComposerQuote {
  text: string;
  author: string;
}

export const COMPOSER_QUOTES: ReadonlyArray<ComposerQuote> = [
  { text: "One must imagine Sisyphus happy.", author: "Albert Camus" },
  { text: "Man is condemned to be free.", author: "Jean-Paul Sartre" },
  { text: "I think, therefore I am.", author: "René Descartes" },
  { text: "To study the self is to forget the self.", author: "Dōgen" },
  { text: "Anxiety is the dizziness of freedom.", author: "Søren Kierkegaard" },
  {
    text: "Whereof one cannot speak, thereof one must be silent.",
    author: "Ludwig Wittgenstein",
  },
  { text: "The map is not the territory.", author: "Alfred Korzybski" },
  { text: "Form is emptiness; emptiness is form.", author: "Heart Sūtra" },
  { text: "The world is my representation.", author: "Arthur Schopenhauer" },
  { text: "All the world’s a stage.", author: "William Shakespeare" },
];

export function pickComposerQuoteIndex(
  previousIndex: number | null = null,
  random: () => number = Math.random,
): number {
  if (COMPOSER_QUOTES.length <= 1) return 0;

  const hasPrevious =
    previousIndex !== null &&
    Number.isInteger(previousIndex) &&
    previousIndex >= 0 &&
    previousIndex < COMPOSER_QUOTES.length;
  const candidateCount = hasPrevious ? COMPOSER_QUOTES.length - 1 : COMPOSER_QUOTES.length;
  const candidate = Math.min(
    candidateCount - 1,
    Math.max(0, Math.floor(random() * candidateCount)),
  );

  return hasPrevious && candidate >= previousIndex ? candidate + 1 : candidate;
}

export function formatComposerQuote(quote: ComposerQuote): string {
  return `“${quote.text}” — ${quote.author}`;
}
