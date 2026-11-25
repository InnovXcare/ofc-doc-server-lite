const { ConversionService, PdfMergeService } = require("./modules");
const { extractParams } = require("./resources/helpers");
const { lambdaEventSchema, mergePdfEventSchema, MERGE_OPERATION } = require("./resources/validator");
const { S3Service } = require("./modules/s3-service");

const conversionService = new ConversionService();
const pdfMergeService = new PdfMergeService();

exports.lambdaHandler = async (event, context) => {
  console.log("Lambda event:", JSON.stringify(event, null, 2));
  let reqParams;
  try {
    // Extracting parameters
    reqParams = extractParams(event);
    console.log("Extracted params:", reqParams);

    // { operation: "mergePdf", merges: [...] } merges PDFs; anything else is a conversion (unchanged).
    const isMerge = reqParams?.operation === MERGE_OPERATION;
    const schema = isMerge ? mergePdfEventSchema : lambdaEventSchema;

    const { error, value: params } = schema.validate(reqParams, {
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

    if (isMerge) {
      const startTime = Date.now();
      const result = await pdfMergeService.mergeAll(params, s3Service);
      return {
        statusCode: 200,
        body: JSON.stringify({
          error: 0,
          message: "Merge completed successfully",
          data: { ...result, processingTime: Date.now() - startTime },
        }),
      };
    }

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
        message: reqParams?.operation === MERGE_OPERATION ? "Merge failed" : "Conversion failed",
        details: error.message,
        stack:
          process.env.ENVIRONMENT_NODE_ENV === "development"
            ? error.stack
            : undefined,
      }),
    };
  }
};
