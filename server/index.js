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

    // console.log("Validated params:", validatedParams);
    // return { message: "VALIDATION WORKS!!" };

    // Set conversion parameters

    //   {
    //     "inputFile": {
    //       "type": "docx",
    //       "location": "https://example.com/input.docx"
    //     },
    //     "outputFiles": [
    //       {
    //         "type": "pdf",
    //         "location": "https://example.com/output/",
    //         "backgroundImageUrl": "https://example.com/letterhead.jpg",
    //         "tags": [
    //           {"Key": "Department", "Value": "Marketing"}
    //         ]
    //       }
    //     ],
    //     "region": "us-east-1"
    //   }
    const s3Service = new S3Service(params.bucket, params.region);
    const conversionParams = { ...params, s3Service };

    if (params.inputFile.type === AVS_OFFICESTUDIO_FILE_CANVAS_WORD) {
      if (params.changesFileLocation) {
        // TODO::
        //1. Download the changes file and rename it to changes0.json
        //2. Save changes0.json to same directory as input File
        //2. Use x2t converter and set fromChanges flag to be true
      }
      //TODO::
      //1. convert to docx using x2t with Formatting[BG COLOR + others] --> bin --> upload to s3
      //2. convert to docx using docBuilder without Formatting
      //3. convert these without Formatting docx file to output types and upload to s3
    } else {
      //TODO::
      //1. convert this input type using x2t to output types and upload to s3
    }
    // conversionParams = {
    //   filetype: params.filetype || "docx",
    //   outputType: params.outputType || "pdf",
    //   inputSource: params.url || "/var/task/samples/sampleDoc.docx",
    //   key: params.key || `lambda_${Date.now()}`,
    //   region: params.region,
    //   fromChanges: params.fromChanges || false,
    //   includeBase64: params.includeBase64 === true,
    //   converter: params.converter || "x2t", // Allow choosing converter
    // };

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
