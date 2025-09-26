const { ConversionService } = require("./modules");
const { extractParams } = require("./resources/helpers");
const { lambdaEventSchema } = require("./resources/validator");
const { S3Service } = require("./modules/s3-service");

const conversionService = new ConversionService();

exports.lambdaHandler = async (event, context) => {
  console.log("Lambda event:", JSON.stringify(event, null, 2));
  try {
    // Extracting parameters
    const reqParams = extractParams(event);
    console.log("Extracted params:", reqParams);

    const { error, value: params } = lambdaEventSchema.validate(reqParams, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      console.error("Validation errors:", error.details);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 1,
          message: "Validation failed!",
          details: error.details.map((detail) => ({
            field: detail.path.join("."),
            message: detail.message,
            value: detail.context?.value,
          })),
        }),
      };
    }

    // initializing s3 service
    const s3Service = new S3Service(params.bucket, params.region);
    const conversionParams = { ...params, s3Service };

    // Perform conversion
    const startTime = Date.now();
    const result = await conversionService.convertFile(conversionParams);
    const processingTime = Date.now() - startTime;

    return {
      statusCode: 200,
      body: JSON.stringify({
        error: 0,
        message: "Conversion completed successfully",
        data: {
          ...result.data,
          processingTime,
        },
      }),
    };
  } catch (error) {
    console.error("Lambda conversion error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 1,
        message: "Conversion failed",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      }),
    };
  }
};
