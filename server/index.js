const { ConversionService } = require("./modules");
const { extractParams } = require("./resources/helpers");
const { AVS_OFFICESTUDIO_FILE_CANVAS_WORD } = require("./resources/constants");
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
    // Scenario:
    // 2. Download the input and changes files from S3
    // 3. If input file has .bin extension (in our case bin is always AVS_OFFICESTUDIO_FILE_CANVAS_WORD)
    //   3.1 convert the .bin file to .docx with or without changes file using x2t - with formatting
    //   3.2 then use docBuilder to remove highlight  and convert .docx to all output file types
    // 4. if input file type is not .bin
    //   4.1 convert the input file to output files with or without changes using x2t
    // 5. if backgroundImage is present in outputFiles and  type is pdf, embed background image to it
    // 5. upload all output files where location is present to their location

    // SAMPLE PARAMS

    //   {
    //     "inputFile": {
    //       "type": "docx",
    //       "location": "ofc/input.docx"
    //     },
    //     "outputFiles": [
    //       {
    //         "":""
    //         "type": "pdf",
    //         "location": "ofc/output",
    //         "backgroundImageUrl": "ofc/letterhead.jpg",
    //         "tags": [
    //           {"Key": "reportId", "Value": "SomeId"}
    //         ]
    //       }
    //     ],
    //     "region": "us-east-1"
    //   }

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
