/**
 * Light / dark switch for the browser snapshot (0.0.19, owner call). In VS Code the map follows VS Code's theme; in
 * the browser it follows the computer's setting, and this button overrides it. The choice is kept in the browser's
 * own storage for these pages (nothing leaves the computer); without storage it lasts for the page.
 */

const KEY = "docmap-theme";
type Kind = "dark" | "light";

/** Applies a saved choice before the first drawing, so the page does not flash the other theme. */
export function applySavedTheme(): void {
  const saved = read();
  if (saved) apply(saved);
}

/** The theme the page shows now: the chosen one, else the computer's. */
export function pageTheme(): Kind {
  const root = document.documentElement.classList;
  if (root.contains("dark")) return "dark";
  if (root.contains("light")) return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** A button for the outline header that switches the page between light and dark. */
export function themeButton(onChange: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  const label = () => {
    const next = pageTheme() === "dark" ? "light" : "dark";
    button.textContent = next === "dark" ? "Dark" : "Light";
    button.title = `Switch to the ${next} theme`;
    button.setAttribute("aria-label", `Switch to the ${next} theme`);
  };
  label();
  button.addEventListener("click", () => {
    const next: Kind = pageTheme() === "dark" ? "light" : "dark";
    apply(next);
    write(next);
    label();
    onChange();
  });
  return button;
}

function apply(kind: Kind): void {
  document.documentElement.classList.toggle("dark", kind === "dark");
  document.documentElement.classList.toggle("light", kind === "light");
}

function read(): Kind | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : undefined;
  } catch {
    return undefined; // storage blocked (some browsers, for local files): the switch still works for this page
  }
}

function write(kind: Kind): void {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    // not kept: the page still switches
  }
}
