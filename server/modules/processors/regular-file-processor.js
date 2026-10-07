const path = require("path");
const { promises: fs } = require("fs");
const { getFormatFromString, localeToLCID } = require("../../resources/utils");

class RegularFileProcessor {
  constructor(x2tConverter, docBuilderConverter, fileProcessor) {
    this.x2tConverter = x2tConverter;
    this.docBuilderConverter = docBuilderConverter;
    this.fileProcessor = fileProcessor;
  }

  async process(processParams) {
    const {
      sourceFile,
      outputFiles,
      tempDirs,
      region,
      s3Service,
      convertAndUpload,
      processAndUpload,
      headerElements,
    } = processParams;
    console.log("Processing regular file workflow");
    const timeStamp = Date.now();

    if (headerElements.length > 0) {
      return this.processWithPatientHeader({
        sourceFile,
        outputFiles,
        tempDirs,
        region,
        s3Service,
        convertAndUpload,
        processAndUpload,
        headerElements,
        timeStamp,
      });
    }

    return await Promise.all(
      outputFiles.map(async (file, index) => {
        return await convertAndUpload({
          sourceFile,
          file,
          tempDirs,
          timeStamp,
          index,
          region,
          s3Service,
        });
      })
    );
  }

  async processWithPatientHeader({
    sourceFile,
    outputFiles,
    tempDirs,
    region,
    s3Service,
    convertAndUpload,
    processAndUpload,
    headerElements,
    timeStamp,
  }) {
    const interimDocx = path.join(
      tempDirs.result,
      `report_body_${timeStamp}.docx`
    );

    await this.x2tConverter.convert({
      sourceFile,
      outputFile: interimDocx,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `patient_header_body_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
    });
    await this.fileProcessor.validateFile(interimDocx);

    // DocBuilder cannot create OnlyOffice canvas BIN files: asking it to save
    // "bin" produces DOCX bytes with a .bin extension. Insert the header into
    // one DOCX, then let x2t create every requested non-DOCX format.
    const headeredDocx = path.join(
      tempDirs.result,
      `report_with_header_${timeStamp}.docx`
    );

    await this.docBuilderConverter.convert({
      sourceFile: interimDocx,
      outputFiles: [
        { path: headeredDocx, format: getFormatFromString("docx") },
      ],
      tempDir: tempDirs.temp,
      key: `patient_header_outputs_${timeStamp}`,
      preserveFormatting: true,
      headerElements,
    });
    await this.fileProcessor.validateFile(headeredDocx);

    return Promise.all(
      outputFiles.map(async (outputFile, index) => {
        if (outputFile.type !== "docx") {
          return convertAndUpload({
            sourceFile: headeredDocx,
            file: outputFile,
            tempDirs,
            timeStamp,
            index,
            region,
            s3Service,
          });
        }

        const finalOutputPath = path.join(
          "/tmp",
          `${outputFile.key || `output_${timeStamp}_${index}`}.${outputFile.type}`
        );
        await fs.copyFile(headeredDocx, finalOutputPath);

        return processAndUpload({
          filePath: finalOutputPath,
          outputFile,
          timeStamp,
          index,
          s3Service,
          converterUsed: "docbuilder",
        });
      })
    );
  }
}

module.exports = RegularFileProcessor;
