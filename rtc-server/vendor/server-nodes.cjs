"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../doc-editor/packages/doc-editor/src/nodes/AllNodesServer.js
var AllNodesServer_exports = {};
__export(AllNodesServer_exports, {
  AllDocEditorNodes: () => AllDocEditorNodes
});
module.exports = __toCommonJS(AllNodesServer_exports);
var import_code = require("@lexical/code");
var import_hashtag = require("@lexical/hashtag");
var import_link = require("@lexical/link");
var import_list = require("@lexical/list");
var import_overflow = require("@lexical/overflow");
var import_rich_text = require("@lexical/rich-text");
var import_table2 = require("@lexical/table");
var import_lexical6 = require("lexical");

// ../../doc-editor/packages/doc-editor/src/nodes/CustomTableCellNode/index.js
var import_table = require("@lexical/table");

// ../../doc-editor/packages/doc-editor/src/components/FontColorPickerButton/ColorPickerGridVals.js
var ColorPickerGridValues = [
  [
    { label: "blue", color: "#00C4DB" },
    { label: "pink", color: "#FF668F" },
    { label: "violet", color: "#7777FF" },
    { label: "teal", color: "#00B993" },
    { label: "yellow", color: "#FFAA00" }
  ],
  [
    { label: "neutral", color: "#707070" },
    { label: "orange", color: "#FF865D" },
    { label: "purple", color: "#CC66FF" },
    { label: "green", color: "#8EC80A" },
    { label: "dark-pink", color: "#8A064C" }
  ]
];
var ColorPickerGridVals_default = ColorPickerGridValues;

