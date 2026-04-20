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
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { inspect, promisify } = require("util");
const pipeline = promisify(stream.pipeline);

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

  /**
   * Lists object keys under a prefix (paginated). Omits keys that look like empty "folder" placeholders.
   * @param {string} prefix S3 key prefix (e.g. "jobs/abc/changes/")
   * @returns {Promise<string[]>}
   */
  async listObjectKeysUnderPrefix(prefix) {
    if (!prefix) return [];
    const keys = [];
    let continuationToken = undefined;
    do {
      const resp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of resp.Contents || []) {
        if (!obj.Key) continue;
        if (obj.Key.endsWith("/")) continue;
        keys.push(obj.Key);
      }
      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
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
