const { promises: fs } = require("fs");

// Bin-side counterpart of patches/tile-fix.js.
//
// In an OnlyOffice .bin a picture fill is serialized as a TLV record:
// 1-byte tag + 4-byte little-endian length + body. Inside the BlipFill body
// the writer picks exactly one of two sub-records to encode the fill mode
// (see sdkjs/common/Shapes/SerializeWriter.js for the JS writer and
// core/OOXML/PPTXFormat/Logic/Fills/BlipFill.cpp + Blip.cpp + Tile.cpp for
// the C++/x2t side that actually emits the bins we patch here):
//
//   StartRecord(2) ...attrs... EndRecord()   // tile
//   StartRecord(3) EndRecord()               // stretch
//
// When the source docx had `<a:tile/>` (no attributes) the tile body is just
// `FA FB` (g_nodeAttributeStart=0xFA, g_nodeAttributeEnd=0xFB). When the
// source docx had `<a:tile tx="0"/>` only the tx attribute is set and the
// tile body is `FA 02 00 00 00 00 FB` (attr-tag=2 for tx, int32 LE value 0).
// These are the two forms our companion regex in tile-fix.js catches.
//
// Flipping the sub-record tag byte from 0x02 (tile) to 0x03 (stretch)
// converts the fill mode without changing any byte counts. The stretch
// reader iterates its body by length and silently drops unknown sub-tags
// via `default: break`, so the trailing attribute payload becomes inert
// padding. On the next editor save `fill.tile` is null, the writer takes
// the canonical empty-stretch branch, and the padding disappears.
//
// We don't blindly pattern-match the tile bytes - we walk the bin forward,
// validate each candidate as a real BlipFill record (sub-record TLV
// structure, plausible attributes, mandatory Blip sub-record 0), and only
// then patch tile sub-records whose body matches a degenerate shape.

const SIGNATURE = "DOCY";
const NODE_ATTR_START = 0xfa;
const NODE_ATTR_END = 0xfb;
const FILL_TYPE_BLIP = 0x01;
const SUB_TAG_BLIP = 0x00;
const SUB_TAG_SRCRECT = 0x01;
const SUB_TAG_TILE = 0x02;
const SUB_TAG_STRETCH = 0x03;
const SUB_TAG_ADDITIONAL_URLS = 0x65; // tag 101 the writer optionally emits
const VERSION_NO_BASE64 = 10;

function readHeader(buf) {
  // Header is ASCII: "DOCY;v<version>;<dataLen>;" followed by either base64
  // (version < VERSION_NO_BASE64) or raw binary (version >= VERSION_NO_BASE64).
  if (buf.length < SIGNATURE.length + 4) {
    throw new Error("file too small for a bin header");
  }
  if (buf.slice(0, SIGNATURE.length).toString("ascii") !== SIGNATURE) {
    throw new Error(`signature mismatch (expected ${SIGNATURE})`);
  }
  let i = SIGNATURE.length;
  if (buf[i++] !== 0x3b) throw new Error("missing ; after signature");
  if (buf[i++] !== 0x76) throw new Error("missing v after signature;");
  let versionStr = "";
  while (i < buf.length && buf[i] !== 0x3b) {
    versionStr += String.fromCharCode(buf[i++]);
  }
  if (buf[i++] !== 0x3b) throw new Error("missing ; after version");
  let lenStr = "";
  while (i < buf.length && buf[i] !== 0x3b) {
    lenStr += String.fromCharCode(buf[i++]);
  }
  if (buf[i++] !== 0x3b) throw new Error("missing ; after dataLen");
  const version = parseInt(versionStr, 10);
  if (!Number.isFinite(version)) {
    throw new Error(`unparseable version: "${versionStr}"`);
  }
  return { bodyOffset: i, version, declaredDataLen: parseInt(lenStr, 10) };
}

