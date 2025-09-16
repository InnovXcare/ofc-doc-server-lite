const co = require("co");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Import required modules from OnlyOffice
const operationContext = require("/var/runtime/server/Common/sources/operationContext");
const utils = require("/var/runtime/server/Common/sources/utils");
const formatChecker = require("/var/runtime/server/Common/sources/formatchecker");
const constants = require("/var/runtime/server/DocService/sources/constants");
const commonDefines = require("/var/runtime/server/DocService/sources/commondefines");
const utilsDocService = require("/var/runtime/server/DocService/sources/utilsDocService");
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
const cfgRequesFilteringAgent = config.util.cloneDeep(
  config.get("services.CoAuthoring.request-filtering-agent")
);
const cfgExternalRequestDirectIfIn = config.get("externalRequest.directIfIn");
const cfgExternalRequestAction = config.get("externalRequest.action");
const cfgSpawnOptions = config.util.cloneDeep(
  config.get("FileConverter.converter.spawnOptions")
);

const TEMP_PREFIX = "FILE_CONVERT";
let inputLimitsXmlCache;

// Lambda handler function
exports.handler = async (event, context) => {
  console.log("Lambda event:", JSON.stringify(event, null, 2));

  return co(function* () {
    let ctx = new operationContext.Context();
    ctx.logger.info("Lambda event:", JSON.stringify(event, null, 2));
    ctx.logger.info("Current working directory:", process.cwd());
    ctx.logger.info("Directory contents:", fs.readdirSync(process.cwd()));

    ctx.logger.info(
      "Checking if samples directory exists:",
      fs.existsSync("/var/task/samples")
    );
    if (fs.existsSync("/var/task/samples")) {
      ctx.logger.info(
        "samples directory contents:",
        fs.readdirSync("/var/task/samples")
      );
    }

    try {
      // Initialize context for Lambda (without Express req)
      ctx.initDefault();
      yield ctx.initTenantCache();
      ctx.logger.info("Lambda convertRequest start");

      // Extract parameters from Lambda event
      let params = extractParamsFromEvent(event);

      // Validate parameters
      let filetype = params.filetype || params.fileType || "";
      let outputType = params.outputType || params.outputType || "";
      ctx.setDocId(params.key);

      if (filetype && !constants.EXTENTION_REGEX.test(filetype)) {
        ctx.logger.warn("convertRequest unexpected filetype = %s", filetype);
        throw new Error(`Invalid filetype: ${filetype}`);
      }

      let outputFormat =
        outputType === "bin"
          ? constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD
          : formatChecker.getFormatFromString(outputType);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        ctx.logger.warn(
          "convertRequest unexpected outputType = %s",
          outputType
        );
        throw new Error(`Invalid outputType: ${outputType}`);
      }
      // Create command
      let docId = "conv_" + params.key + "_" + outputFormat;
      var cmd = new commonDefines.InputCommand();
      cmd.setCommand("save");
      cmd.setUrl(params.url);
      cmd.setEmbeddedFonts(false);
      cmd.setFormat(filetype);
      cmd.setDocId(docId);
      cmd.setOutputFormat(outputFormat);

      let outputExt = formatChecker.getStringFromFormat(cmd.getOutputFormat());

      if (params.region) {
        cmd.setLCID(utilsDocService.localeToLCID(params.region));
      }

      if (params.title) {
        cmd.setTitle(
          path.basename(params.title, path.extname(params.title)) +
            "." +
            outputExt
        );
      }

      cmd.setWithAuthorization(true);

      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== cmd.getOutputFormat()) {
        let fileTo = constants.OUTPUT_NAME + "." + outputExt;

        // Execute the conversion task
        const resData = yield* ExecuteTask(ctx, {
          cmd,
          fileTo,
          fromChanges: params?.fromChanges,
        });
        ctx.logger.info("REACHED_HERE", resData);

        console.log("Conversion result:", resData);

        // Return success response
        return {
          statusCode: 200,
          body: JSON.stringify({
            error: 0,
            message: "Conversion completed successfully",
            data: resData,
          }),
        };
      } else {
        ctx.logger.warn("Error convert unknown outputType: %j", params);
        throw new Error("Unknown output type");
      }
    } catch (e) {
      ctx.logger.error("Lambda convertRequest error: %s", e.stack);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 1,
          message: "Conversion failed",
          details: e.message,
        }),
      };
    } finally {
      ctx.logger.info("Lambda convertRequest end");
    }
  });
};

