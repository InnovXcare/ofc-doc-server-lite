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

    // Normalize text properties without reintroducing shading artifacts.
    function normalizeTextPr(oTextPr) {
      if (!oTextPr) {
        return;
      }

      oTextPr.SetColor(0, 0, 0, false);
      oTextPr.SetHighlight("none");
      oTextPr.SetShd("nil", 0, 0, 0);
    }

    function normalizeRun(oRun) {
      if (!oRun || !oRun.GetTextPr) {
        return;
      }

      normalizeTextPr(oRun.GetTextPr());
    }

    // List markers can carry their own formatting separate from runs.
    function normalizeParagraph(oParagraph) {
      if (!oParagraph) {
        return;
      }

      var paragraphText = "";
      if (oParagraph.GetText) {
        paragraphText = oParagraph.GetText({
          "Numbering": true,
          "TabSymbol": "\\t",
          "NewLineSeparator": "\\n"
        });
      }

      if (oParagraph.GetParaPr) {
        var oParaPr = oParagraph.GetParaPr();
        if (oParaPr) {
          oParaPr.SetShd("clear", 0, 0, 0, true);
          console.log("Paragraph shading cleanup applied: true");
        } else {
          console.log("Paragraph shading cleanup applied: false");
        }
      }

      var oNumberingLevel = null;
      if (oParagraph.GetNumbering) {
        oNumberingLevel = oParagraph.GetNumbering();
      }
      console.log("Paragraph has numbering: " + (oNumberingLevel ? "true" : "false"));

      if (oNumberingLevel) {
        console.log(
          "Paragraph numbering level index: " + oNumberingLevel.GetLevelIndex()
        );
        normalizeTextPr(oNumberingLevel.GetTextPr());
      }
    }

    function processTable(oTable) {
      var rowCount = oTable.GetRowsCount();
      for (var r = rowCount - 1; r >= 0; r--) {
        var oRow = oTable.GetRow(r);
        var cellCount = oRow.GetCellsCount();
        for (var c = cellCount - 1; c >= 0; c--) {
          var oCell = oRow.GetCell(c);
          var oCellContent = oCell.GetContent();
          if (oCellContent) {
            processElement(oCellContent);
          }
        }
      }
    }

    function processElement(oElement) {
      if (!oElement || !oElement.GetElementsCount) {
        return;
      }

      var numElements = oElement.GetElementsCount();
      for (var i = 0; i < numElements; i++) {
        var oNestedElement = oElement.GetElement(i);
        var classType = oNestedElement.GetClassType();

        if (classType === "run") {
          normalizeRun(oNestedElement);
        } else if (classType === "paragraph") {
          normalizeParagraph(oNestedElement);
          processElement(oNestedElement);
        } else if (classType === "table") {
          processTable(oNestedElement);
        } else if (
          classType === "hyperlink" ||
          classType === "inlineLvlSdt" ||
          classType === "blockLvlSdt"
        ) {
          var oNestedContent = oNestedElement.GetContent
            ? oNestedElement.GetContent()
            : oNestedElement;
          processElement(oNestedContent);
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
