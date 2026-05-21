const path = require("path");
const { promises: fs } = require("fs");
const { getFormatFromString, localeToLCID } = require("../../resources/utils");
const {
  AVS_OFFICESTUDIO_FILE_CANVAS_WORD,
} = require("../../resources/constants");

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
    } = processParams;
    console.log("Processing .bin file workflow");

    const binOutputFileExists = outputFiles.some((f) => f.type === "bin");
    const nonBinOutputs = outputFiles.filter((f) => f.type !== "bin");
    const timeStamp = Date.now();

    // Step 1: bin + changes -> docx (interim, with all edits applied).
    const interimDocxFile = await this.createInterimFile({
      sourceFile,
      tempDirs,
      timeStamp,
      region,
      changesFile,
    });

    // NOTE::::: - FOR FUTURE ME - (ANY CHANGE PLEASE READ THROUGH IT) - ofc-doc-server/core/OOXML/Binary/Document/DocWrapper/DocxSerializer.cpp
    // (CDocxSerializer::saveToFile sets pathMedia = <out_dir>/media).
    // Step 2: docx -> bin (merged). x2t writes the merged bin and emits its reference media
    // referenced media

    const binFileWithChanges = binOutputFileExists
      ? await this.convertDocxToBin({
          sourceFile: interimDocxFile,
          tempDirs,
          timeStamp,
          region,
        })
      : null;

    // Step 3: fetch media files emittted by x2t upload them to S3 and rewrite files_location.media to keep
    // the editor's media/<key> URL lookup working on the next load.
    const harvestedMedia = binFileWithChanges
      ? await this.harvestMediaFiles({ binFilePath: binFileWithChanges })
      : [];

    // Step 4: non-bin outputs (PDF/DOCX/RTF). Consume the interim docx from Step 1
    const nonBinconvertedFiles = await this.convertToOutputTypes({
      outputFiles: nonBinOutputs,
      sourceFile: interimDocxFile,
      tempDirs,
      timeStamp,
    });

    // Step 5: process and upload all output formats
    let nonBinIdx = 0;
    const processResults = await Promise.all(
      outputFiles.map(async (outFile, index) => {
        let src = null;

        if (outFile.type === "bin") {
          if (!binFileWithChanges) {
            throw new Error("Bin file with changes not present!");
          }
          src = binFileWithChanges;
        } else {
          src = nonBinconvertedFiles[nonBinIdx++];
          if (!src) {
            throw new Error(
              `Converted file not found at index ${index} for type: ${outFile.type}`
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

    return { results: processResults, harvestedMedia };
  }

  /**
   * Lists every non-empty file under <binDir>/media. Each entry returned is
   * {name, localPath, size}. These are the media files x2t wrote out alongside
   * the merged bin during docx -> bin. The bin references them as media/<name>.
   */
  async harvestMediaFiles({ binFilePath }) {
    const binDir = path.dirname(binFilePath);
    const mediaDir = path.join(binDir, "media");
    try {
      const entries = await fs.readdir(mediaDir, { withFileTypes: true });
      const out = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const localPath = path.join(mediaDir, entry.name);
        const stat = await fs.stat(localPath);
        if (stat.size > 0) {
          out.push({ name: entry.name, localPath, size: stat.size });
        }
      }
      if (out.length) {
        console.log(
          `Harvested ${out.length} merged-bin media file(s): ${out
            .map((f) => `${f.name} (${f.size}B)`)
            .join(", ")}`
        );
      } else {
        console.log("Harvested 0 merged-bin media files (no images in doc).");
      }
      return out;
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.warn(`harvestMediaFiles: ${e.message}`);
      }
      return [];
    }
  }

  // bin -> docx (interim). When changesFile is passed, x2t runs apply_changes
  // first so the docx reflects the merged state.
  async createInterimFile({
    sourceFile,
    tempDirs,
    timeStamp,
    region,
    changesFile,
    fileName = "interim",
  }) {
    const interimDocxFile = path.join(
      tempDirs.result,
      `${fileName}_${timeStamp}.docx`
    );

    await this.x2tConverter.convert({
      sourceFile,
      outputFile: interimDocxFile,
      outputFormat: getFormatFromString("docx"),
      tempDir: tempDirs.temp,
      key: `${fileName}_bin_to_docx_${timeStamp}`,
      lcid: region ? localeToLCID(region) : null,
      fromChanges: changesFile || false,
    });

    return interimDocxFile;
  }

  // interim docx -> merged bin. Media for the merged bin lands at
  // <tempDirs.result>/media/<name>; see harvestMediaFiles above.
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

  async convertToOutputTypes({ outputFiles, sourceFile, tempDirs, timeStamp }) {
    if (!outputFiles.length) return [];

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
