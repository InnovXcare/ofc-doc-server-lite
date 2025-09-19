const path = require("path");
const fs = require("fs");
const X2TConverter = require("./x2tConverter");
const DocBuilderConverter = require("./docBuilderConverter");
const {
  getFormatFromString,
  getStringFromFormat,
  localeToLCID,
} = require("../resources/utils");
const { createTempDir, isUrl, downloadFile } = require("../resources/helpers");
const {
  EXTENTION_REGEX,
  AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
  AVS_OFFICESTUDIO_FILE_UNKNOWN,
} = require("../resources/constants");

class ConversionService {
  constructor() {
    this.x2tConverter = new X2TConverter();
    this.docBuilderConverter = new DocBuilderConverter();
  }

  /**
   * main conversion method
   */
  async convertFile(params) {
    const {
      filetype = "docx", // assuming default file format to docx
      outputType = "pdf", // assuming default putput file format to pdf
      inputSource,
      key = `conversion_${Date.now()}`,
      region,
      fromChanges = false,
      includeBase64 = false,
      converter = "x2t", // assuming default converter  x2t
    } = params;

    // Validating input
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
    console.log(`Converting ${filetype} to ${outputExt} using ${converter}`);

    // Creating temp directories
    const tempDirs = createTempDir();

    try {
      // Setting file paths
      const sourceFile = path.join(tempDirs.source, `${key}.${filetype}`);
      const outputFile = path.join(tempDirs.result, `output.${outputExt}`);
      const finalOutputPath = path.join(
        "/tmp",
        `converted_file_${key}.${outputExt}`
      );

      // Preparing input file
      await this.prepareInputFile(inputSource, sourceFile);
      const fileStats = this.validateInputFile(sourceFile);

      // Choose and execute converter
      const conversionParams = {
        sourceFile,
        outputFile,
        outputFormat,
        tempDir: tempDirs.temp,
        key,
        lcid: region ? localeToLCID(region) : null,
        fromChanges,
      };

      let conversionResult;
      if (converter === "docbuilder") {
        conversionResult = await this.docBuilderConverter.convert(
          conversionParams
        );
      } else {
        // Default to x2t converter
        conversionResult = await this.x2tConverter.convert(conversionParams);
      }

      // Verifying output file
      if (!fs.existsSync(outputFile)) {
        throw new Error(`Output file was not created: ${outputFile}`);
      }

      // Copying to final location + logic here to s3 upload in future
      fs.copyFileSync(outputFile, finalOutputPath);
      const outputStats = fs.statSync(finalOutputPath);

      // Optionally base64 encoding
      let base64Content = null;
      if (includeBase64) {
        const fileBuffer = fs.readFileSync(finalOutputPath);
        base64Content = fileBuffer.toString("base64");
      }

      return {
        success: true,
        data: {
          outputPath: finalOutputPath,
          outputSize: outputStats.size,
          outputType: outputExt,
          sourceFileSize: fileStats.size,
          converterUsed: conversionResult.converterType,
          base64Content: base64Content,
        },
      };
    } finally {
      // Cleaning up
      if (tempDirs && fs.existsSync(tempDirs.temp)) {
        fs.rmSync(tempDirs.temp, { recursive: true, force: true });
        console.log("Cleaned up temp directory");
      }
    }
  }

  async prepareInputFile(inputSource, targetPath) {
    if (isUrl(inputSource)) {
      console.log(`Downloading file from URL: ${inputSource}`);
      await downloadFile(inputSource, targetPath);
    } else {
      if (fs.existsSync(inputSource)) {
        fs.copyFileSync(inputSource, targetPath);
        console.log(`Copied input file: ${inputSource} -> ${targetPath}`);
      } else {
        throw new Error(`Input file not found: ${inputSource}`);
      }
    }
  }

  validateInputFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error("Source file not found after processing");
    }

    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      throw new Error("Source file is empty");
    }

    console.log(`Source file size: ${fileStats.size} bytes`);
    return fileStats;
  }
}

module.exports = ConversionService;