// ../../doc-editor/packages/doc-editor/src/nodes/CustomTableCellNode/index.js
var BORDER_TYPES = {
  LEFT: "left",
  RIGHT: "right",
  TOP: "top",
  BOTTOM: "bottom",
  ALL: "all",
  NONE: "none"
};
var DEFAULT_BORDER_COLOR = "#E6E6E6";
var ALL_BORDERS = [
  BORDER_TYPES.TOP,
  BORDER_TYPES.RIGHT,
  BORDER_TYPES.BOTTOM,
  BORDER_TYPES.LEFT
];
var DEFAULT_BORDER_COLORS = {
  top: DEFAULT_BORDER_COLOR,
  right: DEFAULT_BORDER_COLOR,
  bottom: DEFAULT_BORDER_COLOR,
  left: DEFAULT_BORDER_COLOR
};
function $convertTableCellElement(domNode) {
  const nodeName = domNode.nodeName.toLowerCase();
  const tableCellNode = $createCustomTableCellNode(
    nodeName === "th" ? import_table.TableCellHeaderStates.ROW : import_table.TableCellHeaderStates.NO_STATUS
  );
  const colSpan = domNode.colSpan;
  const rowSpan = domNode.rowSpan;
  if (colSpan > 1) tableCellNode.__colSpan = colSpan;
  if (rowSpan > 1) tableCellNode.__rowSpan = rowSpan;
  const width = domNode.style.width;
  if (width) tableCellNode.__width = parseInt(width, 10);
  const backgroundColor = domNode.style.backgroundColor;
  if (backgroundColor) tableCellNode.__backgroundColor = backgroundColor;
  const flattenedColors = ColorPickerGridVals_default.flatMap(
    (row) => row.map((item) => item.color)
  );
  const borderTypesAttr = domNode.getAttribute("data-border-types");
  if (borderTypesAttr) {
    tableCellNode.__borderTypes = new Set(
      borderTypesAttr.split("|").filter(Boolean)
    );
  }
  const colorsAttr = domNode.getAttribute("data-border-colors");
  if (colorsAttr) {
    try {
      const parsed = {};
      colorsAttr.split("|").forEach((part) => {
        const [edge, color] = part.split(":");
        if (ALL_BORDERS.includes(edge) && flattenedColors.includes(color)) {
          parsed[edge] = color;
        }
      });
      tableCellNode.__borderColors = {
        ...DEFAULT_BORDER_COLORS,
        ...parsed
      };
    } catch {
    }
  }
  const style = domNode.style.cssText;
  tableCellNode.setStyle(style);
  return { node: tableCellNode };
}
var CustomTableCellNode = class _CustomTableCellNode extends import_table.TableCellNode {
  __borderTypes = /* @__PURE__ */ new Set();
  __borderColors = { ...DEFAULT_BORDER_COLORS };
  constructor(headerState, colSpan, width, key) {
    super(headerState, colSpan, width, key);
    this.__borderTypes = new Set(ALL_BORDERS);
    this.__borderColors = { ...DEFAULT_BORDER_COLORS };
  }
  static getType() {
    return "custom-table-cell";
  }
  static clone(node) {
    const newNode = new _CustomTableCellNode(
      node.__headerState,
      node.__colSpan,
      node.__width,
      node.__key
    );
    newNode.__borderTypes = new Set(node.__borderTypes);
    newNode.__borderColors = { ...node.__borderColors };
    return newNode;
  }
  static importJSON(serializedNode) {
    const node = $createCustomTableCellNode(
      serializedNode.headerState,
      serializedNode.colSpan,
      serializedNode.width
    );
    node.__rowSpan = serializedNode.rowSpan || 1;
    node.__backgroundColor = serializedNode.backgroundColor || null;
    node.__borderTypes = new Set(
      serializedNode.borderTypes ?? [...ALL_BORDERS]
    );
    node.__borderColors = {
      ...DEFAULT_BORDER_COLORS,
      ...serializedNode.borderColors || {}
    };
    return node;
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: "custom-table-cell",
      borderTypes: Array.from(this.__borderTypes),
      borderColors: this.__borderColors
    };
  }
  getBorderTypes() {
    return Array.from(this.getLatest().__borderTypes);
  }
  setBorderTypes(types) {
    const self = this.getWritable();
    self.__borderTypes = new Set(types);
    return self;
  }
  addBorderType(type) {
    const self = this.getWritable();
    switch (type) {
      case BORDER_TYPES.TOP:
      case BORDER_TYPES.RIGHT:
      case BORDER_TYPES.BOTTOM:
      case BORDER_TYPES.LEFT:
        self.__borderTypes.add(type);
        break;
      case BORDER_TYPES.ALL:
        self.__borderTypes = /* @__PURE__ */ new Set([
          BORDER_TYPES.TOP,
          BORDER_TYPES.BOTTOM,
          BORDER_TYPES.LEFT,
          BORDER_TYPES.RIGHT
        ]);
        break;
      case BORDER_TYPES.NONE:
        self.__borderTypes = /* @__PURE__ */ new Set([type]);
        break;
      default:
        break;
    }
    return self;
  }
  setBorderColorForEdge(edge, color) {
    const self = this.getWritable();
    self.__borderColors = { ...self.__borderColors, [edge]: color };
    return self;
  }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.style = this.getStyle();
    this.applyBorderStyles(dom);
    if (this.__backgroundColor) {
      dom.style.backgroundColor = this.__backgroundColor;
    }
    if (this.__verticalAlign) {
      dom.style.verticalAlign = this.__verticalAlign;
    }
    return dom;
  }
  updateDOM(prevNode, dom, config) {
    const updated = super.updateDOM(prevNode, dom, config);
    const prevKey = Array.from(prevNode.__borderTypes).join("|") + JSON.stringify(prevNode.__borderColors);
    const nextKey = Array.from(this.__borderTypes).join("|") + JSON.stringify(this.__borderColors);
    let internalUpdated = false;
    if (prevKey !== nextKey) {
      this.applyBorderStyles(dom);
      internalUpdated = true;
    }
    if (prevNode.__backgroundColor !== prevNode.__backgroundColor) {
      dom.style.backgroundColor = this.__backgroundColor || "";
      internalUpdated = true;
    }
    if (prevNode.__verticalAlign !== this.__verticalAlign) {
      dom.style.verticalAlign = this.__verticalAlign;
      internalUpdated = true;
    }
    return updated || internalUpdated;
  }
  exportDOM(editor) {
    const { element } = super.exportDOM(editor);
    if (element) {
      element.setAttribute(
        "data-border-types",
        Array.from(this.__borderTypes).join("|")
      );
      element.setAttribute(
        "data-border-colors",
        Object.keys(this.__borderColors).map((key) => `${key}:${this.__borderColors[key]}`).join("|")
      );
      this.applyBorderStyles(element);
    }
    return { element };
  }
  static importDOM() {
    return {
      td: () => ({
        conversion: $convertTableCellElement,
        priority: 1
      }),
      th: () => ({
        conversion: $convertTableCellElement,
        priority: 1
      })
    };
  }
  applyBorderStyles(dom) {
    const types = this.__borderTypes;
    const c = this.__borderColors;
    const has = (t) => types.has(t);
    dom.style.border = "none";
    if (types.size === 0) return;
    if (has(BORDER_TYPES.TOP) && has(BORDER_TYPES.RIGHT) && has(BORDER_TYPES.BOTTOM) && has(BORDER_TYPES.LEFT)) {
      dom.style.borderTop = `1px solid ${c.top}`;
      dom.style.borderRight = `1px solid ${c.right}`;
      dom.style.borderBottom = `1px solid ${c.bottom}`;
      dom.style.borderLeft = `1px solid ${c.left}`;
      return;
    }
    if (has(BORDER_TYPES.TOP)) dom.style.borderTop = `1px solid ${c.top}`;
    if (has(BORDER_TYPES.RIGHT)) dom.style.borderRight = `1px solid ${c.right}`;
    if (has(BORDER_TYPES.BOTTOM))
      dom.style.borderBottom = `1px solid ${c.bottom}`;
    if (has(BORDER_TYPES.LEFT)) dom.style.borderLeft = `1px solid ${c.left}`;
  }
};
function $createCustomTableCellNode(headerState, colSpan, width) {
  return new CustomTableCellNode(headerState, colSpan, width);
}
var CustomTableCellNodeReplacement = {
  replace: import_table.TableCellNode,
  with: (node) => {
    const newNode = new CustomTableCellNode(
      node.__headerState,
      node.__colSpan,
      node.__width
    );
    newNode.__rowSpan = node.__rowSpan;
    newNode.__backgroundColor = node.__backgroundColor;
    newNode.__borderTypes = new Set(ALL_BORDERS);
    newNode.__borderColors = { ...DEFAULT_BORDER_COLORS };
    return newNode;
  }
};

