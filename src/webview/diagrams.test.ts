import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawDiagrams } from "./diagrams";

interface FakePre {
  tagName: string;
  isConnected: boolean;
  dataset: Record<string, string>;
  title: string;
  innerHTML: string;
  attributes: Map<string, string>;
  classes: Set<string>;
  classList: {
    add: (...names: string[]) => void;
    contains: (name: string) => boolean;
  };
  setAttribute: (name: string, value: string) => void;
  previousElementSibling: null;
  before: () => void;
}

interface FakeCode {
  parentElement: FakePre;
  textContent: string;
}

function makeBlock(source: string): { pre: FakePre; code: FakeCode } {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const pre: FakePre = {
    tagName: "PRE",
    isConnected: true,
    dataset: {},
    title: "",
    innerHTML: "",
    attributes,
    classes,
    classList: {
      add: (...names: string[]) => {
        for (const n of names) classes.add(n);
      },
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    previousElementSibling: null,
    before: () => {},
  };
  return { pre, code: { parentElement: pre, textContent: source } };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.observed.add(el);
  }

  unobserve(el: Element): void {
    this.observed.delete(el);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }

  trigger(el: Element, isIntersecting: boolean): void {
    this.callback(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("drawDiagrams lazy rendering (#56)", () => {
  const renderSpy = vi.fn(async (_id: string, text: string) => ({ svg: `<svg>${text}</svg>` }));
  const initSpy = vi.fn();
  const originalDoc = globalThis.document;
  const originalIO = globalThis.IntersectionObserver;
  const originalWindow = globalThis.window;
  const originalElement = globalThis.Element;
  const originalMatchMedia = globalThis.matchMedia;
  const originalMermaid = (globalThis as { docmapMermaid?: unknown }).docmapMermaid;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    renderSpy.mockClear();
    initSpy.mockClear();
    (globalThis as { Element?: unknown }).Element = class {};
    (globalThis as { docmapMermaid?: unknown }).docmapMermaid = {
      initialize: initSpy,
      render: renderSpy,
    };
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
    const listeners = new Map<string, Set<EventListener>>();
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent: (ev: { type: string }) => {
        for (const fn of listeners.get(ev.type) ?? []) fn(ev as unknown as Event);
        return true;
      },
    };
    (globalThis as { document?: unknown }).document = {
      currentScript: null,
      documentElement: {
        classList: { contains: () => false },
        hasAttribute: () => false,
      },
      body: {
        dataset: { diagrams: "mermaid.js" },
        classList: { contains: () => false },
      },
      head: { append: () => {} },
      createElement: () => ({}),
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDoc;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIO;
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { Element?: unknown }).Element = originalElement;
    (globalThis as { matchMedia?: unknown }).matchMedia = originalMatchMedia;
    (globalThis as { docmapMermaid?: unknown }).docmapMermaid = originalMermaid;
  });

  it("defers offscreen Mermaid blocks until they intersect near the viewport", async () => {
    const top = makeBlock("graph TD\n  Top1 --> Top2");
    const bottom = makeBlock("graph TD\n  Bot1 --> Bot2");
    const doc = {
      querySelectorAll: () => [top.code, bottom.code],
    } as unknown as HTMLElement;

    drawDiagrams(doc);
    await flushMicrotasks();

    // Neither block has entered the viewport yet, so mermaid.render must NOT have run eagerly.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer?.options?.root).toBe(doc);
    expect(observer?.observed.size).toBe(2);
    expect(renderSpy).not.toHaveBeenCalled();

    // First diagram enters the viewport: only it renders.
    observer?.trigger(top.pre as unknown as Element, true);
    await flushMicrotasks();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(top.pre.classList.contains("mermaid-diagram")).toBe(true);
    expect(bottom.pre.classList.contains("mermaid-diagram")).toBe(false);

    // Second diagram enters later: now it renders too.
    observer?.trigger(bottom.pre as unknown as Element, true);
    await flushMicrotasks();
    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(bottom.pre.classList.contains("mermaid-diagram")).toBe(true);
  });

  it("disconnects the previous observer on re-render", async () => {
    const a = makeBlock("graph TD\n  R1 --> R2");
    const b = makeBlock("graph TD\n  R3 --> R4");
    const doc1 = { querySelectorAll: () => [a.code] } as unknown as HTMLElement;
    const doc2 = { querySelectorAll: () => [b.code] } as unknown as HTMLElement;

    drawDiagrams(doc1);
    drawDiagrams(doc2);
    await flushMicrotasks();

    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    expect(FakeIntersectionObserver.instances[0]?.disconnected).toBe(true);
    expect(FakeIntersectionObserver.instances[1]?.disconnected).toBe(false);
  });

  it("renders all diagrams eagerly when data-autoprint is set (PDF export)", async () => {
    (
      globalThis.document.documentElement as unknown as { hasAttribute: (n: string) => boolean }
    ).hasAttribute = (n: string) => n === "data-autoprint";
    const block = makeBlock("graph TD\n  Print1 --> Print2");
    const doc = { querySelectorAll: () => [block.code] } as unknown as HTMLElement;

    drawDiagrams(doc);
    await flushMicrotasks();

    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(block.pre.classList.contains("mermaid-diagram")).toBe(true);
  });

  it("uses dark Mermaid theme for dark reading themes and lets VS Code high-contrast win (ADR-0003)", async () => {
    (
      globalThis.document.documentElement as unknown as { hasAttribute: (n: string) => boolean }
    ).hasAttribute = (n: string) => n === "data-autoprint";
    const bodyClasses = new Set<string>(["vscode-light"]);
    let readingTheme = "github-dark";
    (globalThis.document as unknown as { body: unknown }).body = {
      dataset: { diagrams: "mermaid.js" },
      classList: { contains: (c: string) => bodyClasses.has(c) },
      getAttribute: (n: string) => (n === "data-reading-theme" ? readingTheme : null),
    };

    const block1 = makeBlock("graph TD\n  DarkTheme1 --> DarkTheme2");
    drawDiagrams({ querySelectorAll: () => [block1.code] } as unknown as HTMLElement);
    await flushMicrotasks();
    expect(initSpy).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });

    // High-contrast light must override dark reading theme
    bodyClasses.add("vscode-high-contrast-light");
    const block2 = makeBlock("graph TD\n  HCLight1 --> HCLight2");
    drawDiagrams({ querySelectorAll: () => [block2.code] } as unknown as HTMLElement);
    await flushMicrotasks();
    expect(initSpy).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
    });

    // Light reading theme overrides vscode-dark when not high-contrast
    bodyClasses.clear();
    bodyClasses.add("vscode-dark");
    readingTheme = "solarized-light";
    const block3 = makeBlock("graph TD\n  SolLight1 --> SolLight2");
    drawDiagrams({ querySelectorAll: () => [block3.code] } as unknown as HTMLElement);
    await flushMicrotasks();
    expect(initSpy).toHaveBeenLastCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
    });
  });
});
