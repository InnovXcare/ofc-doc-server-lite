const assert = require("node:assert/strict");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const RegularFileProcessor = require("./regular-file-processor");

async function createHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "html-report-output-"));
  const tempDirs = {
    result: path.join(root, "result"),
    temp: path.join(root, "temp"),
  };
  await fs.mkdir(tempDirs.result, { recursive: true });
  await fs.mkdir(tempDirs.temp, { recursive: true });
  const sourceFile = path.join(root, "report.html");
  await fs.writeFile(sourceFile, '<p style="color:#DD7439">Finding</p>');

  const x2tCalls = [];
  const docBuilderCalls = [];
  const uploads = [];
  const x2tConverter = {
    async convert(options) {
      x2tCalls.push(options);
      await fs.writeFile(options.outputFile, "x2t output");
    },
  };
  const docBuilderConverter = {
    async convert(options) {
      docBuilderCalls.push(options);
      await Promise.all(
        options.outputFiles.map((output) =>
          fs.writeFile(output.path, "docbuilder output")
        )
      );
    },
  };
  const fileProcessor = {
    async validateFile(filePath) {
      const stats = await fs.stat(filePath);
      assert.ok(stats.size > 0);
    },
  };
  const processor = new RegularFileProcessor(
    x2tConverter,
    docBuilderConverter,
    fileProcessor
  );
  const outputFiles = ["bin", "pdf", "docx", "rtf"].map((type) => ({
    type,
    key: "report",
    location: "local/org/report/id",
  }));

  return {
    root,
    sourceFile,
    tempDirs,
    outputFiles,
    x2tCalls,
    docBuilderCalls,
    uploads,
    processor,
    processAndUpload: async (options) => {
      uploads.push(options);
      return options.outputFile.type;
    },
  };
}

test("HTML report conversion preserves BIN formatting and normalizes all export formats", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));

  const result = await harness.processor.process({
    sourceFile: harness.sourceFile,
    inputFile: { type: "html" },
    outputFiles: harness.outputFiles,
    tempDirs: harness.tempDirs,
    region: "ap-south-1",
    s3Service: {},
    processAndUpload: harness.processAndUpload,
    convertAndUpload: async () => assert.fail("mixed HTML outputs must use the report workflow"),
    headerElements: [],
  });

  assert.deepEqual(result, ["bin", "pdf", "docx", "rtf"]);
  assert.equal(harness.x2tCalls.length, 2);
  assert.equal(harness.x2tCalls[1].sourceFile, harness.sourceFile);
  assert.equal(harness.docBuilderCalls.length, 1);
  assert.equal(harness.docBuilderCalls[0].preserveFormatting, false);
  assert.deepEqual(
    harness.docBuilderCalls[0].outputFiles.map((output) => path.extname(output.path)),
    [".pdf", ".docx", ".rtf"]
  );
  assert.deepEqual(
    Object.fromEntries(
      harness.uploads.map(({ outputFile, converterUsed }) => [
        outputFile.type,
        converterUsed,
      ])
    ),
    {
      bin: "x2t",
      pdf: "docbuilder",
      docx: "docbuilder",
      rtf: "docbuilder",
    }
  );
});

test("HTML report conversion inserts the patient header before preserving BIN and normalizing exports", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const headerElements = [{ type: "paragraph", runs: [{ text: "Patient" }] }];

  await harness.processor.process({
    sourceFile: harness.sourceFile,
    inputFile: { type: "html" },
    outputFiles: harness.outputFiles,
    tempDirs: harness.tempDirs,
    region: "ap-south-1",
    s3Service: {},
    processAndUpload: harness.processAndUpload,
    convertAndUpload: async () => assert.fail("mixed HTML outputs must use the report workflow"),
    headerElements,
  });

  assert.equal(harness.docBuilderCalls.length, 2);
  const headerCall = harness.docBuilderCalls[0];
  assert.equal(headerCall.preserveFormatting, true);
  assert.deepEqual(headerCall.headerElements, headerElements);
  assert.equal(harness.x2tCalls[1].sourceFile, headerCall.outputFiles[0].path);

  const exportCall = harness.docBuilderCalls[1];
  assert.equal(exportCall.sourceFile, headerCall.outputFiles[0].path);
  assert.equal(exportCall.preserveFormatting, false);
  assert.equal(exportCall.headerElements, undefined);
});

test("HTML report conversion uploads nothing when an export cannot be generated", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  harness.processor.docBuilderConverter.convert = async () => {
    throw new Error("export conversion failed");
  };

  await assert.rejects(
    harness.processor.process({
      sourceFile: harness.sourceFile,
      inputFile: { type: "html" },
      outputFiles: harness.outputFiles,
      tempDirs: harness.tempDirs,
      region: "ap-south-1",
      s3Service: {},
      processAndUpload: harness.processAndUpload,
      convertAndUpload: async () => assert.fail("mixed HTML outputs must use the report workflow"),
      headerElements: [],
    }),
    /export conversion failed/
  );

  assert.equal(harness.uploads.length, 0);
});
