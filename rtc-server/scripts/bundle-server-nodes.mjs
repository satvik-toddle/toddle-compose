import { build } from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY =
  "/Users/apple/Documents/doc-editor/packages/doc-editor/src/nodes/AllNodesServer.js";
const OUT = path.resolve(__dirname, "../vendor/server-nodes.cjs");

await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: OUT,
  logLevel: "info",
  loader: { ".js": "jsx", ".svg": "dataurl", ".png": "dataurl", ".css": "empty" },
  jsx: "automatic",
  external: [
    "yjs",
    "lexical",
    "@lexical/*",
    "y-protocols",
    "y-protocols/*",
    "react",
    "react-dom",
    "react/jsx-runtime",
  ],
});

console.log(`bundled server nodes → ${OUT}`);
