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
      processAndUpload,
      inputFile,
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

    // Step 2: Convert interim Docx File back to bin if there is bin type in output files
    // Step 3: convert interim Docx File to other outputs using DocBuilder
    const nonBinOutputs = outputFiles.filter((f) => f.type !== "bin");
    const [binFileWithChanges, nonBinconvertedFiles] = await Promise.all([
      outputFiles.some((f) => f.type === "bin")
        ? await this.convertDocxToBin({
            sourceFile: interimDocxFile,
            tempDirs,
            timeStamp,
            region,
          })
        : null,
      this.convertToOutputTypes({
        outputFiles: nonBinOutputs,
        sourceFile: interimDocxFile,
        tempDirs,
        timeStamp,
      }),
    ]);
    // Step 4: Process and upload all output formats

    let nonBinIdx = 0;

    const processResults = await Promise.all(
      outputFiles.map(async (outFile, index) => {
        let src = null;

        if (outFile.type === "bin") {
          if (!binFileWithChanges) {
            throw new Error("Bin file with changes not present!");
          }
          // src should be binFileWith changes + key and location must be from input file
          src = binFileWithChanges;

          // this needs to be uncommented if in case key and location are same as input file location

          // outFile.key = path.basename(inputFile.location).split(".")[0];
          // outFile.location = path.dirname(inputFile.location);
        } else {
          src = nonBinconvertedFiles[nonBinIdx++];
          if (!src) {
            throw new Error(
              `Converted file not found  at index ${index} for type: ${outFile.type}`
            );
          }
        }

        const finalOutputPath = path.join(
          "/tmp",
          `output_${timeStamp}_${index}.${outFile.type}`
        );

        await fs.copyFile(src, finalOutputPath);

        return processAndUpload({
          filePath: finalOutputPath,
          outputFile: outFile,
          timeStamp,
          index,
          s3Service,
          converterUsed: "docbuilder",
        });
      })
    );

    return processResults;
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
