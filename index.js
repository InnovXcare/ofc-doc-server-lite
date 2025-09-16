const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");

const utils = require("./resources/utils");
const formatChecker = require("./resources/formatchecker");
const constants = require("./resources/constants");
const utilsDocService = require("./resources/utilsDocService");
const spawnAsync = require("@expo/spawn-async");
const config = require("config");
const bytes = require("bytes");

// Configuration
const cfgFontDir = config.get("FileConverter.converter.fontDir");
const cfgX2tPath = config.get("FileConverter.converter.x2tPath");
const cfgPresentationThemesDir = config.get(
  "FileConverter.converter.presentationThemesDir"
);
const cfgDocbuilderPath = config.get("FileConverter.converter.docbuilderPath");
const cfgArgs = config.get("FileConverter.converter.args");
const cfgInputLimits = config.get("FileConverter.converter.inputLimits");
const cfgSpawnOptions = config.util.cloneDeep(
  config.get("FileConverter.converter.spawnOptions")
);

const TEMP_PREFIX = "FILE_CONVERT";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
const DOWNLOAD_TIMEOUT = 30000; // 30 seconds

let inputLimitsXmlCache;

function debugFileInfo(filePath, description) {
  console.log(`=== ${description} ===`);
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`File exists: ${filePath}`);
      console.log(`Size: ${stats.size} bytes`);
      console.log(`Modified: ${stats.mtime}`);

      // Check if it's a valid file by trying to read first few bytes
      const buffer = fs.readFileSync(filePath, { start: 0, end: 10 });
    } else {
      console.log(`File does not exist: ${filePath}`);
    }
  } catch (error) {
    console.log(`Error checking file ${filePath}:`, error.message);
  }
  console.log("==================");
}

