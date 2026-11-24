const { promises: fs } = require("fs");
const { load } = require("cheerio");

const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "details",
  "summary",
  "fieldset",
  "form",
  "blockquote",
  "span",
]);

/**
 * Converts the supported patient-header HTML subset into plain descriptors.
 * The descriptors are consumed by Document Builder, keeping HTML parsing out
 * of its older JavaScript runtime.
 */
class HeaderHtmlParser {
  async parseFile(filePath) {
    const html = await fs.readFile(filePath, "utf8");
    return this.parse(html);
  }

  parse(html) {
    if (!html) return [];
    const $ = load(html);
    return this.parseBlockChildren($, $("body").get(0));
  }

  getStyleMap(node) {
    const style = node?.attribs?.style || "";
    return style.split(";").reduce((result, declaration) => {
      const separator = declaration.indexOf(":");
      if (separator === -1) return result;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim().toLowerCase();
      if (property) result[property] = value;
      return result;
    }, {});
  }

  getStyle(node, property) {
    return this.getStyleMap(node)[property] || "";
  }

  ancestors(node) {
    const result = [];
    let current = node;
    while (current) {
      if (current.type === "tag") result.push(current);
      current = current.parent;
    }
    return result;
  }

  resolveFormatting(node) {
    const ancestors = this.ancestors(node);
    const hasMatchingAncestor = (predicate) => ancestors.some(predicate);

    const bold = hasMatchingAncestor((element) => {
      const tag = element.name?.toLowerCase();
      const weight = this.getStyle(element, "font-weight");
      return (
        tag === "b" ||
        tag === "strong" ||
        tag === "th" ||
        weight === "bold" ||
        weight === "700"
      );
    });
    const italic = hasMatchingAncestor((element) => {
      const tag = element.name?.toLowerCase();
      return (
        tag === "i" ||
        tag === "em" ||
        this.getStyle(element, "font-style") === "italic"
      );
    });
    const underline = hasMatchingAncestor((element) => {
      return (
        element.name?.toLowerCase() === "u" ||
        this.getStyle(element, "text-decoration").includes("underline")
      );
    });
    const caps = hasMatchingAncestor(
      (element) => this.getStyle(element, "text-transform") === "uppercase"
    );

    let fontSize = null;
    for (const element of ancestors) {
      const value = this.getStyle(element, "font-size");
      if (value.endsWith("pt")) {
        fontSize = Math.round(Number.parseFloat(value) * 2);
        break;
      }
    }

    return { bold, italic, underline, caps, fontSize };
  }

  parseCssToTwips(value) {
    if (!value) return 0;
    const amount = Number.parseFloat(value);
    if (Number.isNaN(amount)) return 0;
    if (value.includes("pt")) return Math.round(amount * 20);
    if (value.includes("in")) return Math.round(amount * 1440);
    if (value.includes("cm")) return Math.round(amount * 567);
    if (value.includes("mm")) return Math.round(amount * 56.7);
    if (value.includes("px")) return Math.round(amount * 15);
    return 0;
  }

  parseAlignment(node) {
    const alignment = this.getStyle(node, "text-align");
    return ["center", "right", "justify"].includes(alignment)
      ? alignment
      : "left";
  }

  parseInlineRuns(node) {
    const runs = [];
    for (const child of node?.children || []) {
      if (child.type === "text") {
        if (!child.data?.trim()) continue;
        runs.push({
          type: "text",
          text: child.data,
          ...this.resolveFormatting(child.parent),
        });
      } else if (child.type === "tag") {
        if (child.name?.toLowerCase() === "br") {
          runs.push({ type: "linebreak" });
        } else {
          runs.push(...this.parseInlineRuns(child));
        }
      }
    }
    return runs;
  }

  getTableRows(table) {
    const rows = [];
    for (const child of table.children || []) {
      if (child.type !== "tag") continue;
      const tag = child.name?.toLowerCase();
      if (tag === "tr") {
        rows.push(child);
      } else if (["thead", "tbody", "tfoot"].includes(tag)) {
        rows.push(
          ...(child.children || []).filter(
            (node) =>
              node.type === "tag" && node.name?.toLowerCase() === "tr"
          )
        );
      }
    }
    return rows;
  }

  getRowCells(row) {
    return (row.children || []).filter(
      (node) =>
        node.type === "tag" &&
        ["td", "th"].includes(node.name?.toLowerCase())
    );
  }

  parseTable(table) {
    const rows = this.getTableRows(table);
    if (rows.length === 0) return null;

    const columnCount = rows.reduce((maximum, row) => {
      const count = this.getRowCells(row).reduce(
        (total, cell) => total + (Number.parseInt(cell.attribs?.colspan, 10) || 1),
        0
      );
      return Math.max(maximum, count);
    }, 0);
    if (columnCount === 0) return null;

    const tableWidth = this.getStyle(table, "width");
    let width = { unit: "percent", value: 100 };
    if (tableWidth.endsWith("%")) {
      width = { unit: "percent", value: Number.parseFloat(tableWidth) };
    } else {
      const twips = this.parseCssToTwips(tableWidth);
      if (twips > 0) width = { unit: "twips", value: twips };
    }

    const rowData = rows.map((row) => {
      let columnIndex = 0;
      const cells = this.getRowCells(row).map((cell) => {
        const colspan = Number.parseInt(cell.attribs?.colspan, 10) || 1;
        const cellWidth = this.parseCssToTwips(this.getStyle(cell, "width"));
        const descriptor = {
          colIndex: columnIndex,
          colspan,
          width:
            cellWidth > 0 ? { unit: "twips", value: cellWidth } : null,
          align: this.parseAlignment(cell),
          runs: this.parseInlineRuns(cell),
        };
        columnIndex += colspan;
        return descriptor;
      });
      return { cells };
    });

    return {
      type: "table",
      cols: columnCount,
      rows: rows.length,
      width,
      borders: Boolean(table.attribs?.border && table.attribs.border !== "0"),
      rowData,
    };
  }

  parseBlockChildren($, parent) {
    const result = [];
    for (const child of parent?.children || []) {
      if (child.type === "text") {
        if (!child.data?.trim()) continue;
        result.push({
          type: "paragraph",
          align: "left",
          heading: null,
          runs: [
            {
              type: "text",
              text: child.data,
              ...this.resolveFormatting(child.parent),
            },
          ],
        });
        continue;
      }
      if (child.type !== "tag") continue;

      const tag = child.name?.toLowerCase();
      if (tag === "table") {
        const table = this.parseTable(child);
        if (table) result.push(table);
      } else if (CONTAINER_TAGS.has(tag)) {
        result.push(...this.parseBlockChildren($, child));
      } else {
        const heading = { h1: "Heading 1", h2: "Heading 2", h3: "Heading 3" }[
          tag
        ];
        result.push({
          type: "paragraph",
          align: this.parseAlignment(child),
          heading: heading || null,
          runs: this.parseInlineRuns(child),
        });
      }
    }
    return result;
  }
}

module.exports = HeaderHtmlParser;
