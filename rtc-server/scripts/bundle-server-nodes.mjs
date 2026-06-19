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

// Server-side we only use the nodes' import/exportJSON + getType — never their
// React rendering (decorate()/createDOM run only in the browser). The media
// nodes (image/embed) import heavy React UI components that transitively pull in
// @lexical/react and react-dom (whose ESM dev/prod switch uses top-level await,
// illegal in CJS output). Stub the UI component modules and any react-dom /
// @lexical/react import to an empty module so only the node logic is bundled.
const STUB_RE =
  /(ImageComponent|EmbedMediaComponent|EmbedMediaFloatingOptions|FloatingOptionsContainer|MediaViewer|EmbedViewer|NonViewMimeViewer|ImageEmbed|VideoEmbed|AudioEmbed|DefaultEmbed)(\.jsx?)?$/;
const stubUi = {
  name: "stub-server-irrelevant-ui",
  setup(b) {
    b.onResolve({ filter: /^react-dom($|\/)/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onResolve({ filter: /^@lexical\/react($|\/)/ }, (a) => ({ path: a.path, namespace: "stub" }));
    // @lexical/{selection,clipboard,html,offset} aren't installed for rtc-server
    // and their `.node.mjs` entries use top-level await (illegal in CJS). They're
    // only reached on browser DOM paths (paste conversion etc.), never in
    // import/exportJSON, so stub them to no-ops.
    b.onResolve({ filter: /^@lexical\/(selection|clipboard|html|offset)($|\/)/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onResolve({ filter: STUB_RE }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      // A do-nothing module: default + named access both yield no-op functions,
      // and DecoratorBlockNode is a harmless base class if ever referenced.
      contents:
        "const noop=()=>null;" +
        "class DecoratorBlockNode{};" +
        "module.exports=new Proxy({DecoratorBlockNode,default:noop}," +
        "{get:(t,p)=>p in t?t[p]:noop});",
      loader: "js",
    }));
  },
};

await build({
  plugins: [stubUi],
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: OUT,
  logLevel: "info",
  loader: {
    ".js": "jsx",
    ".svg": "dataurl",
    ".png": "dataurl",
    // Styles are irrelevant server-side (we only use nodes' import/exportJSON);
    // empty them so visual nodes (image/embed/youtube) that import styles bundle.
    ".css": "empty",
    ".scss": "empty",
  },
  jsx: "automatic",
  // lexical + the core @lexical node packages MUST stay external so server nodes
  // share the loading context's single lexical/yjs instances. NOT externalized:
  // react and @lexical/react — the media nodes (image/embed/youtube) import them
  // for decorate()/components, which never run server-side, and rtc-server has no
  // react / @lexical/react dependency to resolve at runtime, so they're bundled IN
  // (inert) instead.
  // Externalize lexical + the @lexical packages rtc-server actually has installed
  // (so registered node classes share the loading context's single instances).
  // The utility packages rtc-server lacks (@lexical/selection, clipboard, html,
  // offset — pure helpers that import the shared external `lexical`) are bundled
  // IN so the bundle loads without extra runtime deps.
  external: [
    "yjs",
    "lexical",
    "y-protocols",
    "y-protocols/*",
    "@lexical/code",
    "@lexical/hashtag",
    "@lexical/headless",
    "@lexical/link",
    "@lexical/list",
    "@lexical/overflow",
    "@lexical/rich-text",
    "@lexical/table",
    "@lexical/utils",
    "@lexical/yjs",
  ],
});

console.log(`bundled server nodes → ${OUT}`);
