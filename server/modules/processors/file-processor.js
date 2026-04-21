const path = require("path");
const { promises: fs } = require("fs");
const {
  createTempDir,
  safeResolveUnderSourceRoot,
} = require("../../resources/helpers");

class FileProcessor {
  // creating temp directories
  createTempDirs() {
    return createTempDir();
  }

  // Downloading and validating input files [input + changesFile] from S3

  async prepareInputFiles({
    inputFile,
    changesFileLocation,
    changesMediaFiles,
    tempDirs,
    s3Service,
  }) {
    // OFC Document Server uses Editor.<ext> for coauth binaries; x2t resolves media/ next to this file.
    const inputBaseName = inputFile.type === "bin" ? "Editor" : "input";
    const sourceFile = path.join(
      tempDirs.source,
      `${inputBaseName}.${inputFile.type}`
    );
    if (s3Service) {
      console.log(`Downloading input file from S3: ${inputFile.location}`);
      await s3Service.downloadS3File(inputFile.location, sourceFile);
    }
    const fileStats = await this.validateFile(sourceFile);

    // Download changes file if provided
    let changesFile = null;
    if (changesFileLocation) {
      changesFile = path.join(tempDirs.source, "changes/changes0.json");
      if (s3Service) {
        console.log(`Downloading changes file from S3: ${changesFileLocation}`);
        await s3Service.downloadS3File(changesFileLocation, changesFile);
      }
      await this.validateFile(changesFile);
    }

    // Stage media next to Editor.bin so x2t can resolve paths (e.g. media/<id>)
    if (changesMediaFiles && changesMediaFiles.length > 0 && s3Service) {
      await this.downloadChangesMediaFiles({
        changesMediaFiles,
        sourceRoot: tempDirs.source,
        s3Service,
      });
      await this.mirrorMediaIntoChangesDir(tempDirs.source);
    }

    return { sourceFile, changesFile, fileStats };
  }

  /**
   * making two x2t code paths so that it can resolve images relative to the changes directory as well when m_bFromChanges is set.
   */
  async mirrorMediaIntoChangesDir(sourceRoot) {
    const mediaDir = path.join(sourceRoot, "media");
    const mirrorDir = path.join(sourceRoot, "changes", "media");
    try {
      const st = await fs.stat(mediaDir);
      if (!st.isDirectory()) return;
      await fs.mkdir(path.dirname(mirrorDir), { recursive: true });
      await fs.cp(mediaDir, mirrorDir, { recursive: true });
    } catch (e) {
      console.warn("mirrorMediaIntoChangesDir:", e.message);
    }
  }

  /**
   * Downloads S3 objects into tempDirs.source following relativePath (e.g. media/hex).
   */
  async downloadChangesMediaFiles({
    changesMediaFiles,
    sourceRoot,
    s3Service,
  }) {
    for (const entry of changesMediaFiles) {
      const { location, relativePath } = entry;
      const destPath = safeResolveUnderSourceRoot(sourceRoot, relativePath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      console.log(
        `Downloading changes media from S3: ${location} -> ${destPath}`
      );
      await s3Service.downloadS3File(location, destPath);
      await this.validateFile(destPath);

      // Also expose media/<filename> when S3 key has an extension (e.g. media/hex.jpg) so x2t
      // finds the file whether the binary references media/hex or media/hex.jpg.
      const keyBase = path.basename(location.replace(/\\/g, "/"));
      const relBase = path.basename(relativePath.replace(/\\/g, "/"));
      if (keyBase && keyBase !== relBase) {
        const altRel = `media/${keyBase}`;
        const altPath = safeResolveUnderSourceRoot(sourceRoot, altRel);
        if (altPath !== destPath) {
          await fs.copyFile(destPath, altPath);
          console.log(`Copied media alias: ${altPath}`);
        }
      }
    }
  }

  // Uploading file to S3 with tags

  async uploadToS3(filePath, outputFile, s3Service) {
    try {
      const fileName = outputFile.key
        ? `${outputFile?.key}.${outputFile?.type}`
        : path.basename(filePath);
      const fileBuffer = await fs.readFile(filePath);

      const fileObj = { name: fileName, data: fileBuffer };
      const tags = this.extractTags(outputFile.tags);

      await s3Service.uploadFile(fileObj, outputFile.location, tags);
      console.log(`Uploaded to S3: ${outputFile.location}${fileName}`);

      return `${outputFile.location}/${fileName}`;
    } catch (error) {
      console.error("S3 upload error:", error);
      throw error;
    }
  }

  // Validating if file exists and is not empty

  async validateFile(filePath) {
    try {
      const fileStats = await fs.stat(filePath);

      if (fileStats.size === 0) {
        throw new Error(`File is empty: ${filePath}`);
      }

      console.log(`Validated file: ${filePath} (${fileStats.size} bytes)`);
      return fileStats;
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  // Extracting S3 tags from tag array

  extractTags(tagArray) {
    if (!Array.isArray(tagArray)) return {};

    return tagArray.reduce((tags, tag) => {
      if (tag.key && tag.value) {
        tags[tag.key] = tag.value;
      }
      return tags;
    }, {});
  }

  // clean up function to delete temp directories
  async cleanup(tempDirs) {
    if (!tempDirs) return;

    try {
      const tempExists = await this.exists(tempDirs.temp);
      if (tempExists) {
        await fs.rm(tempDirs.temp, { recursive: true, force: true });
        console.log("Cleaned up temp directory");
      }
    } catch (error) {
      console.error("Error cleaning up temp directory:", error);
      throw error;
    }
  }
  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = FileProcessor;