// ../../doc-editor/packages/doc-editor/src/nodes/LayoutNode/LayoutItemNode.js
var import_utils2 = require("@lexical/utils");
var import_lexical2 = require("lexical");

// ../../doc-editor/packages/doc-editor/src/nodes/LayoutNode/LayoutContainerNode.js
var import_utils = require("@lexical/utils");
var import_lexical = require("lexical");
var TOTAL_GRID_UNITS = 20;
function parseTemplateColumns(templateColumns) {
  if (!templateColumns) return [];
  return templateColumns.trim().split(/\s+/).map((part) => {
    const match = part.match(/^(\d*\.?\d+)/);
    return match ? parseFloat(match[1]) : 1;
  });
}
function $convertLayoutContainerElement(domNode) {
  const template = domNode.getAttribute("data-lexical-layout-template");
  if (!template) {
    return null;
  }
  const containerNode = $createLayoutContainerNode(template);
  return { node: containerNode };
}
var LayoutContainerNode = class _LayoutContainerNode extends import_lexical.ElementNode {
  constructor(templateColumns, key) {
    super(key);
    this.__templateColumns = templateColumns;
  }
  static getType() {
    return "layout-container";
  }
  static clone(node) {
    return new _LayoutContainerNode(node.__templateColumns, node.__key);
  }
  createDOM(config) {
    const dom = document.createElement("div");
    dom.style.display = "grid";
    dom.style.gridTemplateColumns = `repeat(${TOTAL_GRID_UNITS},1fr)`;
    if (typeof config.theme.layoutContainer === "string") {
      (0, import_utils.addClassNamesToElement)(dom, config.theme.layoutContainer);
    }
    dom.setAttribute("data-lexical-layout-container", "true");
    dom.setAttribute("data-lexical-layout-container-version", "2");
    dom.setAttribute("data-lexical-layout-template", this.__templateColumns);
    return dom;
  }
  exportDOM() {
    const element = document.createElement("div");
    element.style.display = "grid";
    element.style.gridTemplateColumns = `repeat(${TOTAL_GRID_UNITS},1fr)`;
    element.setAttribute("data-lexical-layout-container", "true");
    element.setAttribute(
      "data-lexical-layout-template",
      this.__templateColumns
    );
    return { element };
  }
  updateDOM(prevNode, dom) {
    if (dom.style.gridTemplateColumns !== `repeat(${TOTAL_GRID_UNITS},1fr)`) {
      dom.style.gridTemplateColumns = `repeat(${TOTAL_GRID_UNITS},1fr)`;
    }
    return false;
  }
  static importDOM() {
    return {
      div: (domNode) => {
        if (!domNode.hasAttribute("data-lexical-layout-container")) {
          return null;
        }
        return {
          conversion: $convertLayoutContainerElement,
          priority: 2
        };
      }
    };
  }
  static importJSON(json) {
    return $createLayoutContainerNode().updateFromJSON(json);
  }
  updateFromJSON(serializedNode) {
    return super.updateFromJSON(serializedNode).setTemplateColumns(serializedNode.templateColumns);
  }
  isShadowRoot() {
    return true;
  }
  canBeEmpty() {
    return false;
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      templateColumns: this.__templateColumns
    };
  }
  getTemplateColumns() {
    return this.getLatest().__templateColumns;
  }
  setTemplateColumns(templateColumns) {
    const self = this.getWritable();
    self.__templateColumns = templateColumns;
    return self;
  }
};
function normalizeTemplateString(templateColumns) {
  if (!templateColumns) return "";
  const values = parseTemplateColumns(templateColumns);
  if (!values.length) return "";
  const total = values.reduce((a, b) => a + b, 0);
  const scaled = values.map(
    (v) => Math.max(1, Math.round(v / total * TOTAL_GRID_UNITS))
  );
  let diff = scaled.reduce((a, b) => a + b, 0) - TOTAL_GRID_UNITS;
  if (diff !== 0 && scaled.length) {
    scaled[scaled.length - 1] = Math.max(1, scaled[scaled.length - 1] - diff);
  }
  return scaled.map((s) => `${s}fr`).join(" ");
}
function $createLayoutContainerNode(templateColumns = "") {
  const normalized = normalizeTemplateString(templateColumns);
  return new LayoutContainerNode(normalized);
}

