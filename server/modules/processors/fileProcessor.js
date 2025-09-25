const path = require("path");
const { promises: fs } = require("fs");
const { createTempDir } = require("../../resources/helpers");

class FileProcessor {
  // creating temp directories
  createTempDirs() {
    return createTempDir();
  }

  // Downloading and validating input files [input + changesFile] from S3

  async prepareInputFiles({
    inputFile,
    changesFileLocation,
    tempDirs,
    s3Service,
  }) {
    // Download input file
    const sourceFile = path.join(tempDirs.source, `input.${inputFile.type}`);
    if (s3Service) {
      console.log(`Downloading input file from S3: ${inputFile.location}`);
      await s3Service.downloadS3File(inputFile.location, sourceFile);
    }
    const fileStats = this.validateFile(sourceFile);

    // Download changes file if provided
    let changesFile = null;
    if (changesFileLocation) {
      changesFile = path.join(tempDirs.source, "changes0.json");
      if (s3Service) {
        console.log(`Downloading changes file from S3: ${changesFileLocation}`);
        await s3Service.downloadS3File(changesFileLocation, changesFile);
      }
      this.validateFile(changesFile);
    }

    return { sourceFile, changesFile, fileStats };
  }

  // Uploading file to S3 with tags

  async uploadToS3(filePath, outputFile, s3Service) {
    try {
      const fileName = path.basename(filePath);
      const fileBuffer = await fs.readFile(filePath);

      const fileObj = { name: fileName, data: fileBuffer };
      const tags = this.extractTags(outputFile.tags);

      await s3Service.uploadFile(fileObj, outputFile.location, tags);
      console.log(`Uploaded to S3: ${outputFile.location}${fileName}`);

      return `${outputFile.location}${fileName}`;
    } catch (error) {
      console.error("S3 upload error:", error);
      return null;
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

  // Generating base64 content if requested

  async generateBase64(filePath, includeBase64) {
    if (!includeBase64) return null;

    const fileBuffer = await fs.readFile(filePath);
    return fileBuffer.toString("base64");
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
