const { PDFDocument } = require("pdf-lib");

/**
 * Merges report PDFs with their montage PDFs (R1-4971 SR-4.1).
 *
 * Each merge writes one PDF: for every document, the report pages followed by that
 * report's montage pages. Several documents in one merge give a multi-exam file where
 * each montage directly follows its own report (R1-5474).
 */
class PdfMergeService {
  /**
   * @param {{ merges: Array<{ output: { location: string, tags?: Array<{key: string, value: string}> },
   *           documents: Array<{ reportLocation: string, montageLocation?: string }> }> }} params
   * @param {import("./s3-service").S3Service} s3Service
   * @returns {Promise<{ outputs: Array<{ location: string, pageCount: number, documents: number }> }>}
   */
  async mergeAll({ merges }, s3Service) {
    const outputs = [];
    // Sequential: keeps Lambda memory bounded when several large PDFs are merged.
    for (const merge of merges) {
      outputs.push(await this.mergeOne(merge, s3Service));
    }
    return { outputs };
  }

  async mergeOne({ output, documents }, s3Service) {
    const merged = await PDFDocument.create();

    for (const { reportLocation, montageLocation } of documents) {
      await this.appendPdf(merged, reportLocation, s3Service);
      if (montageLocation) await this.appendPdf(merged, montageLocation, s3Service);
    }

    const bytes = await merged.save();
    await s3Service.putObject(output.location, Buffer.from(bytes), "application/pdf", output.tags);
    console.log(`Merged ${documents.length} document(s) into ${output.location} (${merged.getPageCount()} pages)`);
    return { location: output.location, pageCount: merged.getPageCount(), documents: documents.length };
  }

  async appendPdf(target, location, s3Service) {
    let source;
    try {
      const bytes = await s3Service.downloadS3File(location);
      source = await PDFDocument.load(bytes);
    } catch (error) {
      throw new Error(`Cannot read PDF ${location}: ${error.message}`);
    }
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
}

module.exports = PdfMergeService;
