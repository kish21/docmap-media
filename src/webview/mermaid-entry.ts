// The diagram library, bundled from source into its own file (dist/mermaid.js) so its dependencies are the ones this
// repo pins (package.json overrides), and loaded by the panel ONLY when a document has a ```mermaid block (0.0.8).
import mermaid from "mermaid";

(globalThis as { docmapMermaid?: typeof mermaid }).docmapMermaid = mermaid;
