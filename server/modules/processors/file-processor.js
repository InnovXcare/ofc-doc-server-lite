const path = require("path");
const { promises: fs } = require("fs");
const { createTempDir } = require("../../resources/helpers");

function assertSafeRelativePath(rel) {
  if (rel == null || typeof rel !== "string" || !rel.trim()) {
    throw new Error("changes media relativePath must be a non-empty string");
  }
  const normalized = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (path.posix.isAbsolute(normalized)) {
    throw new Error("changes media relativePath must be relative");
  }
  const segments = normalized.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error("changes media relativePath must not contain '..'");
  }
  return normalized;
}

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
    changesMediaPrefix,
    tempDirs,
    s3Service,
  }) {
    // Download input file
    const sourceFile = path.join(tempDirs.source, `input.${inputFile.type}`);
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

    if (s3Service && (changesMediaPrefix || (changesMediaFiles && changesMediaFiles.length))) {
      await this.downloadChangesMediaArtifacts({
        s3Service,
        tempDirs,
        changesMediaPrefix,
        changesMediaFiles,
      });
    }

    return { sourceFile, changesFile, fileStats };
  }

  /**
   * Stages files under source/changes/ so paths in changes0.json (e.g. media/…) resolve during x2t.
   */
  async downloadChangesMediaArtifacts({
    s3Service,
    tempDirs,
    changesMediaPrefix,
    changesMediaFiles,
  }) {
    const changesRoot = path.join(tempDirs.source, "changes");

    if (changesMediaPrefix) {
      const keys = await s3Service.listObjectKeysUnderPrefix(changesMediaPrefix);
      for (const key of keys) {
        if (!key.startsWith(changesMediaPrefix)) continue;
        let rel = key.slice(changesMediaPrefix.length);
        if (rel.startsWith("/")) rel = rel.slice(1);
        if (!rel) continue;
        const safeRel = assertSafeRelativePath(rel);
        const dest = path.join(changesRoot, safeRel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        console.log(`Downloading changes media (prefix): ${key} -> ${dest}`);
        await s3Service.downloadS3File(key, dest);
        await this.validateFile(dest);
      }
    }

    if (changesMediaFiles && changesMediaFiles.length) {
      for (const item of changesMediaFiles) {
        const safeRel = assertSafeRelativePath(item.relativePath);
        const dest = path.join(changesRoot, safeRel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        console.log(
          `Downloading changes media (explicit): ${item.s3Key} -> ${dest}`
        );
        await s3Service.downloadS3File(item.s3Key, dest);
        await this.validateFile(dest);
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