// Extracting parameters from Lambda event
function extractParamsFromEvent(event) {
  // Handle different event sources (API Gateway, direct invocation, etc.)
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
    url: params.url || path.join(__dirname, "../samples/testwithchanges.bin"),
    outputType: params.outputType || "docx",
    filetype: params.filetype || "bin",
    title: params.title || "converted_file",
    key: params.key || "lambda_" + Date.now(),
    password: params.password || null,
    region: params.region || "en",
    fromChanges: params.fromChanges || false,
    ...params,
  };
}

function TaskQueueDataConvert(ctx, execObj) {
  let { cmd, fromChanges } = execObj;
  this.key = cmd.getDocId();
  if (cmd.getSaveKey()) {
    this.key += cmd.getSaveKey();
  }
  this.fileFrom = null;
  this.fileTo = null;
  this.title = cmd.getTitle();
  if (
    constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA !== cmd.getOutputFormat()
  ) {
    this.formatTo = cmd.getOutputFormat();
  } else {
    this.formatTo = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
    this.isPDFA = true;
  }
  this.csvTxtEncoding = cmd.getCodepage();
  this.csvDelimiter = cmd.getDelimiter();
  this.csvDelimiterChar = cmd.getDelimiterChar();
  this.paid = true;
  this.embeddedFonts = cmd.embeddedfonts;
  this.fromChanges = fromChanges;

  const tenFontDir = ctx.getCfg("FileConverter.converter.fontDir", cfgFontDir);
  if (tenFontDir) {
    this.fontDir = path.resolve(tenFontDir);
  } else {
    this.fontDir = null;
  }
  const tenPresentationThemesDir = ctx.getCfg(
    "FileConverter.converter.presentationThemesDir",
    cfgPresentationThemesDir
  );
  this.themeDir = path.resolve(tenPresentationThemesDir);
  this.mailMergeSend = cmd.mailmergesend;
  this.thumbnail = cmd.thumbnail;
  this.textParams = cmd.getTextParams();
  this.jsonParams = JSON.stringify(cmd.getJsonParams());
  this.lcid = cmd.getLCID();
  this.password = cmd.getPassword();
  this.savePassword = cmd.getSavePassword();
  this.noBase64 = cmd.getNoBase64();
  this.convertToOrigin = cmd.getConvertToOrigin();
  this.oformAsPdf = cmd.getOformAsPdf();
  this.timestamp = new Date();
}

