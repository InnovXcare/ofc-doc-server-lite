const { buffer } = require("node:stream/consumers");
const fs = require("fs");
const ENVIRONMENT = require("../env");
const stream = require("stream");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  PutObjectTaggingCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { inspect, promisify } = require("util");
const pipeline = promisify(stream.pipeline);
const path = require("path");

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf": "application/rtf",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

// Get content type from extension to avoid S3 storing the files
// with application/octet-stream
const getContentType = (fileName) =>
  CONTENT_TYPES[path.extname(fileName || "").toLowerCase()] ||
  "application/octet-stream";

class S3Service {
  constructor(bucketName = null, region = "ap-south-1") {
    const s3Config = { region };

    if (ENVIRONMENT.ENVIRONMENT_NODE_ENV === "development") {
      s3Config.credentials = {
        accessKeyId: ENVIRONMENT.S3_ACCESS_KEY_ID,
        secretAccessKey: ENVIRONMENT.S3_ACCESS_KEY,
      };
    }

    this.s3 = new S3Client(s3Config);
    this.bucketName = bucketName || ENVIRONMENT.ENVIRONMENT_S3_BUKET_NAME;
  }
  /**
   * This methods dowloads the file from( bucket location to local system,
   * on lambda make sure the local path is inside /tmp directory
   * @param {*} Key
   * @param {*} localFilePath
   * @returns
   */
  async downloadS3File(Key, localFilePath = null) {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key });
    const fileStream = (await this.s3.send(command)).Body;
    return localFilePath
      ? pipeline(fileStream, fs.createWriteStream(localFilePath))
      : buffer(fileStream);
  }

  async uploadFile(file, pathPrefix = "/", tags = {}) {
    console.info(`S3Service.uploadFile :: ${file.name}`);
    return new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucketName,
        Key: `${pathPrefix}/${file.name}`,
        Body: file.data,
        ContentType: getContentType(file.name),
        Tagging: new URLSearchParams(tags).toString(),
      },
      tags, // optional tags
      leavePartsOnError: false, // optional manually handle dropped parts
    }).done();
  }
  async addTagsToExistingFile(fileKey, tags) {
    const tagSet = Object.entries(tags).map(([Key, Value]) => ({
      Key,
      Value: String(Value), // S3 requires string values
    }));

    const params = {
      Bucket: this.bucketName,
      Key: fileKey,
      Tagging: { TagSet: tagSet },
    };

    try {
      console.info(`S3Service.addTagsToExistingFile :: ${fileKey}`);
      await this.s3.send(new PutObjectTaggingCommand(params));
      return "updated";
    } catch (error) {
      console.error(`Error S3Service.addTagsToExistingFile: ${inspect(error)}`);

      if (error.Code == "NoSuchKey")
        return { error: "This location does not exists" };
      return "tag could not be updated";
    }
  }
}
module.exports = { S3Service };