// Walk a BlipFill attribute block and return the offset just past the
// trailing g_nodeAttributeEnd, or -1 if the block doesn't validate.
//
// Schema (matches BlipFill::toPPTY in core/OOXML/PPTXFormat/Logic/Fills/
// BlipFill.cpp and ReadUniFill case FILL_TYPE_BLIP in sdkjs):
//   FA
//     [00 <int32:4>]?      dpi
//     [01 <bool:1>]?       rotWithShape
//   FB
function walkBlipFillAttrs(body, start, end) {
  if (start >= end || body[start] !== NODE_ATTR_START) return -1;
  let q = start + 1;
  while (q < end) {
    const tag = body[q];
    if (tag === NODE_ATTR_END) return q + 1;
    if (tag === 0) {
      // dpi: 4-byte int
      if (q + 5 > end) return -1;
      q += 5;
    } else if (tag === 1) {
      // rotWithShape: 1-byte bool
      if (q + 2 > end) return -1;
      q += 2;
    } else {
      // Unknown attribute tag - not a BlipFill.
      return -1;
    }
  }
  return -1;
}

// Returns descriptors for each top-level sub-record inside a BlipFill body
// (Blip / srcRect / tile / stretch / additionalUrls), or null if the body
// doesn't validate as a clean sequence of TLV records.
function walkBlipFillBody(body, attrsEnd, bodyEnd) {
  const subRecords = [];
  let q = attrsEnd;
  while (q + 5 <= bodyEnd) {
    const tag = body[q];
    const len = body.readUInt32LE(q + 1);
    const subBodyStart = q + 5;
    const subBodyEnd = subBodyStart + len;
    if (subBodyEnd > bodyEnd) return null;
    if (
      tag !== SUB_TAG_BLIP &&
      tag !== SUB_TAG_SRCRECT &&
      tag !== SUB_TAG_TILE &&
      tag !== SUB_TAG_STRETCH &&
      tag !== SUB_TAG_ADDITIONAL_URLS
    ) {
      return null;
    }
    subRecords.push({ tag, headerOffset: q, bodyStart: subBodyStart, bodyEnd: subBodyEnd });
    q = subBodyEnd;
  }
  if (q !== bodyEnd) return null;
  return subRecords;
}

// Try to parse a BlipFill record starting at body[p]. Returns the array of
// sub-record descriptors and the end offset on success, null otherwise.
function tryParseBlipFill(body, p) {
  if (p + 5 > body.length) return null;
  if (body[p] !== FILL_TYPE_BLIP) return null;
  const bodyLen = body.readUInt32LE(p + 1);
  const bodyStart = p + 5;
  const bodyEnd = bodyStart + bodyLen;
  if (bodyEnd > body.length) return null;
  // A BlipFill record body must start with the attribute block.
  const attrsEnd = walkBlipFillAttrs(body, bodyStart, bodyEnd);
  if (attrsEnd < 0) return null;
  const subRecords = walkBlipFillBody(body, attrsEnd, bodyEnd);
  if (!subRecords) return null;
  // Mandatory: the BlipFill must have a Blip sub-record (tag 0). Without
  // this we are almost certainly looking at a random tag-0x01 byte.
  if (!subRecords.some((r) => r.tag === SUB_TAG_BLIP)) return null;
  return { bodyEnd, subRecords };
}

// A tile body is "degenerate" when it carries no actual tiling intent. The
// docx-side regex in tile-fix.js catches `<a:tile/>` and `<a:tile tx="0"/>`,
// so we mirror those two cases here:
//
//   FA FB                       (no attrs)
//   FA 02 00 00 00 00 FB        (only tx=0; attr-tag=2 for tx with int32 0)
function isDegenerateTileBody(body, start, end) {
  const len = end - start;
  if (len === 2) {
    return body[start] === NODE_ATTR_START && body[start + 1] === NODE_ATTR_END;
  }
  if (len === 7) {
    return (
      body[start] === NODE_ATTR_START &&
      body[start + 1] === 0x02 && // attr tag = tx
      body[start + 2] === 0x00 &&
      body[start + 3] === 0x00 &&
      body[start + 4] === 0x00 &&
      body[start + 5] === 0x00 &&
      body[start + 6] === NODE_ATTR_END
    );
  }
  return false;
}

