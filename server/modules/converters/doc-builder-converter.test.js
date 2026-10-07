const test = require("node:test");
const assert = require("node:assert/strict");
const DocBuilderConverter = require("./doc-builder-converter");
const { getFormatFromString } = require("../../resources/utils");

test("adds native header rendering before saving the intermediate DOCX", () => {
  const converter = new DocBuilderConverter();
  const script = converter.generateDocBuilderScript(
    "/tmp/report.docx",
    [{ path: "/tmp/report.docx", format: getFormatFromString("docx") }],
    true,
    [
      {
        type: "paragraph",
        align: "left",
        heading: null,
        runs: [{ type: "text", text: "Patient: Jane Doe" }],
      },
    ]
  );

  assert.match(script, /GetHeader\("default", true\)/);
  assert.match(script, /insertPatientHeader\(oDocument, PATIENT_HEADER_ELEMENTS\)/);
  assert.match(script, /Patient: Jane Doe/);
  assert.match(script, /builder\.SaveFile\("docx", "\/tmp\/report\.docx"\)/);
});
