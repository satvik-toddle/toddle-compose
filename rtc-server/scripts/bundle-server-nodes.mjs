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

// UI-only packages reachable ONLY through node decorate()/view components, which never run in
// headless extraction. Stubbing them to an inert proxy strips ~90% of the bundle without touching
// any data-path code. DENYLIST on purpose: a package we forget just stays bundled (safe/larger);
// we never risk stubbing a lib used in importJSON/exportJSON (lodash, moment, crypto-js, mime-db,
// micromark, he, axios are intentionally NOT here). Add a package here only if it is purely visual.
const STUB_PACKAGES = [
  "@toddle-edu/ds-icons",
  "@toddle-edu/ds-web",
  "@toddle-edu/ds-theme",
  "@toddle-edu/react-mentions",
  "antd",
  "@ant-design/icons",
  "@emoji-mart/data",
  "@emoji-mart/react",
  "react-select",
  "react-beautiful-dnd",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@react-aria/overlays",
  "@react-aria/interactions",
  "@react-aria/utils",
  "@react-stately/color",
  "@internationalized/date",
  "rc-picker",
  "rc-select",
  "rc-tree",
  "rc-table",
  "cropperjs",
  "gsap",
];

// Matches a bare `pkg` import or any deep `pkg/sub` path for every stubbed package.
const stubFilter = new RegExp(
  "^(" + STUB_PACKAGES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(/|$)"
);

// A self-referential Proxy: any property access, call, or `new` yields the same inert proxy (or
// null), so a stubbed module survives being imported/destructured/JSX-rendered without crashing at
// load. Node decorate() still runs during headless reconciliation and renders these stubs, so under
// NODE_ENV!=production React logs harmless "type is invalid" dev warnings; production is silent.
// `__esModule`/`then`/symbols return undefined so esbuild's default-import interop routes
// `import X from "pkg"` to the proxy itself (not an undefined `.default`) and the proxy is never
// mistaken for a thenable/iterable; every other access, call, or `new` yields the inert proxy.
const stubModule = `
const stub = new Proxy(function () {}, {
  get(_t, prop) {
    return prop === "then" || prop === "__esModule" || typeof prop === "symbol" ? undefined : stub;
  },
  apply() { return null; },
  construct() { return {}; },
});
module.exports = stub;
`;

const stubUiPlugin = {
  name: "stub-ui-packages",
  setup(build) {
    build.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: "stub-ui" }));
    build.onLoad({ filter: /.*/, namespace: "stub-ui" }, () => ({
      contents: stubModule,
      loader: "js",
    }));
  },
};

await build({
  plugins: [stubUiPlugin],
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: OUT,
  minify: true,
  legalComments: "none",
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