// Simplified Lambda handler function
exports.handler = async (event, context) => {
  console.log("Lambda event:", JSON.stringify(event, null, 2));

  try {
    // Extract parameters from Lambda event
    const params = extractParamsFromEvent(event);
    console.log("Extracted params:", params);

    // Validate input parameters
    const filetype = params.filetype || "docx";
    const outputType = params.outputType || "pdf";
    const inputSource = params.url || "/var/task/samples/sampleDoc.docx";
    const key = params.key || `lambda_${Date.now()}`;

    // Validate file types
    if (filetype && !constants.EXTENTION_REGEX.test(filetype)) {
      throw new Error(`Invalid filetype: ${filetype}`);
    }

    const outputFormat =
      outputType === "bin"
        ? constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD
        : formatChecker.getFormatFromString(outputType);

    if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
      throw new Error(`Invalid outputType: ${outputType}`);
    }

    const outputExt = formatChecker.getStringFromFormat(outputFormat);
    console.log(`Converting ${filetype} to ${outputExt}`);

    // Create temporary directories
    const tempDirs = createTempDir();
    console.log("Temp directories:", tempDirs);

    try {
      // Prepare file paths
      const sourceFile = path.join(tempDirs.source, `${key}.${filetype}`);
      const outputFile = path.join(tempDirs.result, `output.${outputExt}`);
      const finalOutputPath = path.join(
        "/tmp",
        `converted_file_${key}.${outputExt}`
      );

      // Handle input file - either download from URL or copy local file
      if (isUrl(inputSource)) {
        console.log(`Downloading file from URL: ${inputSource}`);
        await downloadFileWithAxios(inputSource, sourceFile);
        console.log(`Downloaded file to: ${sourceFile}`);
      } else {
        // Local file path
        if (fs.existsSync(inputSource)) {
          fs.copyFileSync(inputSource, sourceFile);
          console.log(`Copied input file: ${inputSource} -> ${sourceFile}`);
        } else {
          throw new Error(`Input file not found: ${inputSource}`);
        }
      }

      // Debug files
      debugFileInfo(inputSource, "Input Source");
      debugFileInfo(sourceFile, "Copied Source File");

      // Verify file exists and has content
      if (!fs.existsSync(sourceFile)) {
        throw new Error("Source file not found after processing");
      }

      const fileStats = fs.statSync(sourceFile);
      if (fileStats.size === 0) {
        throw new Error("Source file is empty");
      }

      console.log(`Source file size: ${fileStats.size} bytes`);

      // Create TaskQueueDataConvert object (like the original)
      const dataConvert = createTaskQueueDataConvert({
        key,
        sourceFile,
        outputFile,
        outputFormat,
        fontDir: cfgFontDir,
        themeDir: cfgPresentationThemesDir,
        lcid: params.region
          ? utilsDocService.localeToLCID(params.region)
          : null,
        fromChanges: params.fromChanges || false,
      });

      // Serialize to params.xml
      const paramsFile = path.join(tempDirs.temp, "params.xml");
      const paramsXml = serializeTaskQueueDataConvert(dataConvert);
      fs.writeFileSync(paramsFile, paramsXml, { encoding: "utf8" });
      console.log(`Created params file: ${paramsFile}`);
      console.log("Params XML content:");
      console.log(paramsXml);

      // Prepare spawn arguments (exactly like original)
      const processPath = cfgX2tPath;
      let childArgs = [];

      if (cfgArgs.length > 0) {
        childArgs = cfgArgs.trim().replace(/  +/g, " ").split(" ");
      }
      childArgs.push(paramsFile);

      // Prepare spawn options (exactly like original)
      let spawnOptions = Object.assign({}, cfgSpawnOptions);
      spawnOptions.env = Object.assign({}, process.env, spawnOptions.env, {
        LD_LIBRARY_PATH: "/var/runtime/lib:/var/runtime/lib64",
        FONTCONFIG_PATH: "/var/runtime/core-fonts",
        HOME: "/tmp",
        TMPDIR: "/tmp",
        PATH:
          process.env.PATH +
          ":/var/runtime/documentserver/server/FileConverter/bin",
      });

      console.log("Spawn config:", {
        processPath,
        childArgs,
        spawnOptions,
      });

      // Debug the x2t binary
      debugFileInfo(processPath, "x2t Binary");

      // Execute x2t conversion directly
      console.log("Starting x2t conversion...");
      const result = await spawnAsync(processPath, childArgs, spawnOptions);

      console.log("x2t conversion completed:", {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      // Check if conversion was successful (like original)
      if (result.status !== 0 && result.status !== null) {
        throw new Error(
          `x2t conversion failed with status ${result.status}. stderr: ${result.stderr}`
        );
      }

      if (result.signal !== null) {
        throw new Error(
          `x2t conversion killed with signal ${result.signal}. stderr: ${result.stderr}`
        );
      }

      // Check if output file was created
      if (!fs.existsSync(outputFile)) {
        throw new Error(`Output file was not created: ${outputFile}`);
      }

      // Copy output file to final location
      fs.copyFileSync(outputFile, finalOutputPath);
      console.log(`Output file copied to: ${finalOutputPath}`);

      // Get file stats for response
      const outputStats = fs.statSync(finalOutputPath);

      // Optionally encode the output file as base64 for response
      const includeBase64 = params.includeBase64 === true;
      let base64Content = null;

      if (includeBase64) {
        const fileBuffer = fs.readFileSync(finalOutputPath);
        base64Content = fileBuffer.toString("base64");
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          error: 0,
          message: "Conversion completed successfully",
          data: {
            outputPath: finalOutputPath,
            outputSize: outputStats.size,
            outputType: outputExt,
            processingTime:
              Date.now() - parseInt(key.split("_")[1] || Date.now()),
            sourceFileSize: fileStats.size,
            base64Content: base64Content,
          },
        }),
      };
    } finally {
      // Cleanup temp directories
      if (tempDirs && fs.existsSync(tempDirs.temp)) {
        fs.rmSync(tempDirs.temp, { recursive: true, force: true });
        console.log("Cleaned up temp directory");
      }
    }
  } catch (error) {
    console.error("Lambda conversion error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 1,
        message: "Conversion failed",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      }),
    };
  }
};

// Create TaskQueueDataConvert object (like original)
function createTaskQueueDataConvert(options) {
  const {
    key,
    sourceFile,
    outputFile,
    outputFormat,
    fontDir,
    themeDir,
    lcid,
    fromChanges,
  } = options;

  return {
    key: key,
    fileFrom: sourceFile,
    fileTo: outputFile,
    title: null,
    formatTo: outputFormat,
    isPDFA: false,
    csvTxtEncoding: null,
    csvDelimiter: null,
    csvDelimiterChar: null,
    paid: true,
    embeddedFonts: false,
    fromChanges: fromChanges || false,
    fontDir: fontDir ? path.resolve(fontDir) : null,
    themeDir: themeDir ? path.resolve(themeDir) : null,
    mailMergeSend: null,
    thumbnail: null,
    textParams: null,
    jsonParams: "{}",
    lcid: lcid,
    password: null,
    savePassword: null,
    noBase64: false,
    convertToOrigin: null,
    oformAsPdf: null,
    timestamp: new Date(),
  };
}