// ../../doc-editor/packages/doc-editor/src/nodes/LayoutNode/LayoutItemNode.js
function getItemsCountFromTemplate(template) {
  if (!template) return 0;
  return template.trim().split(/\s+/).filter(Boolean).length;
}
function computeColumnGroupForIndex(index, itemsCount) {
  if (itemsCount <= 0) return "";
  const totalUnits = TOTAL_GRID_UNITS;
  const baseSpan = Math.floor(totalUnits / itemsCount);
  const remainder = totalUnits - baseSpan * itemsCount;
  let cursor = 1;
  for (let i = 0; i <= index; i++) {
    let span = baseSpan;
    if (span < 1) span = 1;
    if (i < remainder) span += 1;
    if (i === index) {
      let end = cursor + span;
      if (end > totalUnits + 1) end = totalUnits + 1;
      return `${cursor} / ${end}`;
    }
    cursor += span;
  }
  return "";
}
function $convertLayoutItemElement(domNode) {
  let dataGridColumn = domNode.getAttribute("data-grid-column") || domNode.style.gridColumn || "";
  if (!dataGridColumn) {
    const parent = domNode.parentElement;
    if (parent && parent.hasAttribute("data-lexical-layout-container")) {
      const template = parent.getAttribute("data-lexical-layout-template");
      const itemsCount = getItemsCountFromTemplate(template);
      const siblings = Array.from(
        parent.querySelectorAll(`:scope > div[data-lexical-layout-item="true"]`)
      );
      const index = siblings.indexOf(domNode);
      if (index >= 0 && index < itemsCount) {
        dataGridColumn = computeColumnGroupForIndex(index, itemsCount);
      }
    }
  }
  return { node: $createLayoutItemNode(dataGridColumn) };
}
function $isEmptyLayoutItemNode(node) {
  if (!$isLayoutItemNode(node) || node.getChildrenSize() !== 1) {
    return false;
  }
  const firstChild = node.getFirstChild();
  return (0, import_lexical2.$isParagraphNode)(firstChild) && firstChild.isEmpty();
}
var LayoutItemNode = class _LayoutItemNode extends import_lexical2.ElementNode {
  constructor(dataGridColumn = "", key) {
    super(key);
    this.__dataGridColumn = dataGridColumn;
  }
  static getType() {
    return "layout-item";
  }
  static clone(node) {
    return new _LayoutItemNode(node.__dataGridColumn, node.__key);
  }
  createDOM(config) {
    const dom = document.createElement("div");
    dom.setAttribute("data-lexical-layout-item", "true");
    if (this.__dataGridColumn) {
      dom.style.gridColumn = this.__dataGridColumn;
      dom.setAttribute("data-grid-column", this.__dataGridColumn);
    }
    if (typeof config.theme.layoutItem === "string") {
      (0, import_utils2.addClassNamesToElement)(dom, config.theme.layoutItem);
    }
    return dom;
  }
  updateDOM(prevNode, dom) {
    if (prevNode.__dataGridColumn !== this.__dataGridColumn) {
      if (this.__dataGridColumn) {
        dom.style.gridColumn = this.__dataGridColumn;
        dom.setAttribute("data-grid-column", this.__dataGridColumn);
      } else {
        dom.style.removeProperty("grid-column");
        dom.removeAttribute("data-grid-column");
      }
    }
    return false;
  }
  exportDOM() {
    const element = document.createElement("div");
    element.setAttribute("data-lexical-layout-item", "true");
    if (this.__dataGridColumn) {
      element.style.gridColumn = this.__dataGridColumn;
      element.setAttribute("data-grid-column", this.__dataGridColumn);
    }
    return { element };
  }
  collapseAtStart() {
    const parent = this.getParentOrThrow();
    if (this.is(parent.getFirstChild()) && parent.getChildren().every($isEmptyLayoutItemNode)) {
      parent.remove();
      return true;
    }
    return false;
  }
  static importDOM() {
    return {
      div: (domNode) => {
        if (!domNode.hasAttribute("data-lexical-layout-item")) {
          return null;
        }
        return {
          conversion: $convertLayoutItemElement,
          priority: 2
        };
      }
    };
  }
  static importJSON(serializedNode) {
    return $createLayoutItemNode(
      serializedNode.dataGridColumn || ""
    ).updateFromJSON(serializedNode);
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: "layout-item",
      dataGridColumn: this.__dataGridColumn
    };
  }
  isShadowRoot() {
    return true;
  }
  getDataGridColumn() {
    return this.getLatest().__dataGridColumn;
  }
  setDataGridColumn(value) {
    const self = this.getWritable();
    self.__dataGridColumn = value;
    return self;
  }
};
function $createLayoutItemNode(dataGridColumn = "") {
  return new LayoutItemNode(dataGridColumn);
}
function $isLayoutItemNode(node) {
  return node instanceof LayoutItemNode;
}

