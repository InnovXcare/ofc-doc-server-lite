const path = require("path");
const { getFormatFromString, localeToLCID } = require("../../resources/utils");
const {
  AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
} = require("../../resources/constants");
const { promises: fs } = require("fs");

class BinFileProcessor {
  constructor(x2tConverter, docBuilderConverter) {
    this.x2tConverter = x2tConverter;
    this.docBuilderConverter = docBuilderConverter;
  }

  async process(processParams) {
    const {
      sourceFile,
      changesFile,
      outputFiles,
      tempDirs,
      region,
      s3Service,
      inputFile,
      processAndUpload,
    } = processParams;
    console.log("Processing .bin file workflow");
    const timeStamp = Date.now();

    // Step 1: Convert bin to docx with/without changes [Interim file]
    const interimDocxFile = await this.createInterimFile({
      sourceFile,
      tempDirs,
      timeStamp,
      region,
      changesFile,
    });

    // Step 2: Convert interim Docx File back to bin
    // Step 3: convert interim Docx File to other outputs using DocBuilder
    const [binFileWithChanges, convertedFiles] = await Promise.all([
      this.convertDocxToBin({
        sourceFile: interimDocxFile,
        tempDirs,
        timeStamp,
        region,
      }),

      await this.convertToOutputTypes({
        outputFiles,
        sourceFile: interimDocxFile,
        tempDirs,
        timeStamp,
      }),
    ]);

    // Step 4:Upload the converted bin back [binFileWithChanges] if present to input location with same name
    // Step 5: Convert clean docx to all output formats
    if (changesFile) {
      console.log("Uploading binFile With Changes to input location");
      const uploadResult = await s3Service.uploadFile(
        {
          name: path.basename(inputFile.location),
          data: await fs.readFile(binFileWithChanges),
        },
        path.dirname(inputFile.location)
      );
      // Log the upload result if needed
      if (uploadResult) {
        console.log(`binFile With Changes uploaded to: ${uploadResult}`);
      }
    }
    const [conversionResults] = await Promise.all(
      convertedFiles.map(async (convertedFile, index) => {
        const finalOutputPath = path.join(
          "/tmp",
          `output_${timeStamp}_${index}.${outputFiles[index].type}`
        );
        await fs.copyFile(convertedFile, finalOutputPath);
        return await processAndUpload({
          filePath: finalOutputPath,
          outputFile: outputFiles[index],
          timeStamp,
          index,
          s3Service,
          converterUsed: "docbuilder",
        });
      })
    );

    return conversionResults;
  }

  // function to convert .bin to interim DOCX with/without changes

  async createInterimFile({
    sourceFile,
    tempDirs,
    timeStamp,
    region,
    changesFile,
  }) {
    const interimDocxFile = path.join(
      tempDirs.result,
      `interim_${timeStamp}.docx`
    );

    await this.x2tConverter.convert({
      sourceFile,
      outputFile: interimDocxFile,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `bin_to_docx_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges: changesFile,
    });

    return interimDocxFile;
  }

  // function to convert interimDocx file back to .bin

  async convertDocxToBin({ sourceFile, tempDirs, timeStamp, region }) {
    const binFileWithChanges = path.join(
      tempDirs.result,
      `with_changes_${timeStamp}.bin`
    );

    await this.x2tConverter.convert({
      sourceFile,
      outputFile: binFileWithChanges,
      outputFormat: AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
      tempDir: tempDirs.temp,
      key: `docx_to_bin_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
    });

    return binFileWithChanges;
  }

  // function to convert to all output types using DocBuilder

  async convertToOutputTypes({ outputFiles, sourceFile, tempDirs, timeStamp }) {
    const docBuilderOutputs = outputFiles.map((file, index) => ({
      path: path.join(
        tempDirs.result,
        `clean_${timeStamp}_${index}.${file.type}`
      ),
      format: getFormatFromString(file.type),
    }));

    await this.docBuilderConverter.convert({
      sourceFile,
      outputFiles: docBuilderOutputs,
      tempDir: tempDirs.temp,
      key: `clean_multi_${timeStamp}`,
    });

    return docBuilderOutputs.map((output) => output.path);
  }
}

module.exports = BinFileProcessor;
