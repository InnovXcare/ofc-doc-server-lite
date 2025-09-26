const path = require("path");
const { promises: fs } = require("fs");
const X2TConverter = require("./converters/x2t-converter");
const DocBuilderConverter = require("./converters/doc-builder-converter");
const FileProcessor = require("./processors/file-processor");
const PdfProcessor = require("./processors/pdf-processor");
const BinFileProcessor = require("./processors/bin-file-processor");
const RegularFileProcessor = require("./processors/regular-file-processor");
const { getFormatFromString, localeToLCID } = require("../resources/utils");

class ConversionService {
  constructor() {
    this.x2tConverter = new X2TConverter();
    this.docBuilderConverter = new DocBuilderConverter();
    this.fileProcessor = new FileProcessor();
    this.pdfProcessor = new PdfProcessor();
    this.binFileProcessor = new BinFileProcessor(
      this.x2tConverter,
      this.docBuilderConverter,
      this.fileProcessor,
      this.pdfProcessor
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
        s3Service,
        inputFile,
        convertAndUpload: this.convertAndUpload.bind(this),
        processAndUpload: this.processAndUpload.bind(this),
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
      await this.fileProcessor.cleanup(tempDirs);
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
    fromChanges = false,
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
    await this.x2tConverter.convert({
      sourceFile,
      outputFile: tempOutputFile,
      outputFormat: getFormatFromString(file.type),
      tempDir: tempDirs.temp,
      key: `conversion_${timeStamp}_${index}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges,
    });

    // Verifying and moving output file
    await this.fileProcessor.validateFile(tempOutputFile);
    await fs.copyFile(tempOutputFile, finalOutputPath);

    return await this.processAndUpload({
      filePath: finalOutputPath,
      outputFile: file,
      timeStamp,
      index,
      s3Service,
      converterUsed: "x2t",
    });
  }

  async processAndUpload({
    filePath,
    outputFile,
    timeStamp,
    index,
    s3Service,
    converterUsed = "docbuilder",
  }) {
    console.log(`Processing and uploading file: ${outputFile.type}`);

    // Get file stats
    const outputStats = await fs.stat(filePath);

    // Add background image to PDF if needed
    if (outputFile.type === "pdf" && outputFile.backgroundImageLocation) {
      await this.pdfProcessor.addBackgroundImageFromS3(
        outputFile.backgroundImageLocation,
        filePath,
        s3Service
      );
    }

    // Upload to S3 if location provided
    const s3Location =
      outputFile.location && s3Service
        ? await this.fileProcessor.uploadToS3(filePath, outputFile, s3Service)
        : null;

    return {
      key: outputFile.key || `output_${timeStamp}_${index}`,
      type: outputFile.type,
      outputPath: filePath,
      outputSize: outputStats.size,
      converterUsed,
      s3Location,
      tags: outputFile.tags,
    };
  }
}

module.exports = ConversionService;
