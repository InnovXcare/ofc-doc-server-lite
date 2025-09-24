class RegularFileProcessor {
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
    console.log("Processing regular file workflow");
    const timeStamp = Date.now();

    return await Promise.all(
      outputFiles.map(async (file, index) => {
        return await convertAndUpload({
          sourceFile,
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
}

module.exports = RegularFileProcessor;
