import { sanitizeCodaImportHtml } from "./coda-import-sanitizer";

describe("sanitizeCodaImportHtml", () => {
  it("strips data-coda-* attributes, classes and ids, keeping content and color spans", () => {
    const { html } = sanitizeCodaImportHtml(
      '<p data-coda-node-id="n1" class="kr-line" id="p1">Hello ' +
        '<span data-coda-mark="b" class="kr-bold" style="color: rgb(0, 0, 0)">world</span></p>'
    );
    expect(html).not.toContain("data-coda");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("id=");
    expect(html).toContain("Hello");
    expect(html).toContain('<span style="color: rgb(0, 0, 0)">world</span>');
  });

  it("unwraps the html/head/body export chrome and drops head content", () => {
    const { html } = sanitizeCodaImportHtml(
      "<!doctype html><html><head><title>Page</title>" +
        '<meta charset="utf-8"><style>.x{}</style></head>' +
        "<body><p>Body</p></body></html>"
    );
    expect(html).toBe("<p>Body</p>");
  });

  it("carries Coda grid table column widths into a <colgroup> and drops the auto caption", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      '<div class="kr-grid" data-coda-grid="1"><table>' +
        "<caption>Table 1</caption>" +
        '<colgroup><col style="width: 320px"><col style="width: 120px"></colgroup>' +
        '<thead><tr><th data-coda-col="a">Name</th><th>Age</th></tr></thead>' +
        "<tbody><tr><td>Ann</td><td>30</td></tr></tbody></table></div>"
    );
    expect(html).toContain("<colgroup>");
    expect(html).toContain('<col style="width: 320px">');
    expect(html).toContain('<col style="width: 120px">');
    expect(html).toContain("<thead><tr><th>Name</th><th>Age</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>Ann</td><td>30</td></tr></tbody>");
    expect(html).not.toContain("Table 1");
    expect(html).not.toContain("data-coda");
    expect(html).not.toContain("kr-grid");
    // An auto "Table N" caption is expected chrome, so it is not a reported loss.
    expect(losses).toEqual([]);
  });

  it("reads column widths off the first row when there is no colgroup", () => {
    const { html } = sanitizeCodaImportHtml(
      "<table><tbody>" +
        '<tr><td style="width: 200px">a</td><td style="width: 90px">b</td></tr>' +
        "<tr><td>c</td><td>d</td></tr></tbody></table>"
    );
    expect(html).toContain(
      '<colgroup><col style="width: 200px"><col style="width: 90px"></colgroup>'
    );
  });

  it("flattens merged cells and reports the loss", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      "<table><tbody>" +
        '<tr><td colspan="2">merged</td></tr>' +
        "<tr><td>a</td><td>b</td></tr></tbody></table>"
    );
    expect(html).not.toContain("colspan");
    expect(html).toContain("<td>merged</td>");
    expect(losses).toContain("merged table cells flattened in 1 table");
  });

  it("reports a meaningful (non-auto) caption as a loss", () => {
    const { losses } = sanitizeCodaImportHtml(
      "<table><caption>Quarterly results</caption>" +
        "<tbody><tr><td>a</td></tr></tbody></table>"
    );
    expect(losses).toContain("1 table caption removed");
  });

  it("converts a Coda callout to a <blockquote> and records the loss", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      '<div class="kr-callout" data-coda-callout="info"><p>Heads up</p></div>'
    );
    expect(html).toBe("<blockquote><p>Heads up</p></blockquote>");
    expect(losses).toContain("1 callout converted to blockquote");
  });

  it("flattens a <details>/<summary> collapsible to a heading followed by its body", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      "<details open><summary>Section title</summary>" +
        "<p>Body paragraph</p></details>"
    );
    expect(html).toBe("<h3>Section title</h3><p>Body paragraph</p>");
    expect(losses).toContain(
      "1 collapsible section flattened to a heading + body"
    );
  });

  it("flattens a Coda class-based collapsible using its labelled summary child", () => {
    const { html } = sanitizeCodaImportHtml(
      '<div class="kr-collapsible">' +
        '<div class="kr-collapsible-summary">Overview</div>' +
        '<div class="kr-collapsible-body"><p>Detail</p></div></div>'
    );
    expect(html).toBe("<h3>Overview</h3><p>Detail</p>");
  });

  it("turns a Coda embed/iframe into a link and records the loss", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      '<div class="kr-embed"><iframe src="https://www.youtube.com/embed/abc" ' +
        'title="Demo video"></iframe></div>'
    );
    expect(html).toBe('<a href="https://www.youtube.com/embed/abc">Demo video</a>');
    expect(html).not.toContain("<iframe");
    expect(losses).toContain("1 embed converted to a link");
  });

  it("drops an embed that has no linkable http(s) URL", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      '<iframe src="about:blank"></iframe>'
    );
    expect(html).toBe("");
    expect(losses).toContain("1 embed dropped (no linkable URL)");
  });

  it("keeps an https image and drops a non-https image, recording the loss", () => {
    const kept = sanitizeCodaImportHtml('<img src="https://cdn.example.com/a.png" alt="A">');
    expect(kept.html).toBe('<img src="https://cdn.example.com/a.png" alt="A">');
    expect(kept.losses).toEqual([]);

    const dropped = sanitizeCodaImportHtml('<p><img src="http://cdn.example.com/b.png"></p>');
    expect(dropped.html).toBe("<p></p>");
    expect(dropped.losses).toContain("1 non-https image dropped");
  });

  it("removes an anchor left empty after its only image was dropped", () => {
    const { html } = sanitizeCodaImportHtml(
      '<a href="https://link.example.com"><img src="blob:local"></a>'
    );
    expect(html).toBe("");
  });

  it("keeps only numeric img width/height", () => {
    expect(
      sanitizeCodaImportHtml('<img src="https://x/a.png" width="inherit">').html
    ).toBe('<img src="https://x/a.png">');
    expect(
      sanitizeCodaImportHtml('<img src="https://x/a.png" width="200">').html
    ).toContain('width="200"');
  });

  it("downgrades headings below level 3 to h3 and reports it", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      "<h4>Sub</h4><h6>Deep</h6>"
    );
    expect(html).toBe("<h3>Sub</h3><h3>Deep</h3>");
    expect(losses).toContain("2 headings below level 3 downgraded to h3");
  });

  it("unwraps generic wrapper divs and rewrites the highlight background shorthand", () => {
    const { html } = sanitizeCodaImportHtml(
      '<div class="kr-section"><div><p>text ' +
        '<span style="background: rgb(255, 224, 214)">hi</span></p></div></div>'
    );
    expect(html).toBe(
      '<p>text <span style="background-color: rgb(255, 224, 214)">hi</span></p>'
    );
  });

  it("preserves lists, inline formatting, blockquotes and code blocks", () => {
    const { html, losses } = sanitizeCodaImportHtml(
      "<ul><li><strong>one</strong></li><li><em>two</em></li></ul>" +
        "<blockquote>quote</blockquote><pre><code>code</code></pre>"
    );
    expect(html).toBe(
      "<ul><li><strong>one</strong></li><li><em>two</em></li></ul>" +
        "<blockquote>quote</blockquote><pre><code>code</code></pre>"
    );
    expect(losses).toEqual([]);
  });

  it("returns empty html and no losses for empty/whitespace input", () => {
    expect(sanitizeCodaImportHtml("")).toEqual({ html: "", losses: [] });
    expect(sanitizeCodaImportHtml("   \n  ")).toEqual({ html: "", losses: [] });
  });
});
