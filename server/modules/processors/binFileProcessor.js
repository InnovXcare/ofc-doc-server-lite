const path = require("path");
const { getFormatFromString, localeToLCID } = require("../../resources/utils");
const {
  AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
} = require("../../resources/constants");

class BinFileProcessor {
  constructor(x2tConverter, docBuilderConverter) {
    this.x2tConverter = x2tConverter;
    this.docBuilderConverter = docBuilderConverter;
  }

  async process({
    sourceFile,
    changesFile,
    outputFiles,
    tempDirs,
    region,
    includeBase64,
    s3Service,
    convertAndUpload,
  }) {
    console.log("Processing .bin file workflow");
    const timeStamp = Date.now();

    // Step 1: Convert bin to formatted docx
    const formattedDocxFile = await this.convertBinToDocx({
      sourceFile,
      tempDirs,
      timeStamp,
      region,
      changesFile,
    });

    // Step 2: Convert formatted docx back to bin (preserve formatting)
    // Step 3: Remove formatting using DocBuilder
    const [formattedBinFile, cleanDocxFile] = await Promise.all([
      this.convertDocxToBin({
        sourceFile: formattedDocxFile,
        tempDirs,
        timeStamp,
        region,
        changesFile,
      }),

      await this.removeFormattingWithDocBuilder({
        sourceFile: formattedDocxFile,
        tempDirs,
        timeStamp,
      }),
    ]);
    // TODO: Upload the converted bin [formattedBinFile] to input location

    // Step 4: Convert clean docx to all output formats
    return await Promise.all(
      outputFiles.map(async (file, index) => {
        return await convertAndUpload({
          sourceFile: cleanDocxFile,
          file,
          tempDirs,
          timeStamp,
          index,
          region,
          fromChanges: changesFile,
          includeBase64,
          s3Service,
        });
      })
    );
  }

  // function to convert .bin to formatted DOCX

  async convertBinToDocx({
    sourceFile,
    tempDirs,
    timeStamp,
    region,
    changesFile,
  }) {
    const formattedDocxFile = path.join(
      tempDirs.result,
      `formatted_${timeStamp}.docx`
    );

    await this.x2tConverter.convert({
      sourceFile,
      outputFile: formattedDocxFile,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `bin_to_docx_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges: changesFile,
    });

    return formattedDocxFile;
  }

  // function to convert formatted DOCX back to .bin

  async convertDocxToBin({
    sourceFile,
    tempDirs,
    timeStamp,
    region,
    changesFile,
  }) {
    const formattedBinFile = path.join(
      tempDirs.result,
      `formatted_${timeStamp}.bin`
    );

    await this.x2tConverter.convert({
      sourceFile,
      outputFile: formattedBinFile,
      outputFormat: AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
      tempDir: tempDirs.temp,
      key: `docx_to_bin_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges: changesFile,
    });

    return formattedBinFile;
  }

  // function to remove formatting using DocBuilder

  async removeFormattingWithDocBuilder({ sourceFile, tempDirs, timeStamp }) {
    const cleanDocxFile = path.join(tempDirs.result, `clean_${timeStamp}.docx`);

    await this.docBuilderConverter.convert({
      sourceFile,
      outputFile: cleanDocxFile,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `clean_docx_${timeStamp}`,
    });

    return cleanDocxFile;
  }
}

module.exports = BinFileProcessor;
