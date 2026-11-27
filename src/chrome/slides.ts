/**
 * 1-click Slides Mode for Chrome `.md` viewer:
 * Groups top-level prose blocks separated by `<hr>` (`---`) into keyboard-navigable slides (← / → / Esc).
 */

export interface SlidesController {
  readonly count: number;
  readonly button: HTMLButtonElement;
  readonly exit: () => void;
  readonly handleKey: (event: KeyboardEvent) => boolean;
}

const SKIP_CLASSES = ["dm-chrome-bar", "dm-chrome-drawer", "dm-standing", "dm-fm", "dm-slides-bar"];

function collectSlides(prose: HTMLElement): HTMLElement[][] {
  const groups: HTMLElement[][] = [[]];
  for (const child of Array.from(prose.children) as HTMLElement[]) {
    if (SKIP_CLASSES.some((c) => child.classList.contains(c))) continue;
    if (child.tagName === "HR") {
      groups.push([]);
    } else {
      groups[groups.length - 1]?.push(child);
    }
  }
  return groups.filter((g) => g.length > 0);
}

export function createSlidesController(prose: HTMLElement): SlidesController | undefined {
  const groups = collectSlides(prose);
  if (groups.length < 2) return undefined;

  let active = false;
  let index = 0;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dm-chrome-pill";
  button.textContent = `Slides (${groups.length})`;
  button.title = "Present this document as slides separated by --- (← / → to move, Esc to exit)";

  const nav = document.createElement("div");
  nav.className = "dm-slides-bar";
  nav.hidden = true;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "dm-chrome-pill";
  prevBtn.textContent = "← Prev";

  const counter = document.createElement("span");
  counter.className = "dm-slides-counter";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "dm-chrome-pill";
  nextBtn.textContent = "Next →";

  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "dm-chrome-pill";
  exitBtn.textContent = "Exit slides";

  nav.append(prevBtn, counter, nextBtn, exitBtn);
  prose.append(nav);

  const applySlide = () => {
    document.body.classList.toggle("dm-slides-on", active);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    nav.hidden = !active;

    for (const child of Array.from(prose.children) as HTMLElement[]) {
      if (child === nav) continue;
      if (!active) {
        child.removeAttribute("data-slide-hidden");
      } else {
        const visible = groups[index]?.includes(child) ?? false;
        child.toggleAttribute("data-slide-hidden", !visible);
      }
    }

    if (active) {
      counter.textContent = `Slide ${index + 1} of ${groups.length}`;
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index >= groups.length - 1;
      prose.parentElement?.scrollTo({ top: 0 });
    }
  };

  const step = (delta: number) => {
    if (!active) return;
    index = Math.max(0, Math.min(groups.length - 1, index + delta));
    applySlide();
  };

  const exit = () => {
    if (!active) return;
    active = false;
    applySlide();
  };

  button.addEventListener("click", () => {
    active = !active;
    if (active) index = 0;
    applySlide();
  });
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  exitBtn.addEventListener("click", exit);

  return {
    count: groups.length,
    button,
    exit,
    handleKey(event: KeyboardEvent): boolean {
      if (!active) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        exit();
        return true;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        step(1);
        return true;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        step(-1);
        return true;
      }
      return false;
    },
  };
}