// ../../doc-editor/packages/doc-editor/src/plugins/CollapsiblePlugin/CollapsibleContainerNode.js
var import_utils3 = require("@lexical/utils");
var import_lexical3 = require("lexical");

// ../../doc-editor/packages/doc-editor/src/plugins/CollapsiblePlugin/CollapsibleUtils.js
function setDomHiddenUntilFound(dom) {
  dom.hidden = "until-found";
}
function domOnBeforeMatch(dom, callback) {
  dom.onbeforematch = callback;
}

// ../../doc-editor/packages/doc-editor/src/plugins/CollapsiblePlugin/CollapsibleContainerNode.js
function $convertDetailsElement(domNode) {
  const isOpen = domNode.open !== void 0 ? domNode.open : true;
  const node = $createCollapsibleContainerNode(isOpen);
  return {
    node
  };
}
var CollapsibleContainerNode = class _CollapsibleContainerNode extends import_lexical3.ElementNode {
  constructor(open, key) {
    super(key);
    this.__open = open;
  }
  static getType() {
    return "collapsible-container";
  }
  static clone(node) {
    return new _CollapsibleContainerNode(node.__open, node.__key);
  }
  isShadowRoot() {
    return true;
  }
  collapseAtStart() {
    const nodesToInsert = [];
    for (const child of this.getChildren()) {
      if ((0, import_lexical3.$isElementNode)(child)) {
        nodesToInsert.push(...child.getChildren());
      }
    }
    const caret = (0, import_lexical3.$rewindSiblingCaret)((0, import_lexical3.$getSiblingCaret)(this, "previous"));
    caret.splice(1, nodesToInsert);
    const [firstChild] = nodesToInsert;
    if (firstChild) {
      firstChild.selectStart().deleteCharacter(true);
    }
    return true;
  }
  createDOM(config, editor) {
    let dom;
    if (import_utils3.IS_CHROME) {
      dom = document.createElement("div");
      if (this.__open) {
        dom.setAttribute("open", "");
      }
    } else {
      const detailsDom = document.createElement("details");
      detailsDom.open = this.__open;
      detailsDom.addEventListener("toggle", () => {
        const open = editor.getEditorState().read(() => this.getOpen());
        if (open !== detailsDom.open) {
          editor.update(() => this.toggleOpen());
        }
      });
      dom = detailsDom;
    }
    dom.classList.add("Collapsible__container");
    return dom;
  }
  updateDOM(prevNode, dom) {
    const currentOpen = this.__open;
    if (prevNode.__open !== currentOpen) {
      if (import_utils3.IS_CHROME) {
        const contentDom = dom.children[1];
        if (!(0, import_lexical3.isHTMLElement)(contentDom)) {
          throw new Error("Expected contentDom to be an HTMLElement");
        }
        if (currentOpen) {
          dom.setAttribute("open", "");
          contentDom.hidden = false;
        } else {
          dom.removeAttribute("open");
          setDomHiddenUntilFound(contentDom);
        }
      } else {
        dom.open = this.__open;
      }
    }
    return false;
  }
  static importDOM() {
    return {
      details: () => {
        return {
          conversion: $convertDetailsElement,
          priority: 1
        };
      }
    };
  }
  static importJSON(serializedNode) {
    return $createCollapsibleContainerNode(serializedNode.open).updateFromJSON(
      serializedNode
    );
  }
  exportDOM() {
    const element = document.createElement("details");
    element.classList.add("Collapsible__container");
    element.setAttribute("open", this.__open.toString());
    return { element };
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      open: this.__open
    };
  }
  setOpen(open) {
    const writable = this.getWritable();
    writable.__open = open;
  }
  getOpen() {
    return this.getLatest().__open;
  }
  toggleOpen() {
    this.setOpen(!this.getOpen());
  }
};
function $createCollapsibleContainerNode(isOpen) {
  return new CollapsibleContainerNode(isOpen);
}
function $isCollapsibleContainerNode(node) {
  return node instanceof CollapsibleContainerNode;
}

