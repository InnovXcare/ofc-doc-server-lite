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
  async convert({ sourceFile, outputFiles, tempDir, key, preserveFormatting = false }) {
    console.log("Starting DocBuilder conversion...");
    console.log(`Input DOCX file: ${sourceFile}`);
    console.log(`Output files: ${outputFiles.length}`);

    // Generating a DocBuilder script that will process the input DOCX file
    const script = this.generateDocBuilderScript(sourceFile, outputFiles, preserveFormatting);

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

  // Reads the ixc-llm-svc report colors from config and returns them as [r, g, b] triplets.
  getColorsToRemove() {
    const colors = config.get("FileConverter.reportColors");
    const toRgb = (hex) => {
      const h = hex.replace("#", "");
      return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
    };
    return {
      fontColors: [
        colors.ORANGECOLOR,
        colors.LEGACY_ORANGECOLOR,
        colors.BLUECOLOR,
      ].map(toRgb),
      highlightColors: [colors.BACKGROUND_YELLOWCOLOR].map(toRgb),
    };
  }

  generateDocBuilderScript(inputFile, outputFiles, preserveFormatting = false) {
    // IMPORTANT NOTE :::
    // please dont use try catch as docBuilder use old javascript parser and it fails
    const { fontColors, highlightColors } = this.getColorsToRemove();
    const script = `
    
    console.log("Starting script execution.");

    console.log("Opening input file: ${inputFile}");
    builder.OpenFile("${inputFile}");
    
    console.log("Document loaded successfully");
    const oDocument = Api.GetDocument();

    // Colors applied by ixc-llm-svc (see FileConverter.reportColors in config).
    // Only these are stripped; every other font color / highlight is preserved.
    var REMOVE_FONT_COLORS = ${JSON.stringify(fontColors)};
    var REMOVE_HIGHLIGHT_COLORS = ${JSON.stringify(highlightColors)};

    function colorInList(oColor, aList) {
      if (!oColor || oColor.Auto) {
        return false;
      }
      for (var i = 0; i < aList.length; i++) {
        if (oColor.r === aList[i][0] && oColor.g === aList[i][1] && oColor.b === aList[i][2]) {
          return true;
        }
      }
      return false;
    }

    // Removes only the specific font colors / highlights listed above.
    function normalizeTextPr(oTextPr) {
      if (!oTextPr || !oTextPr.TextPr) {
        return;
      }

      var oPr = oTextPr.TextPr;

      if (colorInList(oPr.Color, REMOVE_FONT_COLORS)) {
        oTextPr.SetColor(0, 0, 0, false);
      }

      // The highlight may be stored as a real highlight or as character shading.
      if (colorInList(oPr.HighLight, REMOVE_HIGHLIGHT_COLORS)) {
        oTextPr.SetHighlight("none");
      }
      if (oPr.Shd && colorInList(oPr.Shd.Fill, REMOVE_HIGHLIGHT_COLORS)) {
        oTextPr.SetShd("nil", 0, 0, 0);
      }
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

    ${
      preserveFormatting
        ? 'console.log("Preserving document font colors and highlights.");'
        : 'console.log("Processing document to remove LLM font colors and highlight...");\n    processElement(oDocument);'
    }

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
