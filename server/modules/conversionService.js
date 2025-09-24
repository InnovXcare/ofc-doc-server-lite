const path = require("path");
const fs = require("fs");
const X2TConverter = require("./converters/x2tConverter");
const DocBuilderConverter = require("./converters/docBuilderConverter");
const FileProcessor = require("./processors/fileProcessor");
const PdfProcessor = require("./processors/pdfProcessor");
const BinFileProcessor = require("./processors/binFileProcessor");
const RegularFileProcessor = require("./processors/regularFileProcessor");
const { getFormatFromString, localeToLCID } = require("../resources/utils");

class ConversionService {
  constructor() {
    this.x2tConverter = new X2TConverter();
    this.docBuilderConverter = new DocBuilderConverter();
    this.fileProcessor = new FileProcessor();
    this.pdfProcessor = new PdfProcessor();
    this.binFileProcessor = new BinFileProcessor(
      this.x2tConverter,
      this.docBuilderConverter
    );
    this.regularFileProcessor = new RegularFileProcessor();
  }

  /**
   * main conversion method
   */
  async convertFile(params) {
    const {
      inputFile,
      outputFiles,
      changesFileLocation,
      region,
      includeBase64,
      s3Service,
    } = params;

    // Creating temp directories
    const tempDirs = this.fileProcessor.createTempDirs();
    console.log("Starting conversion with params - ", params);

    try {
      // step 1 : Downloading input file + changes File if any
      const { sourceFile, changesFile, fileStats } =
        await this.fileProcessor.prepareInputFiles({
          inputFile,
          changesFileLocation,
          tempDirs,
          s3Service,
        });

      // step 2 : Process files depending based on input file type

      const processFileParams = {
        sourceFile,
        changesFile,
        outputFiles,
        tempDirs,
        region,
        includeBase64,
        s3Service,
        convertAndUpload: this.convertAndUpload.bind(this),
      };

      const results =
        inputFile.type === "bin"
          ? await this.binFileProcessor.process(processFileParams)
          : await this.regularFileProcessor.process(processFileParams);

      return {
        success: true,
        data: {
          results,
          totalFiles: results.length,
          sourceFileSize: fileStats.size,
          inputType: inputFile.type,
        },
      };
    } finally {
      // Cleaning up
      this.fileProcessor.cleanup(tempDirs);
    }
  }

  // function to handle single convert and upload
  async convertAndUpload({
    sourceFile,
    file,
    tempDirs,
    timeStamp,
    index,
    region,
    fromChanges,
    includeBase64,
    s3Service,
  }) {
    console.log(`Converting file ${index + 1}:`, file.type);

    // Generating file paths
    const outputFileName = `${file?.key || `output_${timeStamp}_${index}`}.${
      file.type
    }`;
    const tempOutputFile = path.join(tempDirs.result, outputFileName);
    const finalOutputPath = path.join("/tmp", outputFileName);

    // Converting using X2T
    const conversionResult = await this.x2tConverter.convert({
      sourceFile,
      outputFile: tempOutputFile,
      outputFormat: getFormatFromString(file.type),
      tempDir: tempDirs.temp,
      key: `conversion_${timeStamp}_${index}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges,
    });

    // Verifying and moving output file
    this.fileProcessor.validateFile(tempOutputFile);
    fs.copyFileSync(tempOutputFile, finalOutputPath);
    const outputStats = fs.statSync(finalOutputPath);

    // Adding background image to PDF if needed
    if (file.type === "pdf" && file.backgroundImageUrl) {
      await this.pdfProcessor.addBackgroundImageFromS3(
        file.backgroundImageUrl,
        finalOutputPath,
        s3Service
      );
    }

    // Generating base64 content if requested
    const base64Content = this.fileProcessor.generateBase64(
      finalOutputPath,
      includeBase64
    );

    // Uploading to S3 if location provided
    const s3Location =
      file.location && s3Service
        ? await this.fileProcessor.uploadToS3(finalOutputPath, file, s3Service)
        : null;

    return {
      key: file.key || `output_${timeStamp}_${index}`,
      type: file.type,
      outputPath: finalOutputPath,
      outputSize: outputStats.size,
      converterUsed: conversionResult.converterType,
      base64Content,
      s3Location,
      tags: file.tags,
    };
  }
}

module.exports = ConversionService;
