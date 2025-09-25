const ENVIRONMENT = Object.freeze({
  NODE_ENV: process.env.NODE_ENV,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
});
module.exports = ENVIRONMENT;
