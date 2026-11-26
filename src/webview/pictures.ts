/**
 * `<picture>` light/dark versions (0.0.12). A `<source media="(prefers-color-scheme: dark)">` follows the COMPUTER's
 * setting, but the map should follow VS Code's theme (the 0.0.10 lesson): in VS Code, each such source is switched
 * on or off by the theme kind VS Code marks on the body, and again when the theme changes. The browser snapshot has
 * no VS Code theme: there the system setting decides, as the document intended.
 */

let watching = false;

export function matchPictureTheme(doc: HTMLElement): void {
  apply(doc);
  if (watching) return;
  watching = true;
  const observer = new MutationObserver(() => {
    const current = document.querySelector<HTMLElement>(".document");
    if (current) apply(current);
  });
  // VS Code marks its theme on the body; the snapshot's light / dark switch marks the root element
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

function apply(doc: HTMLElement): void {
  const kind = vscodeThemeKind();
  if (!kind) return;
  for (const source of doc.querySelectorAll<HTMLSourceElement>("picture > source[data-scheme]")) {
    source.media = source.dataset.scheme === kind ? "all" : "not all";
  }
}

/**
 * "dark" or "light" from VS Code's body classes, or from the snapshot's light / dark switch (a class on the root);
 * undefined when neither says — the snapshot on the computer's setting, which the media query already follows.
 */
function vscodeThemeKind(): "dark" | "light" | undefined {
  const root = document.documentElement.classList;
  if (root.contains("dark")) return "dark";
  if (root.contains("light")) return "light";
  const body = document.body.classList;
  if (body.contains("vscode-high-contrast-light") || body.contains("vscode-light")) return "light";
  if (body.contains("vscode-dark") || body.contains("vscode-high-contrast")) return "dark";
  return undefined;
}
