const AdmZip = require("adm-zip");
// Only the degenerate form: no attrs, or only tx="0", in either the
// self-closing ("<a:tile.../>") OR open+empty-close ("<a:tile...></a:tile>")
// shape. x2t's CXmlWriter emits the open+close shape for picture tiles
// (see e.g. the sample docx examined while writing this patch); slide
// shapes can emit the self-closing shape, so we cover both. A real tile
// always carries sx/sy/algn/flip/ty and won't match either alternative.
const DEGENERATE_TILE_RE = /<a:tile(?:\s+tx="0")?\s*(?:\/>|><\/a:tile>)/g;
const STRETCH_REPLACEMENT = "<a:stretch><a:fillRect/></a:stretch>";
// XML parts inside a docx where pictures can appear. Headers/footers are
// indexed (header1.xml, footer2.xml, ...). Comments/footnotes/endnotes can
// host pictures via <w:drawing> the same way the body does.
const PATCH_TARGETS =
  /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
function patchXml(buffer) {
  const text = buffer.toString("utf8");
  let count = 0;
  const patched = text.replace(DEGENERATE_TILE_RE, () => {
    count += 1;
    return STRETCH_REPLACEMENT;
  });
  return { patched, count };
}
/**
 * Rewrite degenerate <a:tile> blipFill markers in-place inside a docx.
 *
 * @param {string} docxPath Absolute path to the docx file to patch.
 
 * @returns { Promise < { totalRewrites: number, touchedEntries: number } >}
 */
async function fixBlipFillTilesInDocx(docxPath) {
  const zip = new AdmZip(docxPath);
  const entries = zip.getEntries();
  let totalRewrites = 0;
  let touchedEntries = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!PATCH_TARGETS.test(entry.entryName)) continue;
    const original = entry.getData();
    const { patched, count } = patchXml(original);
    if (count === 0) continue;
    zip.updateFile(entry.entryName, Buffer.from(patched, "utf8"));
    totalRewrites += count;
    touchedEntries += 1;
  }
  if (totalRewrites > 0) {
    zip.writeZip(docxPath);
    console.log(
      `[docx_fix_blip_tile] rewrote ${totalRewrites} degenerate <a:tile> -> <a:stretch> across ${touchedEntries} xml part(s) of ${docxPath}`
    );
  } else {
    console.log(
      `[docx_fix_blip_tile] no degenerate tiles found in ${docxPath}`
    );
  }
  return { totalRewrites, touchedEntries };
}
module.exports = { fixBlipFillTilesInDocx };
