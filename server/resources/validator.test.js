const test = require("node:test");
const assert = require("node:assert/strict");
const { lambdaEventSchema } = require("./validator");

const basePayload = {
  inputFile: {
    type: "html",
    location: "dev/org/report/id/report.html",
  },
  outputFiles: [
    {
      type: "docx",
      location: "dev/org/report/id",
    },
  ],
};

test("accepts an optional HTML patient header", () => {
  const result = lambdaEventSchema.validate({
    ...basePayload,
    inputFile: {
      ...basePayload.inputFile,
      headerFile: {
        type: "html",
        location: "dev/org/report/id/patient-header.html",
      },
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(result.value.inputFile.headerFile.type, "html");
});

test("rejects a non-HTML patient header", () => {
  const result = lambdaEventSchema.validate({
    ...basePayload,
    inputFile: {
      ...basePayload.inputFile,
      headerFile: {
        type: "docx",
        location: "dev/org/report/id/header.docx",
      },
    },
  });

  assert.ok(result.error);
});
