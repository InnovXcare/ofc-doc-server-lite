const os = require("os");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const TEMP_PREFIX = "FILE_CONVERT";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 30000;

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
  fs.mkdirSync(sourceDir);
  const resultDir = path.join(newTemp, "result");
  fs.mkdirSync(resultDir);

  // Set proper permissions
  fs.chmodSync(newTemp, 0o755);
  fs.chmodSync(sourceDir, 0o755);
  fs.chmodSync(resultDir, 0o755);

  return { temp: newTemp, source: sourceDir, result: resultDir };
}

// Helper function to check if string is a URL
function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
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

  // Set default values if not provided
  return {
    async: true,
    url: params.url || "/var/task/samples/sampleDoc.docx",
    outputType: params.outputType || "pdf",
    filetype: params.filetype || "docx",
    title: params.title || "converted_file",
    key: params.key || "lambda_" + Date.now(),
    password: params.password || null,
    region: params.region || "en",
    fromChanges: params.fromChanges || false,
    includeBase64: params.includeBase64 || false,
    ...params,
  };
}

async function downloadFileWithAxios(url, outputPath) {
  try {
    console.log(`Starting download from: ${url}`);

    const response = await axios({
      method: "GET",
      url: url,
      responseType: "stream",
      timeout: DOWNLOAD_TIMEOUT,
      maxContentLength: MAX_FILE_SIZE,
      maxBodyLength: MAX_FILE_SIZE,
      headers: {
        "User-Agent": "OnlyOffice-Doc-Server-Lite/1.0",
      },
    });

    // Check content length
    const contentLength = parseInt(response.headers["content-length"] || "0");
    if (contentLength > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${contentLength} bytes (max: ${MAX_FILE_SIZE})`
      );
    }

    console.log(`Content-Length: ${contentLength} bytes`);

    // Create write stream
    const writer = fs.createWriteStream(outputPath);

    // Track downloaded bytes
    let downloadedBytes = 0;

    response.data.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_FILE_SIZE) {
        writer.destroy();
        fs.unlinkSync(outputPath).catch(() => {});
        throw new Error(`File too large: exceeded ${MAX_FILE_SIZE} bytes`);
      }
    });

    // Pipe the response to file
    response.data.pipe(writer);

    // Return a promise that resolves when download is complete
    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`Download completed: ${downloadedBytes} bytes`);
        resolve();
      });

      writer.on("error", (err) => {
        fs.unlinkSync(outputPath).catch(() => {});
        reject(new Error(`Write error: ${err.message}`));
      });

      response.data.on("error", (err) => {
        writer.destroy();
        fs.unlinkSync(outputPath).catch(() => {});
        reject(new Error(`Download error: ${err.message}`));
      });
    });
  } catch (error) {
    // Clean up file if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath).catch(() => {});
    }

    if (error.code === "ECONNABORTED") {
      throw new Error(`Download timeout after ${DOWNLOAD_TIMEOUT}ms`);
    } else if (error.response) {
      throw new Error(
        `HTTP ${error.response.status}: ${error.response.statusText}`
      );
    } else if (error.request) {
      throw new Error(`Network error: ${error.message}`);
    } else {
      throw new Error(`Download error: ${error.message}`);
    }
  }
}

exports.createTempDir = createTempDir;
exports.isUrl = isUrl;
exports.extractParams = extractParamsFromEvent;
exports.downloadFile = downloadFileWithAxios;
