const path = require("path");
const { promises: fs } = require("fs");
const spawnAsync = require("@expo/spawn-async");
const config = require("config");
const { getStringFromFormat } = require("../../resources/utils");
const {
  LD_LIBRARY_PATH,
  BIN_SPAWN_PATH,
  DOC_BUILDER_PATH,
} = require("../../resources/constants");

class DocBuilderConverter {
  constructor() {
    this.docbuilderPath =
      config.get("FileConverter.converter.docbuilderPath") || DOC_BUILDER_PATH;
    this.spawnOptions = config.util.cloneDeep(
      config.get("FileConverter.converter.spawnOptions")
    );
  }
  async convert({ sourceFile, outputFiles, tempDir, key }) {
    console.log("Starting DocBuilder conversion...");
    console.log(`Input DOCX file: ${sourceFile}`);
    console.log(`Output files: ${outputFiles.length}`);

    // Generating a DocBuilder script that will process the input DOCX file
    const script = this.generateDocBuilderScript(sourceFile, outputFiles);

    // Writing the generated script to temp directory
    const scriptFile = path.join(
      tempDir,
      `conversion_script_${key}.docbuilder`
    );
    await fs.writeFile(scriptFile, script, "utf8");

    console.log(`Generated DocBuilder script: ${scriptFile}`);
    console.log("Script content:", script);
    const spawnOptions = Object.assign({}, this.spawnOptions);
    spawnOptions.env = Object.assign({}, process.env, spawnOptions.env, {
      LD_LIBRARY_PATH: LD_LIBRARY_PATH,
      PATH: process.env.PATH + BIN_SPAWN_PATH,
    });

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
      outputFiles: outputFiles.map((f) => f.path),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  generateDocBuilderScript(inputFile, outputFiles) {
    // IMPORTANT NOTE :::
    // please dont use try catch as docBuilder use old javascript parser and it fails
    const script = `
    
    console.log("Starting script execution.");

    console.log("Opening input file: ${inputFile}");
    builder.OpenFile("${inputFile}");
    
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
            if (classType === "run") {
                oNestedElement.SetColor(0, 0, 0);
                oNestedElement.SetHighlight("none");
                oNestedElement.SetShd("nil");   
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

    console.log("Processing document to remove formatting...");
    processElement(oDocument);

     ${outputFiles
       .map((outputFile, index) => {
         const formatString = getStringFromFormat(outputFile.format);
         return `
    console.log("Saving file ${index + 1} as: ${formatString} to ${
           outputFile.path
         }");
    builder.SaveFile("${formatString}", "${outputFile.path}");`;
       })
       .join("")}
    
    console.log("Closing document...");
    builder.CloseFile();
    
    console.log("Script execution completed successfully.");
    
`;

    return script;
  }
}
module.exports = DocBuilderConverter;
