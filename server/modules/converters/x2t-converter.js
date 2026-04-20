const path = require("path");
const { promises: fs } = require("fs");
const spawnAsync = require("@expo/spawn-async");
const config = require("config");
const bytes = require("bytes");
const { encodeXml } = require("../../resources/utils");
const {
  BIN_PATH,
  LD_LIBRARY_PATH,
  XDG_CACHE_HOME_PATH,
  X2T_PATH,
  BIN_SPAWN_PATH,
} = require("../../resources/constants");

class X2TConverter {
  constructor() {
    this.x2tPath = config.get("FileConverter.converter.x2tPath") || X2T_PATH;
    this.args = config.get("FileConverter.converter.args");
    this.fontDir = config.get("FileConverter.converter.fontDir");
    this.presentationThemesDir = config.get(
      "FileConverter.converter.presentationThemesDir"
    );
    this.inputLimits = config.get("FileConverter.converter.inputLimits");
    this.spawnOptions = config.util.cloneDeep(
      config.get("FileConverter.converter.spawnOptions")
    );
    this.allowPrivateIP = config.has("FileConverter.converter.allowPrivateIP")
      ? config.get("FileConverter.converter.allowPrivateIP") !== false
      : true;
  }

  // core function to convert

  async convert({
    sourceFile,
    outputFile,
    outputFormat,
    tempDir,
    key,
    lcid,
    fromChanges = false,
  }) {
    console.log("Starting X2T conversion...");

    // Creating conversion data
    const conversionData = {
      key,
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
      fromChanges: fromChanges ? true : false,
      fontDir: this.fontDir ? path.resolve(this.fontDir) : null,
      themeDir: this.presentationThemesDir
        ? path.resolve(this.presentationThemesDir)
        : null,
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
    // creating params file
    const paramsFile = path.join(tempDir, `params_${key}.xml`);
    const paramsXml = this.createParamsXml(conversionData);
    await fs.writeFile(paramsFile, paramsXml, { encoding: "utf8" });

    // preparing command arguments
    let childArgs = [];
    if (this.args && this.args.length > 0) {
      childArgs = this.args.trim().replace(/  +/g, " ").split(" ");
    }
    childArgs.push(paramsFile);

    // preparing spawn options
    const spawnOptions = Object.assign({}, this.spawnOptions);
    spawnOptions.env = Object.assign({}, process.env, spawnOptions.env, {
      LD_LIBRARY_PATH: LD_LIBRARY_PATH,
      PATH: process.env.PATH + BIN_SPAWN_PATH,
      NODE_ICU_DATA: BIN_PATH,
      XDG_CACHE_HOME: XDG_CACHE_HOME_PATH,
    });
    const result = await spawnAsync(this.x2tPath, childArgs, spawnOptions);

    // checking result
    if (result.status !== 0 && result.status !== null) {
      throw new Error(
        `X2T conversion failed with status ${result.status}. stderr: ${result.stderr}`
      );
    }

    if (result.signal !== null) {
      throw new Error(
        `X2T conversion killed with signal ${result.signal}. stderr: ${result.stderr}`
      );
    }
    console.log("X2T conversion completed successfully");
    return {
      success: true,
      converterType: "x2t",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  createParamsXml(data) {
    let xml = '\ufeff<?xml version="1.0" encoding="utf-8"?>';
    xml +=
      '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
    xml += ' xmlns:xsd="http://www.w3.org/2001/XMLSchema">';

    // Adding all properties - can be revamped later
    xml += this.xmlProp("m_sKey", data.key);
    xml += this.xmlProp("m_sFileFrom", data.fileFrom);
    xml += this.xmlProp("m_sFileTo", data.fileTo);
    xml += this.xmlProp("m_sTitle", data.title);
    xml += this.xmlProp("m_nFormatTo", data.formatTo);
    xml += this.xmlProp("m_bIsPDFA", data.isPDFA);
    xml += this.xmlProp("m_nCsvTxtEncoding", data.csvTxtEncoding);
    xml += this.xmlProp("m_nCsvDelimiter", data.csvDelimiter);
    xml += this.xmlProp("m_nCsvDelimiterChar", data.csvDelimiterChar);
    xml += this.xmlProp("m_bPaid", data.paid);
    xml += this.xmlProp("m_bEmbeddedFonts", data.embeddedFonts);
    xml += this.xmlProp("m_bFromChanges", data.fromChanges);
    xml += this.xmlProp("m_sFontDir", data.fontDir);
    xml += this.xmlProp("m_sThemeDir", data.themeDir);
    xml += this.xmlProp("m_sJsonParams", data.jsonParams);
    xml += this.xmlProp("m_nLcid", data.lcid);
    xml += this.xmlProp("m_oTimestamp", data.timestamp.toISOString());
    xml += this.xmlProp("m_bIsNoBase64", data.noBase64);
    xml += this.xmlProp("m_sConvertToOrigin", data.convertToOrigin);

    // Adding limits and options if rrequired
    xml += this.createLimitsXml();
    xml += "<options>";
    xml += this.xmlProp("allowNetworkRequest", true);
    // When changes still reference https:// image URLs, x2t downloads them; allow VPC / private endpoints.
    xml += this.xmlProp("allowPrivateIP", this.allowPrivateIP);
    xml += "</options>";

    xml += "</TaskQueueDataConvert>";
    return xml;
  }
  xmlProp(name, value) {
    if (value != null) {
      return `<${name}>${encodeXml(value.toString())}</${name}>`;
    } else {
      return `<${name} xsi:nil="true" />`;
    }
  }
  createLimitsXml() {
    let xml = "<m_oInputLimits>";
    for (let limit of this.inputLimits) {
      if (limit.type && limit.zip) {
        xml += `<m_oInputLimit type="${limit.type}">`;
        xml += "<m_oZip";
        if (limit.zip.compressed) {
          xml += ` compressed="${bytes.parse(limit.zip.compressed)}"`;
        }
        if (limit.zip.uncompressed) {
          xml += ` uncompressed="${bytes.parse(limit.zip.uncompressed)}"`;
        }
        xml += ` template="${limit.zip.template}"`;
        xml += "/>";
        xml += "</m_oInputLimit>";
      }
    }
    xml += "</m_oInputLimits>";
    return xml;
  }
}
module.exports = X2TConverter;
