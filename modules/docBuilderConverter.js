const path = require("path");
const fs = require("fs");
const spawnAsync = require("@expo/spawn-async");
const config = require("config");

class DocBuilderConverter {
  constructor() {
    this.docbuilderPath =
      config.get("FileConverter.converter.docbuilderPath") ||
      "/var/runtime/documentserver/server/FileConverter/bin/docbuilder";
    this.spawnOptions = config.util.cloneDeep(
      config.get("FileConverter.converter.spawnOptions")
    );
  }
  async convert({ sourceFile, outputFile, outputFormat, tempDir, key }) {
    console.log("Starting DocBuilder conversion...");
    console.log(`Input DOCX file: ${sourceFile}`);
    console.log(`Output file: ${outputFile}`);

    // Generating a DocBuilder script that will process the input DOCX file
    const script = this.generateDocBuilderScript(
      sourceFile,
      outputFile,
      outputFormat
    );

    // Writing the generated script to temp directory
    const scriptFile = path.join(
      tempDir,
      `conversion_script_${key}.docbuilder`
    );
    fs.writeFileSync(scriptFile, script, "utf8");

    console.log(`Generated DocBuilder script: ${scriptFile}`);
    console.log("Script content:", script);
    const spawnOptions = Object.assign({}, this.spawnOptions);
    spawnOptions.env = Object.assign({}, process.env, spawnOptions.env, {
      LD_LIBRARY_PATH: "/var/runtime/lib:/var/runtime/lib64",
      FONTCONFIG_PATH: "/var/runtime/core-fonts",
      HOME: "/tmp",
      TMPDIR: "/tmp",
      PATH:
        process.env.PATH +
        ":/var/runtime/documentserver/server/FileConverter/bin",
    });

    // Setting working directory to temp directory so relative paths work
    spawnOptions.cwd = tempDir;

    // Executing DocBuilder with the generated script
    const result = await spawnAsync(
      this.docbuilderPath,
      [scriptFile],
      spawnOptions
    );
    console.log("DocBuilder execution result:", {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    });

    // Checking result
    if (result.status !== 0 && result.status !== null) {
      throw new Error(
        `DocBuilder conversion failed with status ${result.status}. stderr: ${result.stderr}`
      );
    }

    if (result.signal !== null) {
      throw new Error(
        `DocBuilder conversion killed with signal ${result.signal}. stderr: ${result.stderr}`
      );
    }

    console.log("DocBuilder conversion completed successfully");
    return {
      success: true,
      converterType: "docbuilder",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  generateDocBuilderScript(inputFile, outputFile, outputFormat) {
    const formatString = this.getDocBuilderFormatString(outputFormat);
    const outputFileName = path.basename(outputFile);

    // we can change this script to do additional things on top of it like removing highlights and other things
    const script = `
    // Auto-generated DocBuilder script for file conversion
    console.log("Starting DocBuilder conversion process...");

try {
    // Open the input DOCX file
    console.log("Opening input file:", ${JSON.stringify(inputFile)});
    builder.OpenFile(${JSON.stringify(inputFile)});
    
    // Get document reference
    const oDocument = Api.GetDocument();
    console.log("Document loaded successfully");


    // Save the document in the desired format
    builder.SaveFile(${JSON.stringify(formatString)}, ${JSON.stringify(
      outputFileName
    )});
    
    // Close the document
    console.log("Closing document...");
    builder.CloseFile();
    
    console.log("DocBuilder conversion completed successfully");
    
} catch (error) {
    console.error("DocBuilder conversion error:", error.toString());
    builder.CloseFile(); // Ensure cleanup
    throw error;
    }`;
    return script;
  }

  getDocBuilderFormatString(outputFormat) {
    const formatMap = {
      65: "docx", // Change from AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX to "docx"
      66: "doc", // Change from AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC to "doc"
      67: "odt", // Change from AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT to "odt"
      69: "rtf", // Change from AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF to "rtf"
      70: "txt", // Change from AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT to "txt"
      71: "html", // Change from AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML to "html"
      513: "pdf", // Change from AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF to "pdf"
    };

    return formatMap[outputFormat] || "pdf";
  }
}
module.exports = DocBuilderConverter;
