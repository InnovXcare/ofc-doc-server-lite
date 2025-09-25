class RegularFileProcessor {
  async process() {
    const {
      sourceFile,
      changesFile,
      outputFiles,
      tempDirs,
      region,

      s3Service,
      convertAndUpload,
    } = processParams;
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
          s3Service,
        });
      })
    );
  }
}

module.exports = RegularFileProcessor;
