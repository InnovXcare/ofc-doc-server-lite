const test = require("node:test");
const assert = require("node:assert/strict");
const HeaderHtmlParser = require("./header-html-parser");

test("parses a patient table with formatting and column spans", () => {
  const parser = new HeaderHtmlParser();
  const [table] = parser.parse(`
    <header>
      <table border="1" style="width: 100%">
        <tr><td colspan="2"><strong>Patient:</strong> Jane Doe</td></tr>
        <tr><td style="text-align: right">38Y / F</td><td>07-Oct-2026</td></tr>
      </table>
    </header>
  `);

  assert.equal(table.type, "table");
  assert.equal(table.cols, 2);
  assert.equal(table.rows, 2);
  assert.deepEqual(table.width, { unit: "percent", value: 100 });
  assert.equal(table.borders, true);
  assert.equal(table.rowData[0].cells[0].colspan, 2);
  assert.equal(table.rowData[0].cells[0].runs[0].bold, true);
  assert.equal(table.rowData[1].cells[0].align, "right");
});

test("parses paragraphs and supported inline formatting", () => {
  const parser = new HeaderHtmlParser();
  const [paragraph] = parser.parse(
    '<p style="text-align: center; font-size: 10pt"><em>Patient header</em></p>'
  );

  assert.equal(paragraph.type, "paragraph");
  assert.equal(paragraph.align, "center");
  assert.equal(paragraph.runs[0].italic, true);
  assert.equal(paragraph.runs[0].fontSize, 20);
});
