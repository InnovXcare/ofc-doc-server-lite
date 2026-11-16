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
      inputFile,
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

    const hasBinOutput = outputFiles.some((file) => file.type === "bin");
    const hasDocumentOutput = outputFiles.some((file) => file.type !== "bin");
    if (inputFile.type === "html" && hasBinOutput && hasDocumentOutput) {
      return this.processHtmlReportOutputs({
        sourceFile,
        outputFiles,
        tempDirs,
        region,
        s3Service,
        processAndUpload,
        headerElements,
        timeStamp,
      });
    }

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

  async processHtmlReportOutputs({
    sourceFile,
    outputFiles,
    tempDirs,
    region,
    s3Service,
    processAndUpload,
    headerElements,
    timeStamp,
  }) {
    const bodyDocx = path.join(
      tempDirs.result,
      `report_body_${timeStamp}.docx`
    );
    await this.x2tConverter.convert({
      sourceFile,
      outputFile: bodyDocx,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `html_report_body_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
    });
    await this.fileProcessor.validateFile(bodyDocx);

    let documentSource = bodyDocx;
    if (headerElements.length > 0) {
      documentSource = path.join(
        tempDirs.result,
        `report_with_header_${timeStamp}.docx`
      );
      await this.docBuilderConverter.convert({
        sourceFile: bodyDocx,
        outputFiles: [
          { path: documentSource, format: getFormatFromString("docx") },
        ],
        tempDir: tempDirs.temp,
        key: `html_report_header_${timeStamp}`,
        preserveFormatting: true,
        headerElements,
      });
      await this.fileProcessor.validateFile(documentSource);
    }

    const generatedFiles = new Map();
    const binOutputs = outputFiles.filter((file) => file.type === "bin");
    for (const [index, outputFile] of binOutputs.entries()) {
      const outputPath = path.join(
        tempDirs.result,
        `report_preserved_${timeStamp}_${index}.bin`
      );
      await this.x2tConverter.convert({
        sourceFile: headerElements.length > 0 ? documentSource : sourceFile,
        outputFile: outputPath,
        outputFormat: getFormatFromString("bin"),
        tempDir: tempDirs.temp,
        key: `html_report_bin_${timeStamp}_${index}`,
        lcid: region ? localeToLCID(region) : null,
      });
      await this.fileProcessor.validateFile(outputPath);
      generatedFiles.set(outputFile, outputPath);
    }

    const documentOutputs = outputFiles.filter((file) => file.type !== "bin");
    const normalizedOutputs = documentOutputs.map((outputFile, index) => ({
      path: path.join(
        tempDirs.result,
        `report_normalized_${timeStamp}_${index}.${outputFile.type}`
      ),
      format: getFormatFromString(outputFile.type),
    }));
    await this.docBuilderConverter.convert({
      sourceFile: documentSource,
      outputFiles: normalizedOutputs,
      tempDir: tempDirs.temp,
      key: `html_report_exports_${timeStamp}`,
      preserveFormatting: false,
    });
    for (let index = 0; index < documentOutputs.length; index += 1) {
      await this.fileProcessor.validateFile(normalizedOutputs[index].path);
      generatedFiles.set(documentOutputs[index], normalizedOutputs[index].path);
    }

    return Promise.all(
      outputFiles.map(async (outputFile, index) => {
        const generatedFile = generatedFiles.get(outputFile);
        const finalOutputPath = path.join(
          "/tmp",
          `${outputFile.key || `output_${timeStamp}_${index}`}.${outputFile.type}`
        );
        await fs.copyFile(generatedFile, finalOutputPath);
        return processAndUpload({
          filePath: finalOutputPath,
          outputFile,
          timeStamp,
          index,
          s3Service,
          converterUsed:
            outputFile.type === "bin" ? "x2t" : "docbuilder",
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