// ../../doc-editor/packages/doc-editor/src/plugins/CollapsiblePlugin/CollapsibleTitleNode.js
var import_utils5 = require("@lexical/utils");
var import_lexical5 = require("lexical");

// ../../doc-editor/packages/doc-editor/src/plugins/CollapsiblePlugin/CollapsibleContentNode.js
var import_utils4 = require("@lexical/utils");
var import_lexical4 = require("lexical");
function $convertCollapsibleContentElement() {
  const node = $createCollapsibleContentNode();
  return {
    node
  };
}
var CollapsibleContentNode = class _CollapsibleContentNode extends import_lexical4.ElementNode {
  static getType() {
    return "collapsible-content";
  }
  static clone(node) {
    return new _CollapsibleContentNode(node.__key);
  }
  createDOM(config, editor) {
    const dom = document.createElement("div");
    dom.classList.add("Collapsible__content");
    if (import_utils4.IS_CHROME) {
      editor.getEditorState().read(() => {
        const containerNode = this.getParentOrThrow();
        if (!$isCollapsibleContainerNode(containerNode)) {
          throw new Error(
            "Expected parent node to be a CollapsibleContainerNode"
          );
        }
        if (!containerNode.__open) {
          setDomHiddenUntilFound(dom);
        }
      });
      domOnBeforeMatch(dom, () => {
        editor.update(() => {
          const containerNode = this.getParentOrThrow().getLatest();
          if (!$isCollapsibleContainerNode(containerNode)) {
            throw new Error(
              "Expected parent node to be a CollapsibleContainerNode"
            );
          }
          if (!containerNode.__open) {
            containerNode.toggleOpen();
          }
        });
      });
    }
    return dom;
  }
  updateDOM() {
    return false;
  }
  static importDOM() {
    return {
      div: (domNode) => {
        if (!domNode.hasAttribute("data-lexical-collapsible-content")) {
          return null;
        }
        return {
          conversion: $convertCollapsibleContentElement,
          priority: 2
        };
      }
    };
  }
  exportDOM() {
    const element = document.createElement("div");
    element.classList.add("Collapsible__content");
    element.setAttribute("data-lexical-collapsible-content", "true");
    return { element };
  }
  static importJSON(serializedNode) {
    return $createCollapsibleContentNode().updateFromJSON(serializedNode);
  }
  isShadowRoot() {
    return true;
  }
};
function $createCollapsibleContentNode() {
  return new CollapsibleContentNode();
}
function $isCollapsibleContentNode(node) {
  return node instanceof CollapsibleContentNode;
}

