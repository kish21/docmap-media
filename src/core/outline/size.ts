import { READING_WORDS_PER_MINUTE } from "../config/config";

/**
 * A section's reading time for the outline, short enough for a narrow pane: "<1 min", "4 min", "1 h 5 min", "3 h"
 * (0.0.20, owner call: minutes read at a glance; "876w" did not). The word count is in the tooltip.
 */
export function formatReadingTime(words: number): string {
  const minutes = Math.round(words / READING_WORDS_PER_MINUTE);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The same size in full, for a tooltip: "1,234 words · about 6 min". Under a minute reads "under 1 min". */
export function describeWords(words: number): string {
  const minutes = Math.round(words / READING_WORDS_PER_MINUTE);
  const time = minutes < 1 ? "under 1 min" : `about ${minutes} min`;
  return `${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"} · ${time}`;
}