// Serialize TaskQueueDataConvert (exactly like original)
function serializeTaskQueueDataConvert(dataConvert) {
  let xml = '\ufeff<?xml version="1.0" encoding="utf-8"?>';
  xml +=
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
  xml += ' xmlns:xsd="http://www.w3.org/2001/XMLSchema">';
  xml += serializeXmlProp("m_sKey", dataConvert.key);
  xml += serializeXmlProp("m_sFileFrom", dataConvert.fileFrom);
  xml += serializeXmlProp("m_sFileTo", dataConvert.fileTo);
  xml += serializeXmlProp("m_sTitle", dataConvert.title);
  xml += serializeXmlProp("m_nFormatTo", dataConvert.formatTo);
  xml += serializeXmlProp("m_bIsPDFA", dataConvert.isPDFA);
  xml += serializeXmlProp("m_nCsvTxtEncoding", dataConvert.csvTxtEncoding);
  xml += serializeXmlProp("m_nCsvDelimiter", dataConvert.csvDelimiter);
  xml += serializeXmlProp("m_nCsvDelimiterChar", dataConvert.csvDelimiterChar);
  xml += serializeXmlProp("m_bPaid", dataConvert.paid);
  xml += serializeXmlProp("m_bEmbeddedFonts", dataConvert.embeddedFonts);
  xml += serializeXmlProp("m_bFromChanges", dataConvert.fromChanges);
  xml += serializeXmlProp("m_sFontDir", dataConvert.fontDir);
  xml += serializeXmlProp("m_sThemeDir", dataConvert.themeDir);
  xml += serializeXmlProp("m_sJsonParams", dataConvert.jsonParams);
  xml += serializeXmlProp("m_nLcid", dataConvert.lcid);
  xml += serializeXmlProp("m_oTimestamp", dataConvert.timestamp.toISOString());
  xml += serializeXmlProp("m_bIsNoBase64", dataConvert.noBase64);
  xml += serializeXmlProp("m_sConvertToOrigin", dataConvert.convertToOrigin);
  xml += serializeLimit();
  xml += serializeOptions();
  xml += "</TaskQueueDataConvert>";
  return xml;
}

function serializeXmlProp(name, value) {
  var xml = "";
  if (null != value) {
    xml += "<" + name + ">";
    xml += utils.encodeXml(value.toString());
    xml += "</" + name + ">";
  } else {
    xml += "<" + name + ' xsi:nil="true" />';
  }
  return xml;
}

function serializeLimit() {
  if (!inputLimitsXmlCache) {
    var xml = "<m_oInputLimits>";
    for (let i = 0; i < cfgInputLimits.length; ++i) {
      let limit = cfgInputLimits[i];
      if (limit.type && limit.zip) {
        xml += "<m_oInputLimit";
        xml += serializeXmlAttr("type", limit.type);
        xml += ">";
        xml += "<m_oZip";
        if (limit.zip.compressed) {
          xml += serializeXmlAttr(
            "compressed",
            bytes.parse(limit.zip.compressed)
          );
        }
        if (limit.zip.uncompressed) {
          xml += serializeXmlAttr(
            "uncompressed",
            bytes.parse(limit.zip.uncompressed)
          );
        }
        xml += serializeXmlAttr("template", limit.zip.template);
        xml += "/>";
        xml += "</m_oInputLimit>";
      }
    }
    xml += "</m_oInputLimits>";
    inputLimitsXmlCache = xml;
  }
  return inputLimitsXmlCache;
}

function serializeOptions() {
  let xml = "<options>";
  xml += serializeXmlProp("allowNetworkRequest", true);
  xml += serializeXmlProp("allowPrivateIP", false);
  xml += "</options>";
  return xml;
}

function serializeXmlAttr(name, value) {
  var xml = "";
  if (null != value) {
    xml += " " + name + '="';
    xml += utils.encodeXml(value.toString());
    xml += '"';
  }
  return xml;
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

// Helper function to download file using axios
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

// Helper function to extract parameters from Lambda event
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

// Helper function to create temporary directories
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
