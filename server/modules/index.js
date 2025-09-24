const ConversionService = require("./conversionService");
const X2TConverter = require("./converters/x2tConverter");
const DocBuilderConverter = require("./converters/docBuilderConverter");
const { S3Service } = require("./s3-service");
const FileProcessor = require("./processors/fileProcessor");
const PdfProcessor = require("./processors/pdfProcessor");
const BinFileProcessor = require("./processors/binFileProcessor");
const RegularFileProcessor = require("./processors/regularFileProcessor");

module.exports = {
  ConversionService,
  X2TConverter,
  DocBuilderConverter,
  S3Service,
  FileProcessor,
  PdfProcessor,
  BinFileProcessor,
  RegularFileProcessor,
};
