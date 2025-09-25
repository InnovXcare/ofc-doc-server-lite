const ConversionService = require("./conversion-service");
const X2TConverter = require("./converters/x2t-converter");
const DocBuilderConverter = require("./converters/doc-builder-converter");
const { S3Service } = require("./s3-service");
const FileProcessor = require("./processors/file-processor");
const PdfProcessor = require("./processors/pdf-processor");
const BinFileProcessor = require("./processors/bin-file-processor");
const RegularFileProcessor = require("./processors/regular-file-processor");

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
