const { ConversionService } = require("./modules");
const { extractParams } = require("./resources/helpers");

const conversionService = new ConversionService();

exports.lambdaHandler = async (event, context) => {
  console.log("Lambda event:", JSON.stringify(event, null, 2));

  try {
    // Extracting parameters
    const params = extractParams(event);
    console.log("Extracted params:", params);

    // Set conversion parameters
    const conversionParams = {
      filetype: params.filetype || "docx",
      outputType: params.outputType || "pdf",
      inputSource: params.url || "/var/task/samples/sampleDoc.docx",
      key: params.key || `lambda_${Date.now()}`,
      region: params.region,
      fromChanges: params.fromChanges || false,
      includeBase64: params.includeBase64 === true,
      converter: params.converter || "x2t", // Allow choosing converter
    };

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