function scanForDegenerateTiles(body) {
  const patches = [];
  let candidates = 0;
  let validated = 0;
  let nonDegenerateTiles = 0;
  let p = 0;
  while (p + 5 < body.length) {
    if (body[p] !== FILL_TYPE_BLIP) {
      p++;
      continue;
    }
    candidates++;
    const parsed = tryParseBlipFill(body, p);
    if (!parsed) {
      p++;
      continue;
    }
    validated++;
    for (const sub of parsed.subRecords) {
      if (sub.tag !== SUB_TAG_TILE) continue;
      if (isDegenerateTileBody(body, sub.bodyStart, sub.bodyEnd)) {
        patches.push(sub.headerOffset);
      } else {
        nonDegenerateTiles++;
      }
    }
    // Skip past this BlipFill record so we don't re-enter its body.
    p = parsed.bodyEnd;
  }
  return { patches, candidates, validated, nonDegenerateTiles };
}

/**
 * Rewrite degenerate tile sub-records to stretch inside an OnlyOffice
 * `.bin` file in-place.
 *
 * @param {string} binPath Absolute path to the bin file to patch.
 * @returns {Promise<{ totalRewrites: number, validatedBlipFills: number, nonDegenerateTiles: number }>}
 */
async function fixBlipFillTilesInBin(binPath) {
  const fileBuf = await fs.readFile(binPath);

  let header;
  try {
    header = readHeader(fileBuf);
  } catch (e) {
    console.warn(
      `[bin_fix_blip_tile] header parse failed for ${binPath}: ${e.message}; skipping`
    );
    return { totalRewrites: 0, validatedBlipFills: 0, nonDegenerateTiles: 0 };
  }

  const headerBuf = fileBuf.slice(0, header.bodyOffset);
  let bodyBuf;
  let bodyIsBase64;
  if (header.version >= VERSION_NO_BASE64) {
    bodyBuf = Buffer.from(fileBuf.slice(header.bodyOffset));
    bodyIsBase64 = false;
  } else {
    const b64 = fileBuf.slice(header.bodyOffset).toString("ascii");
    bodyBuf = Buffer.from(b64, "base64");
    bodyIsBase64 = true;
  }

  const scan = scanForDegenerateTiles(bodyBuf);
  console.log(
    `[bin_fix_blip_tile] ${binPath}: validated ${scan.validated} BlipFill record(s); ` +
      `${scan.patches.length} degenerate tile(s) to flip; ` +
      `${scan.nonDegenerateTiles} tile(s) left alone`
  );
  if (scan.patches.length === 0) {
    return {
      totalRewrites: 0,
      validatedBlipFills: scan.validated,
      nonDegenerateTiles: scan.nonDegenerateTiles,
    };
  }

  for (const pos of scan.patches) {
    bodyBuf[pos] = SUB_TAG_STRETCH;
  }

  let outputBuf;
  if (bodyIsBase64) {
    const b64Out = bodyBuf.toString("base64");
    outputBuf = Buffer.concat([headerBuf, Buffer.from(b64Out, "ascii")]);
  } else {
    outputBuf = Buffer.concat([headerBuf, bodyBuf]);
  }

  await fs.writeFile(binPath, outputBuf);
  return {
    totalRewrites: scan.patches.length,
    validatedBlipFills: scan.validated,
    nonDegenerateTiles: scan.nonDegenerateTiles,
  };
}

module.exports = {
  fixBlipFillTilesInBin,
  // Exported for tests; not part of the public surface.
  _internals: {
    readHeader,
    tryParseBlipFill,
    isDegenerateTileBody,
    scanForDegenerateTiles,
  },
};
