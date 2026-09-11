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
  }),
});

// S3 tag schema
const s3TagSchema = Joi.object({
  key: Joi.string().min(1).max(128).required().messages({
    "string.max": "Tag key cannot exceed 128 characters",
    "any.required": "Tag key is required",
  }),

  value: Joi.string().min(1).max(256).required().messages({
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
    .required()
    .custom((value, helpers) => {
      if (!SUPPORTED_OUTPUT_TYPES.includes(value)) {
        return helpers.error("any.only");
      }
      const state = helpers.state.ancestors;
      const inputType = state[state.length - 1].inputFile.type;

      if (inputType && inputType !== "bin" && value === inputType) {
        return helpers.error("any.invalid", { inputType });
      }
      return value;
    }, "output type vs input type check")
    .messages({
      "any.only": `Output file type must be one of: ${SUPPORTED_OUTPUT_TYPES.join(
        ", "
      )}`,
      "any.required": "Output file type is required",
      "any.invalid":
        "Output type cannot be the same as input type (input: {{#inputType}})",
    }),

  location: Joi.string().required().messages({
    "any.required": "Output S3 Location is required",
  }),

  preserveFormatting: Joi.boolean().when("type", {
    is: "html",
    then: Joi.optional().default(false),
    otherwise: Joi.forbidden(),
  }),

  backgroundImageLocation: Joi.string().when("type", {
    is: "pdf",
    then: Joi.optional(),
    otherwise: Joi.forbidden().messages({
      "any.unknown": "Background image is only supported for PDF output files",
    }),
  }),
  tags: Joi.array().items(s3TagSchema).max(10).optional().messages({
    "array.max": "Cannot exceed 10 tags per output file (AWS limit)",
  }),
});

// S3 keys to place beside input.bin before x2t (e.g. under source/media/…).
// relativePath must stay under source/ (no ..); use the same paths the document
// references (often media/<hex> to match editor mapper keys).
const changesMediaFileSchema = Joi.object({
  location: Joi.string().min(1).required().messages({
    "any.required": "S3 key for the media object is required",
  }),
  relativePath: Joi.string()
    .min(1)
    .max(1024)
    .required()
    .custom((value, helpers) => {
      if (value.includes("..") || value.startsWith("/") || value.startsWith("\\")) {
        return helpers.error("any.invalid");
      }
      return value.replace(/\\/g, "/");
    })
    .messages({
      "any.invalid":
        "relativePath must not contain '..' or start with a path separator",
    }),
});

const lambdaEventSchema = Joi.object({
  inputFile: inputFileSchema.required(),

  changesFileLocation: Joi.string().optional(),

  changesMediaFiles: Joi.array()
    .items(changesMediaFileSchema)
    .max(500)
    .optional()
    .messages({
      "array.max": "Cannot exceed 500 companion media files per conversion",
    }),

  outputFiles: Joi.array()
    .items(outputFileSchema)
    .min(1)
    .max(6)
    .required()
    .messages({
      "array.min": "At least one output file is required",
      "array.max": "Cannot exceed 6 output files per request",
    }),

  region: Joi.string()
    .valid(...AWS_REGIONS)
    .default("ap-south-1")
    .messages({
      "any.only": `Region must be one of: ${AWS_REGIONS.join(", ")}`,
    }),
  bucket: Joi.string().optional(),
}).unknown(false);

module.exports = {
  lambdaEventSchema,
  SUPPORTED_INPUT_TYPES,
  SUPPORTED_OUTPUT_TYPES,
  AWS_REGIONS,
};
