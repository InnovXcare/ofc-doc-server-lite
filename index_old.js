const path = require("path");
const fs = require("fs");

const {
  getFormatFromString,
  getStringFromFormat,
  localeToLCID,
  encodeXml,
} = require("./resources/utils");
const {
  createTempDir,
  extractParams,
  isUrl,
  downloadFile,
} = require("./resources/helpers");
const {
  EXTENTION_REGEX,
  AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
  AVS_OFFICESTUDIO_FILE_UNKNOWN,
} = require("./resources/constants");

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

let inputLimitsXmlCache;

// Simplified Lambda handler function
exports.handler = async (event, context) => {
  console.log("Lambda event:", JSON.stringify(event, null, 2));

  try {
    const params = extractParams(event);
    console.log("Extracted params:", params);

    // Validate input parameters
    const filetype = params.filetype || "docx";
    const outputType = params.outputType || "pdf";
    const inputSource = params.url || "/var/task/samples/sampleDoc.docx";
    const key = params.key || `lambda_${Date.now()}`;

    // Validate file types
    if (filetype && !EXTENTION_REGEX.test(filetype)) {
      throw new Error(`Invalid filetype: ${filetype}`);
    }

    const outputFormat =
      outputType === "bin"
        ? AVS_OFFICESTUDIO_FILE_CANVAS_WORD
        : getFormatFromString(outputType);

    if (AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
      throw new Error(`Invalid outputType: ${outputType}`);
    }

    const outputExt = getStringFromFormat(outputFormat);
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
        await downloadFile(inputSource, sourceFile);
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
        lcid: params.region ? localeToLCID(params.region) : null,
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
      //   const processPath = cfgDocbuilderPath;
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
    xml += encodeXml(value.toString());
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
    xml += encodeXml(value.toString());
    xml += '"';
  }
  return xml;
}
