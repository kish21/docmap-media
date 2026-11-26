/**
 * Keyboard in the outline (a tree, by the usual conventions): ↑/↓ move between VISIBLE entries, Home/End jump to
 * the first/last, ← folds (or moves to the parent), → unfolds (or moves to the first child). Enter activates the
 * focused link natively. "/" focuses the filter from anywhere; Esc in the filter clears it and leaves it. "s"
 * toggles skim mode; "1"–"3" fold to that level (as numbered in the toolbar), "0" unfolds everything; "j" / "k" move
 * the page to the next / previous heading.
 */
export interface OutlineKeys {
  toggle(id: string, open: boolean): void;
  /** "s": skim mode on/off. */
  skim(): void;
  /** "1"–"3": fold to that toolbar level; "0": unfold all. */
  foldTo(position: number): void;
  isOpen(id: string): boolean;
  clearFilter(): void;
  /** "j" / "k": the page to the next / previous heading. */
  jump(direction: 1 | -1): void;
}

export function handleKey(event: KeyboardEvent, keys: OutlineKeys): void {
  const target = event.target as HTMLElement | null;

  if (target instanceof HTMLInputElement && target.classList.contains("filter")) {
    if (event.key === "Escape") {
      // owner review 2026-11-17: Esc clears the filter AND hands the keys back to reading (j / k, s, 1–3)
      event.preventDefault();
      if (target.value !== "") keys.clearFilter();
      target.blur();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      visibleLinks()[0]?.focus();
    }
    return;
  }
  // one press, one action: not on key repeat (holding "s" would flicker), not while an IME is composing
  const plain =
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing &&
    !(target instanceof HTMLInputElement);
  if (plain && event.key === "s") {
    event.preventDefault();
    keys.skim();
    return;
  }
  if (plain && (event.key === "j" || event.key === "k")) {
    event.preventDefault();
    keys.jump(event.key === "j" ? 1 : -1);
    return;
  }
  if (plain && /^[0-3]$/.test(event.key)) {
    event.preventDefault();
    keys.foldTo(Number(event.key));
    return;
  }
  if (event.key === "/" && !(target instanceof HTMLInputElement)) {
    const filter = document.querySelector<HTMLInputElement>("input.filter");
    if (filter && filter.offsetParent !== null) {
      event.preventDefault();
      filter.focus();
      filter.select();
    }
    return;
  }

  if (!(target instanceof HTMLAnchorElement) || !target.classList.contains("outline-link")) return;
  const links = visibleLinks();
  const index = links.indexOf(target);
  const row = target.closest<HTMLElement>(".outline-row");
  const id = row?.dataset.id ?? "";
  const hasChildren = row?.querySelector(".twisty") !== null;
  let next: HTMLAnchorElement | undefined;

  switch (event.key) {
    case "ArrowDown":
      next = links[index + 1];
      break;
    case "ArrowUp":
      next = links[index - 1];
      break;
    case "Home":
      next = links[0];
      break;
    case "End":
      next = links.at(-1);
      break;
    case "ArrowLeft":
      if (hasChildren && keys.isOpen(id) && !document.querySelector(".outline.filtering")) {
        keys.toggle(id, false);
      } else {
        next = parentLink(row);
      }
      break;
    case "ArrowRight":
      if (hasChildren && !keys.isOpen(id)) keys.toggle(id, true);
      else if (hasChildren) next = links[index + 1];
      break;
    default:
      return;
  }
  event.preventDefault();
  next?.focus();
}

function visibleLinks(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".outline-link")].filter(
    (a) => a.offsetParent !== null,
  );
}

function parentLink(row: HTMLElement | null): HTMLAnchorElement | undefined {
  const parentItem = row?.parentElement?.parentElement?.closest("li");
  return parentItem?.querySelector<HTMLAnchorElement>(":scope > .outline-row .outline-link") ?? undefined;
}
