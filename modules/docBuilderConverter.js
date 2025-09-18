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
    const inputFileName = path.basename(inputFile);
    const outputFileName = path.basename(outputFile);

    // IMPORTANT NOTE :::
    // please dont use try catch as docBuilder use old javascript parser and it fails
    const script = `
    
    console.log("Starting script execution.");

    console.log("Opening input file: source/${inputFileName}");
    builder.OpenFile("source/${inputFileName}");
    
    console.log("Document loaded successfully");
    const oDocument = Api.GetDocument();

    //Functions to remove backgroundColor and Text Color to black
    function rgbToHex(_rgbaColor) {
        const rgbColor = _rgbaColor?.Unicolor?.color?.RGBA;
        if (!rgbColor || rgbColor.R === undefined) {
            return null;
        }
         const toHex = (c) => ('0' + c.toString(16)).slice(-2);
        return "#" + toHex(rgbColor.R) + toHex(rgbColor.G) + toHex(rgbColor.B);
    }   
 
 
    function processElement(oElement) {
        const numElements = oElement?.GetElementsCount?.() || 0;
        for (let i = 0; i < numElements; i++) {
            const oNestedElement = oElement.GetElement(i);
            const classType = oNestedElement.GetClassType();
            console.log("ClassType ::",classType);
            if (classType === "run") {
                const oTextPr = oNestedElement.GetTextPr();
                const rgbColor = oTextPr.GetColor();
                const newTextPr = Api.CreateTextPr();
 
                // Check if the color matches and change it to black
                if (['#ed7d31', '#0070c0'].includes(rgbToHex(rgbColor))) {
                    console.log("Setting color of ::", oNestedElement.GetText());
                    // Set the color on the text properties object
                    // oTextPr.SetColor(0, 0, 0);
                    newTextPr.SetColor(0, 0, 0);
                }
                if (oTextPr.GetHighlight() && oTextPr.GetHighlight() == "yellow") {
                    console.log("Setting highlight of"+ oTextPr + " - "+ oTextPr.GetHighlight() + " to none");
                    newTextPr.SetHighlight("none");
                }
                // Apply the new text properties object to the run
                oNestedElement.SetTextPr(newTextPr);
            } else if (
            classType === "paragraph" ||
            classType === "table" ||
            classType === "hyperlink" ||
            classType === "inlineLvlSdt" ||
            classType === "blockLvlSdt"
            ) {
                // Recursively process nested elements within these container types
                processElement(oNestedElement?.GetContent?.() || oNestedElement);
            }
        }
    }
    
    console.log("Saving file as: ${formatString} to result/${outputFileName}");
    builder.SaveFile("${formatString}", "result/${outputFileName}");
    
    console.log("Closing document...");
    builder.CloseFile();
    
    console.log("Script execution completed successfully.");
    
`;

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
