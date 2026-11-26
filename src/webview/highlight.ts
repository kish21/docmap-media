/**
 * 3.0 syntax colours for code blocks — small and dependency-free: strings, comments, numbers, keywords and function
 * names for the common languages. Builds spans from text nodes only (the code is never parsed as HTML). Unknown or
 * very long blocks stay plain.
 */
const KEYWORDS: Record<string, string> = {
  js: "async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield interface type enum implements private public protected readonly as",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
  rs: "as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  java: "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while var",
  sh: "if then else elif fi for while do done case esac in function return export local echo exit set unset cd source",
  sql: "select from where join left right inner outer on group by order having insert into values update set delete create table alter drop index and or not null as distinct limit offset union primary key references",
  yaml: "true false null yes no on off",
};
const ALIAS: Record<string, string> = {
  javascript: "js",
  ts: "js",
  typescript: "js",
  tsx: "js",
  jsx: "js",
  mjs: "js",
  json: "js",
  jsonc: "js",
  python: "py",
  golang: "go",
  rust: "rs",
  kotlin: "java",
  csharp: "java",
  cs: "java",
  c: "java",
  cpp: "java",
  swift: "java",
  scala: "java",
  bash: "sh",
  shell: "sh",
  zsh: "sh",
  console: "sh",
  powershell: "sh",
  ps1: "sh",
  yml: "yaml",
  toml: "yaml",
  ini: "yaml",
};
const COMMENT: Record<string, RegExp> = {
  js: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
  java: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
  go: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
  rs: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
  py: /#[^\n]*/y,
  sh: /#[^\n]*/y,
  yaml: /#[^\n]*/y,
  sql: /--[^\n]*/y,
};
const STRING = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y;
const NUMBER = /\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-f]+\b/iy;
const WORD = /[A-Za-z_$][\w$]*/y;
const MAX_CHARS = 60_000;

export function highlightCode(code: HTMLElement): void {
  const lang = /language-([\w+#-]+)/.exec(code.className)?.[1]?.toLowerCase() ?? "";
  if (lang === "mermaid") return;
  const family = ALIAS[lang] ?? lang;
  const words = KEYWORDS[family];
  const text = code.textContent ?? "";
  if (!words || text.length > MAX_CHARS || code.children.length > 0) return;
  const keywords = new Set(words.split(" "));
  const comment = COMMENT[family];
  const out = document.createDocumentFragment();
  let plain = "";
  const flush = () => {
    if (plain) out.append(plain);
    plain = "";
  };
  const span = (cls: string, s: string) => {
    flush();
    const e = document.createElement("span");
    e.className = cls;
    e.textContent = s;
    out.append(e);
  };
  for (let i = 0; i < text.length; ) {
    const at = (re: RegExp) => {
      re.lastIndex = i;
      return re.exec(text)?.[0];
    };
    const c = comment && at(comment);
    if (c) {
      span("tk-comment", c);
      i += c.length;
      continue;
    }
    const s = at(STRING);
    if (s) {
      span("tk-string", s);
      i += s.length;
      continue;
    }
    const prev = text[i - 1] ?? "";
    if (!/[\w$]/.test(prev)) {
      const n = at(NUMBER);
      if (n) {
        span("tk-number", n);
        i += n.length;
        continue;
      }
      const w = at(WORD);
      if (w) {
        if (keywords.has(w)) span("tk-keyword", w);
        else if (text[i + w.length] === "(") span("tk-function", w);
        else plain += w;
        i += w.length;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  code.replaceChildren(out);
}