// ../../doc-editor/packages/doc-editor/src/plugins/CollapsiblePlugin/CollapsibleTitleNode.js
function $convertSummaryElement() {
  const node = $createCollapsibleTitleNode();
  return {
    node
  };
}
var CollapsibleTitleNode = class _CollapsibleTitleNode extends import_lexical5.ElementNode {
  static getType() {
    return "collapsible-title";
  }
  static clone(node) {
    return new _CollapsibleTitleNode(node.__key);
  }
  createDOM(config, editor) {
    const dom = document.createElement("summary");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "10");
    svg.setAttribute("height", "6");
    svg.setAttribute("viewBox", "0 0 10 6");
    svg.setAttribute("fill", "none");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M5.44213 5.05806L8.93324 1.56694C9.32697 1.17321 9.04812 0.500001 8.4913 0.500001L1.50907 0.5C0.952251 0.5 0.673395 1.17321 1.06712 1.56694L4.55824 5.05806C4.80232 5.30213 5.19805 5.30213 5.44213 5.05806Z"
    );
    path.setAttribute("fill", "#707070");
    svg.classList.add("Collapsible__caret");
    svg.appendChild(path);
    dom.appendChild(svg);
    dom.classList.add("Collapsible__title");
    if (import_utils5.IS_CHROME) {
      svg.addEventListener("click", () => {
        editor.update(() => {
          const collapsibleContainer = this.getLatest().getParentOrThrow();
          if (!$isCollapsibleContainerNode(collapsibleContainer)) {
            throw new Error(
              "Expected parent node to be a CollapsibleContainerNode"
            );
          }
          collapsibleContainer.toggleOpen();
        });
      });
    }
    return dom;
  }
  updateDOM() {
    return false;
  }
  static importDOM() {
    return {
      summary: () => {
        return {
          conversion: $convertSummaryElement,
          priority: 1
        };
      }
    };
  }
  static importJSON(serializedNode) {
    return $createCollapsibleTitleNode().updateFromJSON(serializedNode);
  }
  static transform() {
    return (node) => {
      if (!$isCollapsibleTitleNode(node)) {
        throw new Error("node is not a CollapsibleTitleNode");
      }
      if (node.isEmpty()) {
        node.remove();
      }
    };
  }
  insertNewAfter(_, restoreSelection = true) {
    const containerNode = this.getParentOrThrow();
    if (!$isCollapsibleContainerNode(containerNode)) {
      throw new Error(
        "CollapsibleTitleNode expects to be child of CollapsibleContainerNode"
      );
    }
    if (containerNode.getOpen()) {
      const contentNode = this.getNextSibling();
      if (!$isCollapsibleContentNode(contentNode)) {
        throw new Error(
          "CollapsibleTitleNode expects to have CollapsibleContentNode sibling"
        );
      }
      const firstChild = contentNode.getFirstChild();
      if ((0, import_lexical5.$isElementNode)(firstChild)) {
        return firstChild;
      } else {
        const paragraph = (0, import_lexical5.$createParagraphNode)();
        contentNode.append(paragraph);
        return paragraph;
      }
    } else {
      const paragraph = (0, import_lexical5.$createParagraphNode)();
      containerNode.insertAfter(paragraph, restoreSelection);
      return paragraph;
    }
  }
};
function $createCollapsibleTitleNode() {
  return new CollapsibleTitleNode();
}
function $isCollapsibleTitleNode(node) {
  return node instanceof CollapsibleTitleNode;
}

// ../../doc-editor/packages/doc-editor/src/nodes/AllNodesServer.js
var AllDocEditorNodes = [
  import_rich_text.HeadingNode,
  import_list.ListNode,
  import_list.ListItemNode,
  import_rich_text.QuoteNode,
  import_code.CodeNode,
  import_table2.TableNode,
  CustomTableCellNodeReplacement,
  CustomTableCellNode,
  import_table2.TableRowNode,
  import_hashtag.HashtagNode,
  import_code.CodeHighlightNode,
  import_link.AutoLinkNode,
  import_link.LinkNode,
  import_overflow.OverflowNode,
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode,
  LayoutItemNode,
  LayoutContainerNode,
  import_lexical6.TextNode,
  import_lexical6.ParagraphNode
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AllDocEditorNodes
});
