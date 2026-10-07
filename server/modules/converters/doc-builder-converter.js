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
  async convert({
    sourceFile,
    outputFiles,
    tempDir,
    key,
    preserveFormatting = false,
    headerElements = [],
  }) {
    console.log("Starting DocBuilder conversion...");
    console.log(`Input DOCX file: ${sourceFile}`);
    console.log(`Output files: ${outputFiles.length}`);

    // Generating a DocBuilder script that will process the input DOCX file
    const script = this.generateDocBuilderScript(
      sourceFile,
      outputFiles,
      preserveFormatting,
      headerElements
    );

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

  generateDocBuilderScript(
    inputFile,
    outputFiles,
    preserveFormatting = false,
    headerElements = []
  ) {
    // IMPORTANT NOTE :::
    // please dont use try catch as docBuilder use old javascript parser and it fails
    const { fontColors, highlightColors } = this.getColorsToRemove();
    const script = `
    
    console.log("Starting script execution.");

    console.log("Opening input file: ${inputFile}");
    builder.OpenFile("${inputFile}");
    
    console.log("Document loaded successfully");
    const oDocument = Api.GetDocument();

    var PATIENT_HEADER_ELEMENTS = ${JSON.stringify(headerElements)};

    function applyHeaderRunFormat(oRun, oDescriptor) {
      if (oDescriptor.bold) oRun.SetBold(true);
      if (oDescriptor.italic) oRun.SetItalic(true);
      if (oDescriptor.underline) oRun.SetUnderline(true);
      if (oDescriptor.caps) oRun.SetCaps(true);
      if (oDescriptor.fontSize) oRun.SetFontSize(oDescriptor.fontSize);
    }

    function fillHeaderParagraph(oParagraph, aRuns) {
      for (var i = 0; i < aRuns.length; i++) {
        var oRunDescriptor = aRuns[i];
        if (oRunDescriptor.type === "linebreak") {
          oParagraph.AddLineBreak();
        } else {
          var oRun = oParagraph.AddText(oRunDescriptor.text);
          applyHeaderRunFormat(oRun, oRunDescriptor);
        }
      }
    }

    function renderHeaderTable(oDescriptor) {
      var oTable = Api.CreateTable(oDescriptor.cols, oDescriptor.rows);
      oTable.SetWidth(oDescriptor.width.unit, oDescriptor.width.value);
      oTable.SetTableCellMarginTop(0);
      oTable.SetTableCellMarginBottom(0);

      if (oDescriptor.borders) {
        oTable.SetTableBorderTop("single", 4, 0, 0, 0, 0);
        oTable.SetTableBorderBottom("single", 4, 0, 0, 0, 0);
        oTable.SetTableBorderLeft("single", 4, 0, 0, 0, 0);
        oTable.SetTableBorderRight("single", 4, 0, 0, 0, 0);
        oTable.SetTableBorderInsideH("single", 4, 0, 0, 0, 0);
        oTable.SetTableBorderInsideV("single", 4, 0, 0, 0, 0);
      }

      var aMerges = [];
      for (var r = 0; r < oDescriptor.rowData.length; r++) {
        var oRowDescriptor = oDescriptor.rowData[r];
        for (var c = 0; c < oRowDescriptor.cells.length; c++) {
          var oCellDescriptor = oRowDescriptor.cells[c];
          var nColumn = oCellDescriptor.colIndex;
          var oCell = oTable.GetRow(r).GetCell(nColumn);

          if (oCellDescriptor.width) {
            oCell.SetWidth(
              oCellDescriptor.width.unit,
              oCellDescriptor.width.value
            );
          }

          var oParagraph = oCell.GetContent().GetElement(0);
          if (oParagraph) {
            oParagraph.SetSpacingBefore(0);
            oParagraph.SetSpacingAfter(0);
            oParagraph.SetJc(oCellDescriptor.align);
            fillHeaderParagraph(oParagraph, oCellDescriptor.runs);
          }

          if (oCellDescriptor.colspan > 1) {
            aMerges.push({
              row: r,
              colStart: nColumn,
              colspan: oCellDescriptor.colspan,
            });
          }
        }
      }

      aMerges.sort(function (a, b) {
        if (a.row !== b.row) return a.row - b.row;
        return b.colStart - a.colStart;
      });
      for (var m = 0; m < aMerges.length; m++) {
        var oMerge = aMerges[m];
        var aCells = [];
        for (
          var mc = oMerge.colStart;
          mc < oMerge.colStart + oMerge.colspan;
          mc++
        ) {
          aCells.push(oTable.GetRow(oMerge.row).GetCell(mc));
        }
        oTable.MergeCells(aCells);

        var oMergedCell = oTable
          .GetRow(oMerge.row)
          .GetCell(oMerge.colStart);
        if (oMergedCell) {
          var oMergedContent = oMergedCell.GetContent();
          for (
            var p = oMergedContent.GetElementsCount() - 1;
            p > 0;
            p--
          ) {
            oMergedContent.RemoveElement(p);
          }
        }
      }

      return oTable;
    }

    function renderHeaderParagraph(oDescriptor) {
      var oParagraph = Api.CreateParagraph();
      oParagraph.SetJc(oDescriptor.align);
      if (oDescriptor.heading) {
        oParagraph.SetStyle(
          Api.CreateStyle(oDescriptor.heading, "paragraph")
        );
      }
      fillHeaderParagraph(oParagraph, oDescriptor.runs);
      return oParagraph;
    }

    function insertPatientHeader(oDocument, aDescriptors) {
      if (!aDescriptors || aDescriptors.length === 0) return;

      var aSections = oDocument.GetSections();
      if (!aSections || aSections.length === 0) return;

      for (var s = 0; s < aSections.length; s++) {
        var oHeader = aSections[s].GetHeader("default", true);
        if (!oHeader) continue;
        oHeader.RemoveAllElements();

        for (var e = 0; e < aDescriptors.length; e++) {
          var oDescriptor = aDescriptors[e];
          if (oDescriptor.type === "table") {
            oHeader.AddElement(e, renderHeaderTable(oDescriptor));
          } else {
            oHeader.AddElement(e, renderHeaderParagraph(oDescriptor));
          }
        }
      }
    }

    insertPatientHeader(oDocument, PATIENT_HEADER_ELEMENTS);

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
