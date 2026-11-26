# Contributing

Contributions, bug reports, and security audits are welcome for **All-in-One Markdown Viewer (`markdown-docmap`)**.

## Develop

```bash
npm ci                 # installs exact locked dependencies
npm run build          # bundles dist/extension.js, dist/webview.js, dist/mcp.js, and dist/mermaid.js
npm run check          # typecheck + lint + unit tests + build
npm run package        # builds markdown-as-web-page-<version>.vsix
```

Run it locally: open this folder in VS Code and press **F5** (Extension Development Host), or install the
built `.vsix` with *Extensions → … → Install from VSIX*.

## Architecture Rules

- `src/core/` is pure TypeScript: it never imports `vscode` and never touches the DOM.
- Host ↔ webview messages use the typed union in `src/core/protocol/messages.ts`.
- `markdown-it` runs with `html: false` under a strict nonce-based CSP (see [SECURITY.md](SECURITY.md)).
- Webview colors use `--vscode-*` theme variables only (no hard-coded hex colors).
- Zero telemetry, zero accounts, and zero external network calls.
