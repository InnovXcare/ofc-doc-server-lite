const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { promises: fs } = require("node:fs");
const RegularFileProcessor = require("./regular-file-processor");
const { getFormatFromString } = require("../../resources/utils");

test("creates canvas BIN through x2t after inserting the patient header", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "patient-header-bin-"));
  const tempDirs = {
    result: path.join(root, "result"),
    temp: path.join(root, "temp"),
  };
  await Promise.all(Object.values(tempDirs).map((directory) => fs.mkdir(directory)));
  const calls = { docBuilder: [], convertAndUpload: [], processAndUpload: [] };
  const x2tConverter = {
    convert: async ({ outputFile }) => fs.writeFile(outputFile, "docx"),
  };
  const docBuilderConverter = {
    convert: async (args) => {
      calls.docBuilder.push(args);
      await Promise.all(args.outputFiles.map(({ path: outputPath }) => fs.writeFile(outputPath, "headered-docx")));
    },
  };
  const fileProcessor = { validateFile: async () => undefined };
  const processor = new RegularFileProcessor(x2tConverter, docBuilderConverter, fileProcessor);

  await processor.process({
    sourceFile: path.join(root, "report.html"),
    outputFiles: [
      { type: "bin", key: "report", location: "reports/id" },
      { type: "docx", key: "report", location: "reports/id" },
    ],
    tempDirs,
    region: "ap-south-1",
    s3Service: {},
    headerElements: [{ type: "paragraph", runs: [] }],
    convertAndUpload: async (args) => {
      calls.convertAndUpload.push(args);
      return { type: args.file.type };
    },
    processAndUpload: async (args) => {
      calls.processAndUpload.push(args);
      return { type: args.outputFile.type };
    },
  });

  assert.equal(calls.docBuilder.length, 1);
  assert.deepEqual(calls.docBuilder[0].outputFiles.map(({ format }) => format), [getFormatFromString("docx")]);
  assert.deepEqual(calls.convertAndUpload.map(({ file }) => file.type), ["bin"]);
  assert.deepEqual(calls.processAndUpload.map(({ outputFile }) => outputFile.type), ["docx"]);

  await fs.rm(root, { recursive: true, force: true });
});
