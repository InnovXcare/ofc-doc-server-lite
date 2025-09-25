class RegularFileProcessor {
  async process(processParams) {
    const {
      sourceFile,
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
          s3Service,
        });
      })
    );
  }
}

module.exports = RegularFileProcessor;