// Add all the prototype methods from your standalone1.js
TaskQueueDataConvert.prototype = {
  serialize: function (ctx, fsPath) {
    let xml = '\ufeff<?xml version="1.0" encoding="utf-8"?>';
    xml +=
      '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
    xml += ' xmlns:xsd="http://www.w3.org/2001/XMLSchema">';
    xml += this.serializeXmlProp("m_sKey", this.key);
    xml += this.serializeXmlProp("m_sFileFrom", this.fileFrom);
    xml += this.serializeXmlProp("m_sFileTo", this.fileTo);
    xml += this.serializeXmlProp("m_sTitle", this.title);
    xml += this.serializeXmlProp("m_nFormatTo", this.formatTo);
    xml += this.serializeXmlProp("m_bIsPDFA", this.isPDFA);
    xml += this.serializeXmlProp("m_nCsvTxtEncoding", this.csvTxtEncoding);
    xml += this.serializeXmlProp("m_nCsvDelimiter", this.csvDelimiter);
    xml += this.serializeXmlProp("m_nCsvDelimiterChar", this.csvDelimiterChar);
    xml += this.serializeXmlProp("m_bPaid", this.paid);
    xml += this.serializeXmlProp("m_bEmbeddedFonts", this.embeddedFonts);
    xml += this.serializeXmlProp("m_bFromChanges", this.fromChanges);
    xml += this.serializeXmlProp("m_sFontDir", this.fontDir);
    xml += this.serializeXmlProp("m_sThemeDir", this.themeDir);
    if (this.mailMergeSend) {
      xml += this.serializeMailMerge(this.mailMergeSend);
    }
    if (this.thumbnail) {
      xml += this.serializeThumbnail(this.thumbnail);
    }
    if (this.textParams) {
      xml += this.serializeTextParams(this.textParams);
    }
    xml += this.serializeXmlProp("m_sJsonParams", this.jsonParams);
    xml += this.serializeXmlProp("m_nLcid", this.lcid);
    xml += this.serializeXmlProp("m_oTimestamp", this.timestamp.toISOString());
    xml += this.serializeXmlProp("m_bIsNoBase64", this.noBase64);
    xml += this.serializeXmlProp("m_sConvertToOrigin", this.convertToOrigin);
    xml += this.serializeLimit(ctx);
    xml += this.serializeOptions(ctx, false, this.oformAsPdf);
    xml += "</TaskQueueDataConvert>";
    fs.writeFileSync(fsPath, xml, { encoding: "utf8" });
  },

  serializeHidden: function (ctx) {
    var t = this;
    return co(function* () {
      let xml;
      if (t.password || t.savePassword) {
        xml = "<TaskQueueDataConvert>";
        if (t.password) {
          let password = yield utils.decryptPassword(ctx, t.password);
          xml += t.serializeXmlProp("m_sPassword", password);
        }
        if (t.savePassword) {
          let savePassword = yield utils.decryptPassword(ctx, t.savePassword);
          xml += t.serializeXmlProp("m_sSavePassword", savePassword);
        }
        xml += "</TaskQueueDataConvert>";
      }
      return xml;
    });
  },

  serializeOptions: function (ctx, isInJwtToken, oformAsPdf) {
    const tenRequesFilteringAgent = ctx.getCfg(
      "services.CoAuthoring.request-filtering-agent",
      cfgRequesFilteringAgent
    );
    const tenExternalRequestDirectIfIn = ctx.getCfg(
      "externalRequest.directIfIn",
      cfgExternalRequestDirectIfIn
    );
    const tenExternalRequestAction = ctx.getCfg(
      "externalRequest.action",
      cfgExternalRequestAction
    );
    let allowList = tenExternalRequestDirectIfIn.allowList;
    let allowNetworkRequest = tenExternalRequestAction.allow;
    let allowPrivateIP =
      !tenExternalRequestAction.blockPrivateIP &&
      tenRequesFilteringAgent.allowPrivateIPAddress;
    let proxyUrl = tenExternalRequestAction.proxyUrl;
    let proxyUser = tenExternalRequestAction.proxyUser;
    let proxyHeaders = tenExternalRequestAction.proxyHeaders;
    if (
      allowList.length === 0 &&
      tenExternalRequestDirectIfIn.jwtToken &&
      isInJwtToken
    ) {
      allowNetworkRequest = true;
      allowPrivateIP = true;
      proxyUrl = "";
      proxyUser = null;
      proxyHeaders = {};
    }
    let xml = "";
    xml += "<options>";
    if (allowList.length > 0) {
      xml += this.serializeXmlProp("allowList", allowList.join(";"));
    }
    xml += this.serializeXmlProp("allowNetworkRequest", allowNetworkRequest);
    xml += this.serializeXmlProp("allowPrivateIP", allowPrivateIP);
    if (proxyUrl) {
      xml += this.serializeXmlProp("proxy", proxyUrl);
    }
    if (proxyUser) {
      let user = proxyUser.username;
      let pass = proxyUser.password;
      xml += this.serializeXmlProp("proxyUser", `${user}:${pass}`);
    }
    let proxyHeadersStr = [];
    for (let name in proxyHeaders) {
      proxyHeadersStr.push(`${name}:${proxyHeaders[name]}`);
    }
    if (proxyHeadersStr.length > 0) {
      xml += this.serializeXmlProp("proxyHeader", proxyHeadersStr.join(";"));
    }
    if (undefined !== oformAsPdf) {
      xml += this.serializeXmlProp("oformAsPdf", oformAsPdf);
    }
    xml += "</options>";
    return xml;
  },

  serializeLimit: function (ctx) {
    if (!inputLimitsXmlCache) {
      var xml = "<m_oInputLimits>";
      const tenInputLimits = ctx.getCfg(
        "FileConverter.converter.inputLimits",
        cfgInputLimits
      );
      for (let i = 0; i < tenInputLimits.length; ++i) {
        let limit = tenInputLimits[i];
        if (limit.type && limit.zip) {
          xml += "<m_oInputLimit";
          xml += this.serializeXmlAttr("type", limit.type);
          xml += ">";
          xml += "<m_oZip";
          if (limit.zip.compressed) {
            xml += this.serializeXmlAttr(
              "compressed",
              bytes.parse(limit.zip.compressed)
            );
          }
          if (limit.zip.uncompressed) {
            xml += this.serializeXmlAttr(
              "uncompressed",
              bytes.parse(limit.zip.uncompressed)
            );
          }
          xml += this.serializeXmlAttr("template", limit.zip.template);
          xml += "/>";
          xml += "</m_oInputLimit>";
        }
      }
      xml += "</m_oInputLimits>";
      inputLimitsXmlCache = xml;
    }
    return inputLimitsXmlCache;
  },

  serializeXmlProp: function (name, value) {
    var xml = "";
    if (null != value) {
      xml += "<" + name + ">";
      xml += utils.encodeXml(value.toString());
      xml += "</" + name + ">";
    } else {
      xml += "<" + name + ' xsi:nil="true" />';
    }
    return xml;
  },

  serializeXmlAttr: function (name, value) {
    var xml = "";
    if (null != value) {
      xml += " " + name + '="';
      xml += utils.encodeXml(value.toString());
      xml += '"';
    }
    return xml;
  },
};

