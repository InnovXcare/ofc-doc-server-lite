/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

"use strict";

var constants = require("./constants");
const locale = require("windows-locale");

//Fix EPROTO error in node 8.x at some web sites(https://github.com/nodejs/node/issues/21513)
exports.encodeXml = function (value) {
  return value.replace(/[<>&'"\r\n\t\xA0]/g, function (c) {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      case "\r":
        return "&#xD;";
      case "\n":
        return "&#xA;";
      case "\t":
        return "&#x9;";
      case "\xA0":
        return "&#xA0;";
    }
  });
};

exports.getFormatFromString = function (ext) {
  if (!ext) {
    return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
  }
  switch (ext.toLowerCase()) {
    case "docx":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX;
    case "doc":
    case "wps":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC;
    case "odt":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT;
    case "rtf":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF;
    case "txt":
    case "xml":
    case "xslt":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT;
    case "htm":
    case "html":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML;
    case "mht":
    case "mhtml":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT;
    case "epub":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB;
    case "fb2":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2;
    case "mobi":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI;
    case "docm":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM;
    case "dotx":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX;
    case "dotm":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM;
    case "fodt":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT;
    case "ott":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT;
    case "oform":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM;
    case "docxf":
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF;

    case "pptx":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX;
    case "ppt":
    case "dps":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT;
    case "odp":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP;
    case "ppsx":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX;
    case "pptm":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM;
    case "ppsm":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM;
    case "potx":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX;
    case "potm":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM;
    case "fodp":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT;
    case "otp":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP;
    case "odg":
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODG;

    case "xlsx":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX;
    case "xls":
    case "et":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS;
    case "ods":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS;
    case "csv":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV;
    case "xlsm":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM;
    case "xltx":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX;
    case "xltm":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM;
    case "xlsb":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB;
    case "fods":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT;
    case "ots":
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS;

    case "jpeg":
    case "jpe":
    case "jpg":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_JPG;
    case "tif":
    case "tiff":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF;
    case "tga":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TGA;
    case "gif":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF;
    case "png":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG;
    case "emf":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_EMF;
    case "wmf":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_WMF;
    case "bmp":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_BMP;
    case "cr2":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_CR2;
    case "pcx":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PCX;
    case "ras":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_RAS;
    case "psd":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PSD;
    case "ico":
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_ICO;

    case "pdf":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
    case "pdfa":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA;
    case "swf":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SWF;
    case "djvu":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU;
    case "xps":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
    case "svg":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG;
    case "htmlr":
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR;
    case "doct":
      return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY;
    case "xlst":
      return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY;
    case "pptt":
      return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY;
    case "ooxml":
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML;
    case "odf":
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_ODF;
    case "vsdx":
      return constants.AVS_OFFICESTUDIO_FILE_DRAW_VSDX;
    case "vssx":
      return constants.AVS_OFFICESTUDIO_FILE_DRAW_VSSX;
    case "vstx":
      return constants.AVS_OFFICESTUDIO_FILE_DRAW_VSTX;
    case "vsdm":
      return constants.AVS_OFFICESTUDIO_FILE_DRAW_VSDM;
    case "vssm":
      return constants.AVS_OFFICESTUDIO_FILE_DRAW_VSSM;
    case "vstm":
      return constants.AVS_OFFICESTUDIO_FILE_DRAW_VSTM;
    default:
      return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
  }
};
exports.getStringFromFormat = function (format) {
  switch (format) {
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX:
      return "docx";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC:
      return "doc";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT:
      return "odt";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF:
      return "rtf";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT:
      return "txt";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML:
      return "html";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT:
      return "mht";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB:
      return "epub";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2:
      return "fb2";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI:
      return "mobi";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM:
      return "docm";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX:
      return "dotx";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM:
      return "dotm";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT:
      return "fodt";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT:
      return "ott";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC_FLAT:
      return "doc";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_FLAT:
      return "docx";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML_IN_CONTAINER:
      return "doc";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE:
      return "xml";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM:
      return "oform";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF:
      return "docxf";
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM_PDF:
      return "pdf";

    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX:
      return "pptx";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT:
      return "ppt";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP:
      return "odp";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX:
      return "ppsx";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM:
      return "pptm";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM:
      return "ppsm";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX:
      return "potx";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM:
      return "potm";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT:
      return "fodp";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP:
      return "otp";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE:
      return "xml";
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODG:
      return "odg";

    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX:
      return "xlsx";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS:
      return "xls";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS:
      return "ods";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV:
      return "csv";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM:
      return "xlsm";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX:
      return "xltx";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM:
      return "xltm";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB:
      return "xlsb";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT:
      return "fods";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS:
      return "ots";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT:
      return "xlsx";
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_PACKAGE:
      return "xml";

    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF:
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA:
      return "pdf";
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SWF:
      return "swf";
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU:
      return "djvu";
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS:
      return "xps";
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG:
      return "svg";
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR:
      return "htmlr";

    case constants.AVS_OFFICESTUDIO_FILE_OTHER_HTMLZIP:
      return "zip";
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_JSON:
      return "json";

    case constants.AVS_OFFICESTUDIO_FILE_IMAGE:
      return "zip";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_JPG:
      return "jpg";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF:
      return "tiff";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_TGA:
      return "tga";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF:
      return "gif";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG:
      return "png";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_EMF:
      return "emf";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_WMF:
      return "wmf";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_BMP:
      return "bmp";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_CR2:
      return "cr2";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PCX:
      return "pcx";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_RAS:
      return "ras";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PSD:
      return "psd";
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_ICO:
      return "ico";

    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD:
    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET:
    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION:
    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_PDF:
      return "bin";
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DOCUMENT:
    case constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY:
      return "doct";
    case constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY:
      return "xlst";
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_PRESENTATION:
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DRAWING:
    case constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY:
      return "pptt";
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML:
      return "ooxml";
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_ODF:
      return "odf";
    case constants.AVS_OFFICESTUDIO_FILE_DRAW_VSDX:
      return "vsdx";
    case constants.AVS_OFFICESTUDIO_FILE_DRAW_VSSX:
      return "vssx";
    case constants.AVS_OFFICESTUDIO_FILE_DRAW_VSTX:
      return "vstx";
    case constants.AVS_OFFICESTUDIO_FILE_DRAW_VSDM:
      return "vsdm";
    case constants.AVS_OFFICESTUDIO_FILE_DRAW_VSSM:
      return "vssm";
    case constants.AVS_OFFICESTUDIO_FILE_DRAW_VSTM:
      return "vstm";
    default:
      return "";
  }
};
exports.localeToLCID = function localeToLCID(lang) {
  let elem = locale[lang && lang.toLowerCase()];
  return elem && elem.id;
};
