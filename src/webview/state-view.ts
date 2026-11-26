import type { EdgeState } from "../core/protocol/messages";

const STATE_TEXT: Record<EdgeState, string> = {
  "no-headings": "This file has no headings.",
  "too-large": "This file is very large.",
  error: "This file couldn't be read.",
  closed: "This file is no longer there.",
};

/** The message shown instead of a map — never a blank panel (DESIGN.md §5). */
export function renderState(
  state: EdgeState,
  fileName: string,
  detail: string | undefined,
  bytes: number | undefined,
  onRenderAnyway: () => void,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "state";
  box.setAttribute("role", "status");
  const title = document.createElement("h1");
  title.className = "state-title";
  title.textContent = STATE_TEXT[state];
  const text = document.createElement("p");
  text.textContent =
    state === "too-large" && bytes !== undefined
      ? `${fileName} is ${(bytes / 1024 / 1024).toFixed(1)} MB. Rendering it may be slow.`
      : (detail ?? fileName);
  box.append(title, text);
  if (state === "too-large") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "state-action";
    button.textContent = "Render anyway";
    button.addEventListener("click", onRenderAnyway);
    box.append(button);
  }
  return box;
}
