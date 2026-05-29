const path = require("path");
const { promises: fs } = require("fs");
const { getFormatFromString, localeToLCID } = require("../../resources/utils");
const { fixBlipFillTilesInDocx } = require("../../../patches/tile-fix");
const { fixBlipFillTilesInBin } = require("../../../patches/tile-fix-bin");

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

    // Step 1: bin + changes -> docx (interim). When changesFile is provided,
    // x2t internally calls apply_changes(), which writes the merged binary as
    // a sibling file named "<basename>WithChanges.<ext>" (e.g.
    // "EditorWithChanges.bin") right next to sourceFile, then continues with
    // the docx serialization. Upstream x2t deletes that file immediately
    // after, but our LD_PRELOAD shim (patches/x2t_keep_with_changes.c, wired
    // in x2t-converter.js) suppresses that delete so we can read it back.
    const interimDocxFile = await this.createInterimFile({
      sourceFile,
      tempDirs,
      timeStamp,
      region,
      changesFile,
    });
    await fixBlipFillTilesInDocx(interimDocxFile);

    // Step 2: locate the preserved merged bin. When no changes file was
    // applied (apply_changes is a no-op), we fall back to the original
    // sourceFile - it is already in the desired post-merge state for this
    // request. The bin keeps its original "media/<hex>" references intact
    // because no docx round-trip happened.
    const mergedBinFile = binOutputFileExists
      ? await this.resolveMergedBin({ sourceFile, changesFile })
      : null;

    // Step 3: non-bin outputs (PDF/DOCX/RTF). Consume the Step 1 interim
    // docx directly - it already has every change applied via apply_changes.
    // The previous implementation re-derived a second docx from the merged
    // bin ("interim_others"); that re-pass is gone, saving the docx-build
    // time on every print.
    const nonBinconvertedFiles = await this.convertToOutputTypes({
      outputFiles: nonBinOutputs,
      sourceFile: interimDocxFile,
      tempDirs,
      timeStamp,
    });

    // Step 4: stage final files in /tmp and upload via processAndUpload.
    let nonBinIdx = 0;
    const processResults = await Promise.all(
      outputFiles.map(async (outFile, index) => {
        let src = null;

        if (outFile.type === "bin") {
          if (!mergedBinFile) {
            throw new Error("Merged bin file not present!");
          }
          src = mergedBinFile;
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

        // Bin counterpart of the docx tile->stretch patch: rewrite any
        // degenerate `<a:tile>` BlipFill sub-records inside the merged bin so
        // the editor doesn't tile a single picture when this bin is reloaded.
        // See patches/tile-fix-bin.js for the byte-level rationale. We patch
        // the staged /tmp copy so the upstream merged bin under tempDirs stays
        // untouched for debugging.
        if (outFile.type === "bin") {
          await fixBlipFillTilesInBin(finalOutputPath);
        }

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

  /**
   * Returns the path to the merged bin x2t produced during createInterimFile.
   *
   *   - When a changesFile was passed, x2t's apply_changes writes the merged
   *     binary to `<sourceFileDir>/<basenameNoExt>WithChanges.<ext>`. The
   *     LD_PRELOAD shim keeps that file alive after x2t finishes; we just
   *     read it from disk.
   *   - When no changesFile was passed, apply_changes is a no-op and there
   *     is no merged file to find. The caller's sourceFile is already in the
   *     desired state, so we return it unchanged. This also covers the edge
   *     case where apply_changes silently set sBinTo back to sBinFrom on a
   *     corrupted-changes fallback (see cextracttools.cpp:884-892).
   */
  async resolveMergedBin({ sourceFile, changesFile }) {
    if (!changesFile) return sourceFile;

    const dir = path.dirname(sourceFile);
    const ext = path.extname(sourceFile);
    const base = path.basename(sourceFile, ext);
    const mergedPath = path.join(dir, `${base}WithChanges${ext}`);

    try {
      const stat = await fs.stat(mergedPath);
      if (stat.size > 0) {
        console.log(
          `Using preserved merged bin: ${mergedPath} (${stat.size}B)`
        );
        return mergedPath;
      }
      console.warn(
        `Preserved merged bin exists but is empty (${stat.size}B): ${mergedPath}. Falling back to source.`
      );
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.warn(
          `resolveMergedBin: stat failed for ${mergedPath}: ${e.message}`
        );
      } else {
        console.log(
          `No merged bin at ${mergedPath} (apply_changes likely produced no diff); using source bin.`
        );
      }
    }
    return sourceFile;
  }

  // bin -> docx (interim). When changesFile is passed, x2t runs apply_changes
  // first so the docx (and the preserved merged bin) reflect the merged state.
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