function getTempDir() {
  var tempDir = os.tmpdir();
  var now = new Date();
  var newTemp;
  while (!newTemp || fs.existsSync(newTemp)) {
    var newName = [
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
  var sourceDir = path.join(newTemp, "source");
  fs.mkdirSync(sourceDir);
  var resultDir = path.join(newTemp, "result");
  fs.mkdirSync(resultDir);
  return { temp: newTemp, source: sourceDir, result: resultDir };
}

function checkPathTraversal(ctx, docId, rootDirectory, filename) {
  if (filename.indexOf("\0") !== -1) {
    console.warn("checkPathTraversal Poison Null Bytes filename=%s", filename);
    return false;
  }
  if (!filename.startsWith(rootDirectory)) {
    console.warn("checkPathTraversal Path Traversal filename=%s", filename);
    return false;
  }
  return true;
}

function downloadFile(ctx, url, dataConvert) {
  const { fileFrom } = dataConvert;
  let res = constants.NO_ERROR;
  console.log("fileFrom:::", fileFrom);
  if (!fs.existsSync(fileFrom)) {
    fs.copyFileSync(url, fileFrom);
  }
  return res;
}

function uploadFile(ctx, url, dataConvert) {
  const { fileTo, title } = dataConvert;
  let res = constants.NO_ERROR;
  if (url) {
    const dest = path.join(path.dirname(url), title);
    console.log("fileto:::", fileTo, dest);
    fs.copyFileSync(fileTo, dest);
  }
  return res;
}

// Your ExecuteTask function
function* ExecuteTask(ctx, execObj) {
  var resData;
  var url;
  var tempDirs;
  var getTaskTime = new Date();
  let { cmd, fileTo, fromChanges } = execObj;
  var dataConvert = new TaskQueueDataConvert(ctx, execObj);
  var error = constants.NO_ERROR;
  tempDirs = getTempDir();
  dataConvert.fileTo = fileTo ? path.join(tempDirs.result, fileTo) : "";
  let builderParams = cmd.getBuilderParams();
  let authorProps = { lastModifiedBy: null, modified: null };
  let isInJwtToken = cmd.getWithAuthorization();

  if (cmd.getUrl()) {
    let format = cmd.getFormat();
    dataConvert.fileFrom = path.join(
      tempDirs.source,
      dataConvert.key + "." + format
    );
    if (
      checkPathTraversal(
        ctx,
        dataConvert.key,
        tempDirs.source,
        dataConvert.fileFrom
      )
    ) {
      url = cmd.getUrl();

      let withAuthorization = cmd.getWithAuthorization();
      let headers;
      let fileSize;

      if (undefined === fileSize || fileSize > 0) {
        error = downloadFile(
          ctx,
          url,
          dataConvert,
          withAuthorization,
          isInJwtToken,
          headers
        );
        console.log("after download", error, constants.NO_ERROR);
      }
    } else {
      error = constants.CONVERT_PARAMS;
    }
  } else if (builderParams) {
    ctx.logger.info("BUILDER_PARAMS", builderParams);
    console.debug("downloadFileFromStorage complete");
    downloadFile(ctx, url, dataConvert);
  } else {
    ctx.logger.info("Setting error to unknowm");
    error = constants.UNKNOWN;
  }

  if (fromChanges) {
    const changeFileName = "changes0.json";
    const changeFilesFrom = path.join(path.dirname(url), changeFileName);
    const changeFilesToOutDir = path.join(tempDirs.source, "changes");
    fs.mkdirSync(changeFilesToOutDir);
    const changeFilesTo = path.join(changeFilesToOutDir, changeFileName);
    if (!fs.existsSync(changeFilesTo)) {
      fs.copyFileSync(changeFilesFrom, changeFilesTo);
    }
  }

  let childRes = null;
  let isTimeout = false;
  if (constants.NO_ERROR === error) {
    ({ childRes, isTimeout } = yield* spawnProcess(
      ctx,
      builderParams,
      tempDirs,
      dataConvert,
      authorProps,
      getTaskTime,
      {},
      isInJwtToken
    ));
  }
  uploadFile(ctx, url, dataConvert);
  if (tempDirs) {
    fs.rmSync(tempDirs.temp, { recursive: true, force: true });
    ctx.logger.debug("deleteFolderRecursive");
  }
  return { childRes, isTimeout };
}

// Your spawnProcess function
function* spawnProcess(
  ctx,
  builderParams,
  tempDirs,
  dataConvert,
  authorProps,
  getTaskTime,
  task,
  isInJwtToken
) {
  const tenX2tPath = ctx.getCfg("FileConverter.converter.x2tPath", cfgX2tPath);
  const tenDocbuilderPath = ctx.getCfg(
    "FileConverter.converter.docbuilderPath",
    cfgDocbuilderPath
  );
  const tenArgs = ctx.getCfg("FileConverter.converter.args", cfgArgs);
  console.log("spawnProcess::", {
    tenX2tPath,
    tenDocbuilderPath,
    builderParams,
    tempDirs,
    dataConvert,
    authorProps,
    getTaskTime,
    task,
    isInJwtToken,
  });
  let childRes,
    isTimeout = false;
  let childArgs;
  if (tenArgs.length > 0) {
    childArgs = tenArgs.trim().replace(/  +/g, " ").split(" ");
  } else {
    childArgs = [];
  }
  let processPath;
  if (!builderParams) {
    processPath = tenX2tPath;
    let paramsFile = path.join(tempDirs.temp, "params.xml");
    dataConvert.serialize(ctx, paramsFile);
    childArgs.push(paramsFile);
    let hiddenXml = yield dataConvert.serializeHidden(ctx);
    if (hiddenXml) {
      childArgs.push(hiddenXml);
    }
  } else {
    fs.mkdirSync(path.join(tempDirs.result, "output"));
    processPath = tenDocbuilderPath;
    childArgs.push("--check-fonts=0");
    childArgs.push("--save-use-only-names=" + tempDirs.result + "/output");
    if (builderParams.argument) {
      childArgs.push(`--argument=${JSON.stringify(builderParams.argument)}`);
    }
    childArgs.push(
      "--options=" + dataConvert.serializeOptions(ctx, isInJwtToken)
    );
    childArgs.push(dataConvert.fileFrom);
  }
  let timeoutId;
  try {
    const tenSpawnOptions = ctx.getCfg(
      "FileConverter.converter.spawnOptions",
      cfgSpawnOptions
    );
    let spawnOptions = Object.assign({}, tenSpawnOptions);
    spawnOptions.env = Object.assign({}, process.env, spawnOptions.env);
    if (authorProps.lastModifiedBy && authorProps.modified) {
      spawnOptions.env["LAST_MODIFIED_BY"] = authorProps.lastModifiedBy;
      spawnOptions.env["MODIFIED"] = authorProps.modified;
    }
    console.log("spawnAsyncPromise::", {
      processPath,
      childArgs,
      spawnOptions,
    });
    let spawnAsyncPromise = spawnAsync(processPath, childArgs, spawnOptions);
    childRes = spawnAsyncPromise.child;
    childRes = yield spawnAsyncPromise;
    console.log("childRes::", childRes);
  } catch (err) {
    console.log("spawnAsyncPromise:err:::", err);
    if (null === err.status) {
      console.error("error spawnAsync %s", err.stack);
    } else {
      console.debug("error spawnAsync %s", err.stack);
    }
    childRes = err;
  }
  if (undefined !== timeoutId) {
    clearTimeout(timeoutId);
  }
  return { childRes: childRes, isTimeout: isTimeout };
}
