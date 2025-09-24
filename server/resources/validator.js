const { Joi } = require("celebrate");

const SUPPORTED_INPUT_TYPES = ["bin", "docx", "rtf", "txt", "html", "pdf"];

const SUPPORTED_OUTPUT_TYPES = ["bin", "docx", "rtf", "txt", "html", "pdf"];

const AWS_REGIONS = [
  "us-east-1",
  "ap-south-1",
  "ap-southeast-1",
  "ca-central-1",
  "sa-east-1",
];

// Input file schema
const inputFileSchema = Joi.object({
  type: Joi.string()
    .valid(...SUPPORTED_INPUT_TYPES)
    .required()
    .messages({
      "any.only": `Input file type must be one of: ${SUPPORTED_INPUT_TYPES.join(
        ", "
      )}`,
      "any.required": "Input file type is required",
    }),

  location: Joi.string().required().messages({
    "any.required": "Input file location is required",
    "string.uri": "Input file location must be a valid URL",
  }),
});

// S3 tag schema
const s3TagSchema = Joi.object({
  Key: Joi.string().min(1).max(128).required().messages({
    "string.max": "Tag key cannot exceed 128 characters",
    "any.required": "Tag key is required",
  }),

  Value: Joi.string().min(1).max(256).required().messages({
    "string.max": "Tag value cannot exceed 256 characters",
    "any.required": "Tag value is required",
  }),
});

// Output file schema
const outputFileSchema = Joi.object({
  key: Joi.string().min(1).max(1024).optional().messages({
    "string.max": "Output file key cannot exceed 1024 characters",
  }),

  type: Joi.string()
    .valid(...SUPPORTED_OUTPUT_TYPES)
    .required()
    .messages({
      "any.only": `Output file type must be one of: ${SUPPORTED_OUTPUT_TYPES.join(
        ", "
      )}`,
      "any.required": "Output file type is required",
    }),

  location: Joi.string().required().messages({
    "string.uri": "Output location must be a valid URL",
  }),

  backgroundImageUrl: Joi.string()
    .when("type", {
      is: "pdf",
      then: Joi.optional(),
      otherwise: Joi.forbidden().messages({
        "any.unknown":
          "Background image is only supported for PDF output files",
      }),
    })
    .messages({
      "string.uri": "Background image must be a valid URL",
    }),

  tags: Joi.array().items(s3TagSchema).max(10).optional().messages({
    "array.max": "Cannot exceed 10 tags per output file (AWS limit)",
  }),
});

const lambdaEventSchema = Joi.object({
  inputFile: inputFileSchema.required(),

  changesFileLocation: Joi.string().optional().allow("").messages({
    "string.uri": "Changes file location must be a valid URL",
  }),

  outputFiles: Joi.array()
    .items(outputFileSchema)
    .min(1)
    .max(2)
    .required()
    .messages({
      "array.min": "At least one output file is required",
      "array.max": "Cannot exceed 10 output files per request",
    }),

  region: Joi.string()
    .valid(...AWS_REGIONS)
    .default("ap-south-1")
    .messages({
      "any.only": `Region must be one of: ${AWS_REGIONS.join(", ")}`,
    }),
  bucket: Joi.string().optional(),

  includeBase64: Joi.boolean().optional().default(false),

  converter: Joi.string()
    .optional()
    .valid("x2t", "docbuilder")
    .default("x2t")
    .messages({
      "any.only": 'Converter must be either "x2t" or "docbuilder"',
    }),
}).unknown(false);

module.exports = {
  lambdaEventSchema,
  SUPPORTED_INPUT_TYPES,
  SUPPORTED_OUTPUT_TYPES,
  AWS_REGIONS,
};
