const { buffer } = require("node:stream/consumers");
const fs = require("fs");
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

class S3Service {
  constructor(bucketName = null, region = "ap-south-1") {
    const s3Config = { region };
    // To be changed later
    s3Config.credentials = {
      accessKeyId: "AKIA44Y6CDEC4M7H3RWE",
      secretAccessKey: "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",
    };

    this.s3 = new S3Client(s3Config);
    this.bucketName = bucketName || "dicom-router-ap-south-1";
  }

  async getSignedUploadUrl(Key, expiresIn = 3600, tags = {}) {
    console.info(`S3Service.getSignedUploadUrl :: ${Key}`);
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key,
      Tagging: new URLSearchParams(tags).toString(),
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async getSignedDownloadUrl(Key, expiresIn = 3600) {
    console.info(`S3Service.getSignedDownloadUrl :: ${Key}`);
    if (!Key) return "";
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key });
    return getSignedUrl(this.s3, command, { expiresIn });
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
