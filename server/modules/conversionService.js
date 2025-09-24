const path = require("path");
const fs = require("fs");
const pdflib = require("pdf-lib");
const X2TConverter = require("./x2tConverter");
const DocBuilderConverter = require("./docBuilderConverter");
const { getFormatFromString, localeToLCID } = require("../resources/utils");
const { createTempDir } = require("../resources/helpers");
const { AVS_OFFICESTUDIO_FILE_CANVAS_WORD } = require("../resources/constants");

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
      inputFile,
      outputFiles,
      changesFileLocation,
      region,
      includeBase64,
      s3Service,
    } = params;

    // Creating temp directories
    const tempDirs = createTempDir();
    console.log("Starting conversion with params - ", params);

    try {
      // step 1 : Downloading input file + changes File if any
      const sourceFile = path.join(tempDirs.source, `input.${inputFile.type}`);
      if (s3Service) {
        console.log("Downloading input file from S3");
        await s3Service.downloadS3File(inputFile.location, sourceFile);
      }
      const sourceFileStats = this.validateFile(sourceFile);

      let changesFile = null;
      if (changesFileLocation) {
        changesFile = path.join(tempDirs.source, "changes0.json");
        if (s3Service) {
          console.log("Downloading changes file from s3");
          await s3Service.downloadS3File(changesFileLocation, changesFile);
        }
        this.validateFile(changesFile);
      }

      // step 2 : Process files depending based on input file type

      const processFileParams = {
        sourceFile,
        changesFile,
        outputFiles,
        tempDirs,
        region,
        includeBase64,
        s3Service,
      };

      const results =
        inputFile.type === "bin"
          ? await this.processBinFile(processFileParams)
          : await this.processRegularFile(processFileParams);

      return {
        success: true,
        data: {
          results,
          totalFiles: results.length,
          sourceFileSize: sourceFileStats.size,
          inputType: inputFile.type,
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

  async processBinFile({
    sourceFile,
    changesFile,
    outputFiles,
    tempDirs,
    region,
    includeBase64,
    s3Service,
  }) {
    const timeStamp = Date.now();

    console.log("Processing .bin file workflow");

    // converting bin to docx with formatting
    const formattedDocxFile = path.join(
      tempDirs.result,
      `formatted_${timeStamp}.docx`
    );
    await this.x2tConverter.convert({
      sourceFile,
      outputFile: formattedDocxFile,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `bin_to_f_docx_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges: changesFile,
    });

    // converting formatted docx to bin
    const formattedBinFile = path.join(
      tempDirs.result,
      `formatted_${timeStamp}.bin`
    );
    await this.x2tConverter.convert({
      sourceFile: formattedDocxFile,
      outputFile: formattedBinFile,
      outputFormat: AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
      tempDir: tempDirs.temp,
      key: `f_docx_to_bin_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges: changesFile,
    });
    //TODO:: upload the converted bin to input location

    // converting formatted docx to clean docx[without formatting]
    const cleanDocxFile = path.join(tempDirs.result, `clean_${timeStamp}.docx`);
    await this.docBuilderConverter.convert({
      sourceFile: formattedDocxFile,
      outputFile: cleanDocxFile,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `clean_docx_${timeStamp}`,
    });

    // converting to all output types
    const results = await Promise.all(
      outputFiles.map(async (file, index) => {
        return await this.convertAndUpload({
          sourceFile: cleanDocxFile,
          tempDirs,
          file,
          timeStamp,
          index,
          region,
          fromChanges: changesFile,
          includeBase64,
          s3Service,
        });
      })
    );
    return results;
  }
  async processRegularFile({
    sourceFile,
    changesFile,
    outputFiles,
    tempDirs,
    region,
    includeBase64,
    s3Service,
  }) {
    const timeStamp = Date.now();

    console.log("Processing regular file workflow");
    const results = await Promise.all(
      outputFiles.map(async (file, index) => {
        return await this.convertAndUpload({
          sourceFile,
          tempDirs,
          file,
          timeStamp,
          index,
          region,
          fromChanges: changesFile,
          includeBase64,
          s3Service,
        });
      })
    );
    return results;
  }

  async convertAndUpload({
    sourceFile,
    tempDirs,
    file,
    timeStamp,
    index,
    region,
    fromChanges,
    includeBase64,
    s3Service,
  }) {
    console.log("OUTPUT_FILE", file);

    const outputFileName = `${file?.key || `output_${timeStamp}_${index}`}.${
      file.type
    }`;
    const tempOutputFile = path.join(tempDirs.result, outputFileName);
    const finalOutputPath = path.join("/tmp", outputFileName);

    const conversionResult = await this.x2tConverter.convert({
      sourceFile,
      outputFile: tempOutputFile,
      outputFormat: getFormatFromString(file.type),
      tempDir: tempDirs.temp,
      key: `conversion_${timeStamp}_${index}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges,
    });
    // Verifying  output file
    if (!fs.existsSync(tempOutputFile)) {
      throw new Error(`Output file was not created: ${tempOutputFile}`);
    }

    // Copying to final location
    fs.copyFileSync(tempOutputFile, finalOutputPath);
    const outputStats = fs.statSync(finalOutputPath);

    if (file.type === "pdf" && file.backgroundImageUrl) {
      console.log(
        `Downloading background image from S3: ${file.backgroundImageUrl}`
      );
      const tempBgFile = `/tmp/bg_${Date.now()}.jpg`;
      await s3Service.downloadS3File(file.backgroundImageUrl, tempBgFile);
      const bgBytes = fs.readFileSync(tempBgFile);
      // Clean up temp file
      fs.unlinkSync(tempBgFile);
      await this.embedBackgroundImage(bgBytes, finalOutputPath);
    }
    let base64Content = null;
    if (includeBase64) {
      const fileBuffer = fs.readFileSync(finalOutputPath);
      base64Content = fileBuffer.toString("base64");
    }

    let s3Location = null;
    if (file.location && s3Service) {
      console.log("Step 6: Uploading to S3");
      s3Location = await this.uploadToS3(finalOutputPath, file, s3Service);
    }

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

  async uploadToS3(filePath, outputFile, s3Service) {
    try {
      const fileName = path.basename(filePath);

      const fileBuffer = fs.readFileSync(filePath);

      const fileObj = {
        name: fileName,
        data: fileBuffer,
      };
      const tags = {};
      if (outputFile.tags && outputFile.tags.length) {
        outputFile.tags.forEach((tag) => {
          tags[tag.Key] = tag.Value;
        });
      }
      await s3Service.uploadFile(fileObj, outputFile.location, tags);
      console.log("UPLOADED TO S3");
    } catch (error) {
      console.error("ERROR Uploading to S3", error);
      return null;
    }
  }
  async embedBackgroundImage(backgroundImageBytes, finalOutputPath) {
    if (!backgroundImageBytes) return;
    try {
      const fileBuffer = fs.readFileSync(finalOutputPath);
      const { PDFDocument, BlendMode } = pdflib;
      const pdfDoc = await PDFDocument.load(fileBuffer);

      let bgImage = null;

      const uint8Array = new Uint8Array(backgroundImageBytes.slice(0, 4));
      const isPNG =
        uint8Array[0] === 0x89 &&
        uint8Array[1] === 0x50 &&
        uint8Array[2] === 0x4e &&
        uint8Array[3] === 0x47;
      bgImage = isPNG
        ? await pdfDoc.embedPng(backgroundImageBytes)
        : await pdfDoc.embedJpg(backgroundImageBytes);

      const pdfPages = pdfDoc.getPages();
      for (let i = 0; i < pdfPages.length; i++) {
        const pageSize = pdfPages[i].getSize();
        pdfPages[i].drawImage(bgImage, {
          ...pageSize,
          x: 0,
          y: 0,
          blendMode: BlendMode.Multiply,
          interpolation: "cubic",
        });
      }
      const outBytes = await pdfDoc.save();
      fs.writeFileSync(finalOutputPath, outBytes);
    } catch (error) {
      console.log("SOME ERROR IN EMBEDDING IMAGE", error);
    }
  }

  validateFile(filePath) {
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
