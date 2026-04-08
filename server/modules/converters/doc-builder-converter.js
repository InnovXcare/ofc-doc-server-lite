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
  _htmlToLines(html) {
    if (!html) return [];
    let text = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  _stripHtmlEntities(text) {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
      .trim();
  }

  _parseHtmlContent(html) {
    if (!html) return null;

    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
      const tableTag = tableMatch[0].match(/<table[^>]*>/i)[0];
      const hasBorder = /border\s*=\s*['"]?\s*[1-9]/i.test(tableTag);
      const isUppercase = /text-transform\s*:\s*uppercase/i.test(tableTag);

      const rows = [];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
        const cells = [];
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          const tdTag = cellMatch[0].match(/<t[dh][^>]*>/i)[0];
          const cellContent = cellMatch[1];

          const widthMatch = tdTag.match(/width\s*:\s*(\d+)\s*(pt|px|%)/i);
          const width = widthMatch
            ? { value: parseInt(widthMatch[1]), unit: widthMatch[2].toLowerCase() }
            : null;

          const isBold = /<b\b/i.test(cellContent);

          let text = this._stripHtmlEntities(cellContent.replace(/<[^>]+>/g, ""));
          if (isUppercase) text = text.toUpperCase();

          cells.push({ text, bold: isBold, width });
        }
        if (cells.length > 0) rows.push(cells);
      }

      if (rows.length > 0) {
        const numCols = Math.max(...rows.map((r) => r.length));
        return { type: "table", rows, numCols, numRows: rows.length, hasBorder };
      }
    }

    const lines = this._htmlToLines(html);
    return lines.length > 0 ? { type: "lines", lines } : null;
  }

  _generateContentScript(parsed, prefix) {
    if (!parsed) return "";
    let s = "";

    if (parsed.type === "table") {
      const { rows, numCols, numRows, hasBorder } = parsed;
      s += `var _${prefix}Tbl = Api.CreateTable(${numCols}, ${numRows});\n`;
      s += `        _${prefix}Tbl.SetWidth("percent", 100);\n`;

      if (hasBorder) {
        ["Top", "Bottom", "Left", "Right", "InsideH", "InsideV"].forEach((side) => {
          s += `        _${prefix}Tbl.SetTableBorder${side}("single", 4, 0, 0, 0, 0);\n`;
        });
      }

      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const cell = rows[r][c];
          const safeText = JSON.stringify(cell.text);
          s += `        var _${prefix}C${r}${c} = _${prefix}Tbl.GetRow(${r}).GetCell(${c});\n`;
          s += `        var _${prefix}P${r}${c} = _${prefix}C${r}${c}.GetContent().GetElement(0);\n`;
          s += `        var _${prefix}R${r}${c} = Api.CreateRun();\n`;
          s += `        _${prefix}R${r}${c}.AddText(${safeText});\n`;
          if (cell.bold) {
            s += `        _${prefix}R${r}${c}.SetBold(true);\n`;
          }
          s += `        _${prefix}P${r}${c}.AddElement(_${prefix}R${r}${c});\n`;
          if (cell.width && cell.width.unit === "pt") {
            s += `        _${prefix}C${r}${c}.SetWidth("twips", ${cell.width.value * 20});\n`;
          }
        }
      }
      s += `        _${prefix}.Push(_${prefix}Tbl);\n`;
    } else {
      const linesJson = JSON.stringify(parsed.lines);
      s += `var _${prefix}Ls = ${linesJson};\n`;
      s += `        for (var _${prefix}i = 0; _${prefix}i < _${prefix}Ls.length; _${prefix}i++) {\n`;
      s += `            var _${prefix}p = Api.CreateParagraph();\n`;
      s += `            _${prefix}p.AddText(_${prefix}Ls[_${prefix}i]);\n`;
      s += `            _${prefix}.Push(_${prefix}p);\n`;
      s += `        }\n`;
    }

    return s;
  }

  async convert({ sourceFile, outputFiles, tempDir, key, headerFooterData }) {
    console.log("Starting DocBuilder conversion...");
    console.log(`Input DOCX file: ${sourceFile}`);
    console.log(`Output files: ${outputFiles.length}`);

    const headerContent = this._parseHtmlContent(headerFooterData?.header);
    const footerContent = this._parseHtmlContent(headerFooterData?.footer);

    // #region agent log
    console.log("[DBG-1da40b] DocBuilder headerFooterData:", JSON.stringify({hasData: !!headerFooterData, headerType: headerContent?.type, footerType: footerContent?.type, headerContent, footerContent}));
    fetch('http://127.0.0.1:7639/ingest/0dff3b0e-ba32-42d0-bddc-331239abaa07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1da40b'},body:JSON.stringify({sessionId:'1da40b',location:'doc-builder-converter.js:convert',message:'DocBuilder hdrFtr input',data:{hasData:!!headerFooterData,headerType:headerContent?.type,footerType:footerContent?.type,headerContent,footerContent},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Generating a DocBuilder script that will process the input DOCX file
    const script = this.generateDocBuilderScript(
      sourceFile,
      outputFiles,
      headerContent,
      footerContent
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

  generateDocBuilderScript(inputFile, outputFiles, headerContent, footerContent) {
    // IMPORTANT NOTE :::
    // please dont use try catch as docBuilder use old javascript parser and it fails

    let headerFooterScript = "";
    if (headerContent || footerContent) {
      let innerScript = "";

      if (headerContent) {
        innerScript += `
        console.log("[DBG-1da40b] Injecting header (type=${headerContent.type})...");
        var _hdr = _sec.GetHeader("default", true);
        if (_hdr) {
            _hdr.RemoveAllElements();
            ${this._generateContentScript(headerContent, "hdr")}
            console.log("[DBG-1da40b] header injected, elCount=" + _hdr.GetElementsCount());
        }`;
      }

      if (footerContent) {
        innerScript += `
        console.log("[DBG-1da40b] Injecting footer (type=${footerContent.type})...");
        var _ftr = _sec.GetFooter("default", true);
        if (_ftr) {
            _ftr.RemoveAllElements();
            ${this._generateContentScript(footerContent, "ftr")}
            console.log("[DBG-1da40b] footer injected, elCount=" + _ftr.GetElementsCount());
        }`;
      }

      headerFooterScript = `
    console.log("[DBG-1da40b] Injecting headers/footers...");
    var _sec = oDocument.GetFinalSection();
    console.log("[DBG-1da40b] FinalSection for hdr/ftr injection: " + !!_sec);
    if (_sec) {
        ${innerScript}
    }
`;
    }

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
                processElement(oNestedElement);
            }
            else if (classType === "table") {
              var rowCount = oNestedElement.GetRowsCount();
              for (var r = rowCount - 1; r >= 0; r--) {
                var oRow = oNestedElement.GetRow(r);
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
          }
      }

    console.log("Processing document to remove formatting...");
    processElement(oDocument);

    ${headerFooterScript}

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
