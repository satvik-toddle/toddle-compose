import { sanitizeConstrainedHtml } from "./coda-html-sanitizer";

describe("sanitizeConstrainedHtml", () => {
  it("drops diff `removed` subtrees and unwraps `added` (C7)", () => {
    const out = sanitizeConstrainedHtml(
      '<p><span class="ds-de-content-removed">gone</span>' +
        '<span class="ds-de-content-added">kept</span></p>'
    );
    expect(out).not.toContain("gone");
    expect(out).toContain("kept");
    expect(out).not.toContain("ds-de-content-added");
    expect(out).toBe("<p>kept</p>");
  });

  it("unwraps comment / inline-comment <mark> keeping children (C8)", () => {
    const out = sanitizeConstrainedHtml(
      '<p><mark data-ids="c1,c2">hello</mark> ' +
        '<mark data-internal-comment-id="x">world</mark></p>'
    );
    expect(out).not.toContain("<mark");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("recovers the smart-placeholder label from data attributes (C5, partial)", () => {
    const out = sanitizeConstrainedHtml(
      '<p><span data-node-type="smart-placeholder" ' +
        'data-placeholder="{{name}}" data-placeholder-name="Student name"></span></p>'
    );
    expect(out).toBe("<p>Student name</p>");
  });

  it("flattens <details> collapsibles to a heading + content", () => {
    const out = sanitizeConstrainedHtml(
      '<details open="true"><summary><svg></svg>Section title</summary>' +
        '<div data-lexical-collapsible-content="true"><p>body</p></div></details>'
    );
    expect(out).toContain("<h3>Section title</h3>");
    expect(out).toContain("<p>body</p>");
    expect(out).not.toContain("<details");
    expect(out).not.toContain("<summary");
    expect(out).not.toContain("<svg");
  });

  it("strips the grid so layout columns stack (no display:grid, no layout attrs)", () => {
    const out = sanitizeConstrainedHtml(
      '<div data-lexical-layout-container="true" data-lexical-layout-template="6px 6px" ' +
        'style="display:grid;grid-template-columns:repeat(12,1fr)">' +
        '<div data-lexical-layout-item="true" style="grid-column:1 / 7"><p>left</p></div>' +
        '<div data-lexical-layout-item="true" style="grid-column:7 / 13"><p>right</p></div>' +
        "</div>"
    );
    expect(out).not.toContain("grid");
    expect(out).not.toContain("data-lexical-layout");
    expect(out).toContain("<p>left</p>");
    expect(out).toContain("<p>right</p>");
  });

  it("turns a YouTube iframe into a watch-URL link", () => {
    const out = sanitizeConstrainedHtml(
      '<iframe data-lexical-youtube="abc123" src="https://www.youtube-nocookie.com/embed/abc123"></iframe>'
    );
    expect(out).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(out).not.toContain("<iframe");
  });

  it("turns a generic https iframe into a link and drops non-http iframes", () => {
    expect(
      sanitizeConstrainedHtml('<iframe src="https://example.com/x"></iframe>')
    ).toContain('<a href="https://example.com/x">https://example.com/x</a>');
    expect(
      sanitizeConstrainedHtml('<iframe src="about:blank"></iframe>')
    ).toBe("");
  });

  it("keeps file-embed anchors as clean labeled download links (C3)", () => {
    const out = sanitizeConstrainedHtml(
      '<a data-embed="embed-media" href="https://cdn.example.com/f.pdf" ' +
        'data-name="report.pdf" data-type="application/pdf" download="report.pdf">report.pdf</a>'
    );
    expect(out).toContain('href="https://cdn.example.com/f.pdf"');
    expect(out).toContain("report.pdf");
    expect(out).not.toContain("data-embed");
    expect(out).not.toContain("download");
  });

  it("keeps https images and drops empty/undefined/non-public srcs (C4)", () => {
    expect(
      sanitizeConstrainedHtml('<img src="https://cdn.example.com/a.png" alt="a">')
    ).toContain('src="https://cdn.example.com/a.png"');
    expect(sanitizeConstrainedHtml('<img src="undefined">')).toBe("");
    expect(sanitizeConstrainedHtml("<img>")).toBe("");
    expect(
      sanitizeConstrainedHtml('<img src="http://cdn.example.com/a.png">')
    ).toBe("");
  });

  it("removes an anchor left empty after its only image is dropped", () => {
    const out = sanitizeConstrainedHtml(
      '<a href="https://link.example.com"><img src="blob:local"></a>'
    );
    expect(out).toBe("");
  });

  it('drops width="inherit" but keeps numeric width', () => {
    expect(
      sanitizeConstrainedHtml('<img src="https://x/a.png" width="inherit">')
    ).not.toContain("inherit");
    expect(
      sanitizeConstrainedHtml('<img src="https://x/a.png" width="200">')
    ).toContain('width="200"');
  });

  it("strips <figure>/<figcaption> keeping figure contents", () => {
    const out = sanitizeConstrainedHtml(
      '<figure><img src="https://x/a.png"><figcaption>cap</figcaption></figure>'
    );
    expect(out).not.toContain("<figure");
    expect(out).not.toContain("figcaption");
    expect(out).not.toContain("cap");
    expect(out).toContain('src="https://x/a.png"');
  });

  it("reduces tables to a clean <table><tbody>: th->td, no colspan/rowspan/thead", () => {
    const out = sanitizeConstrainedHtml(
      "<table><thead><tr><th>H1</th><th>H2</th></tr></thead>" +
        '<tbody><tr><td colspan="2" style="width:9px">merged</td></tr>' +
        "<tr><td>a</td><td>b</td></tr></tbody></table>"
    );
    expect(out).toContain("<tbody>");
    expect(out).not.toContain("<thead");
    expect(out).not.toContain("<th>");
    expect(out).not.toContain("colspan");
    expect(out).not.toContain("style");
    expect(out).toContain("H1");
    expect(out).toContain("merged");
    expect(out).toContain("<td>a</td>");
  });

  it("drops leftover empty inline spans (comment-icon / chip decorators)", () => {
    const out = sanitizeConstrainedHtml(
      '<p>text<span style="display:inline" contenteditable="false"></span></p>'
    );
    expect(out).toBe("<p>text</p>");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeConstrainedHtml("")).toBe("");
  });

  const TWO_ROW_TABLE =
    "<table><tbody><tr><td>a</td><td>b</td></tr>" +
    "<tr><td>c</td><td>d</td></tr></tbody></table>";

  it("emits an empty <thead> of th cells carrying exact widths, tbody unchanged", () => {
    const out = sanitizeConstrainedHtml(TWO_ROW_TABLE, [[400, 100]]);
    expect(out).toContain(
      '<thead><tr><th style="width: 400px"></th><th style="width: 100px"></th></tr></thead>'
    );
    expect(out).toContain("<tbody><tr><td>a</td><td>b</td></tr>");
    expect(out).toContain("<tr><td>c</td><td>d</td></tr></tbody>");
  });

  it("rounds fractional widths to integers", () => {
    const out = sanitizeConstrainedHtml(TWO_ROW_TABLE, [[399.6, 100.2]]);
    expect(out).toContain('<th style="width: 400px"></th>');
    expect(out).toContain('<th style="width: 100px"></th>');
  });

  it("is byte-identical to legacy output with no widths, undefined entry, or empty array", () => {
    const legacy = sanitizeConstrainedHtml(TWO_ROW_TABLE);
    expect(legacy).not.toContain("<thead");
    expect(sanitizeConstrainedHtml(TWO_ROW_TABLE, undefined)).toBe(legacy);
    expect(sanitizeConstrainedHtml(TWO_ROW_TABLE, [undefined])).toBe(legacy);
    expect(sanitizeConstrainedHtml(TWO_ROW_TABLE, [[]])).toBe(legacy);
  });

  it("emits a bare th (no style) for columns beyond a short widths array", () => {
    const out = sanitizeConstrainedHtml(TWO_ROW_TABLE, [[250]]);
    expect(out).toContain(
      '<thead><tr><th style="width: 250px"></th><th></th></tr></thead>'
    );
  });

  it("caps th count at the column count when widths array is longer", () => {
    const out = sanitizeConstrainedHtml(TWO_ROW_TABLE, [[250, 300, 350, 400]]);
    expect(out).toContain(
      '<thead><tr><th style="width: 250px"></th><th style="width: 300px"></th></tr></thead>'
    );
    expect(out).not.toContain("350px");
    expect(out).not.toContain("400px");
  });

  it("gives a thead only to the table that has widths ([undefined, [250]])", () => {
    const two =
      "<table><tbody><tr><td>x</td></tr></tbody></table>" +
      "<table><tbody><tr><td>y</td></tr></tbody></table>";
    const out = sanitizeConstrainedHtml(two, [undefined, [250]]);
    expect(out).toBe(
      "<table><tbody><tr><td>x</td></tr></tbody></table>" +
        '<table><thead><tr><th style="width: 250px"></th></tr></thead>' +
        "<tbody><tr><td>y</td></tr></tbody></table>"
    );
  });

  it("rewrites the `background` shorthand highlight to `background-color` (Coda honors only the longhand)", () => {
    const out = sanitizeConstrainedHtml(
      '<p><span style="white-space: pre-wrap; background: rgb(255, 224, 214);">hi</span></p>'
    );
    expect(out).toContain("background-color: rgb(255, 224, 214)");
    expect(out).not.toMatch(/[^-]background:\s/);
  });

  it("leaves font `color` and existing `background-color` untouched", () => {
    const out = sanitizeConstrainedHtml(
      '<p><span style="color: rgb(255, 0, 0); background-color: rgb(0, 255, 0);">x</span></p>'
    );
    expect(out).toContain("color: rgb(255, 0, 0)");
    expect(out).toContain("background-color: rgb(0, 255, 0)");
  });
});
