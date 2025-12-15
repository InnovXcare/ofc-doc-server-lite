const os = require("os");
const fs = require("fs");
const path = require("path");

const TEMP_PREFIX = "FILE_CONVERT";

function createTempDir() {
  const tempDir = os.tmpdir();
  const now = new Date();
  let newTemp;

  while (!newTemp || fs.existsSync(newTemp)) {
    const newName = [
      TEMP_PREFIX,
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      "-",
      (Math.random() * 0x100000000 + 1).toString(36),
    ].join("");
    newTemp = path.join(tempDir, newName);
  }

  fs.mkdirSync(newTemp);
  const sourceDir = path.join(newTemp, "source");
  const changesDir = path.join(sourceDir, "changes");

  fs.mkdirSync(sourceDir);
  fs.mkdirSync(changesDir, { recursive: true });

  const resultDir = path.join(newTemp, "result");
  fs.mkdirSync(resultDir);

  // Setting proper permissions
  // 7 for owner, read write execute + 5 for group read execute + 5 for others rea dexecute
  fs.chmodSync(newTemp, 0o755);
  fs.chmodSync(sourceDir, 0o755);
  fs.chmodSync(resultDir, 0o755);

  return { temp: newTemp, source: sourceDir, result: resultDir };
}

// Helper function to extract params
function extractParamsFromEvent(event) {
  let params = {};

  if (event.body) {
    // API Gateway event
    try {
      params = JSON.parse(event.body);
    } catch (e) {
      params = event.queryStringParameters || {};
    }
  } else {
    // Direct Lambda invocation
    params = event;
  }
  return params;
}

exports.createTempDir = createTempDir;

exports.extractParams = extractParamsFromEvent;
