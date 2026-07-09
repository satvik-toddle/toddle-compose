import { build } from "esbuild";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");

// Server-nodes entry resolved from RTC_SERVER_NODES_ENTRY env var, else package.json docEditor.serverNodesEntry; relative paths resolve against the rtc-server dir (see setup.md).
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const configured =
  process.env.RTC_SERVER_NODES_ENTRY ?? pkg.docEditor?.serverNodesEntry;
if (!configured) {
  throw new Error(
    "No doc-editor server-nodes entry configured. Set RTC_SERVER_NODES_ENTRY or " +
      '"docEditor.serverNodesEntry" in rtc-server/package.json (see rtc-server/setup.md).'
  );
}
const ENTRY = path.isAbsolute(configured)
  ? configured
  : path.resolve(pkgDir, configured);
const OUT = path.resolve(__dirname, "../vendor/server-nodes.cjs");

await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: OUT,
  logLevel: "info",
  loader: { ".js": "jsx", ".svg": "dataurl", ".png": "dataurl", ".css": "empty", ".scss": "empty" },
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
