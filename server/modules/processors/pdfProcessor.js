const fs = require("fs");
const pdflib = require("pdf-lib");

class PdfProcessor {
  // function to add background image to PDF from S3

  async addBackgroundImageFromS3(backgroundImageUrl, pdfPath, s3Service) {
    if (!backgroundImageUrl || !s3Service) return;

    try {
      console.log(`Adding background image from S3: ${backgroundImageUrl}`);

      // Downloading background image
      const tempBgFile = `/tmp/bg_${Date.now()}.jpg`;
      await s3Service.downloadS3File(backgroundImageUrl, tempBgFile);
      const bgBytes = fs.readFileSync(tempBgFile);
      fs.unlinkSync(tempBgFile); // Clean up immediately

      // Embed into PDF
      await this.embedBackgroundImage(bgBytes, pdfPath);
    } catch (error) {
      console.error("Error adding background image:", error);
      throw error;
    }
  }

  // function to embed background image bytes into PDF

  async embedBackgroundImage(backgroundImageBytes, pdfPath) {
    if (!backgroundImageBytes) return;

    try {
      const fileBuffer = fs.readFileSync(pdfPath);
      const { PDFDocument, BlendMode } = pdflib;
      const pdfDoc = await PDFDocument.load(fileBuffer);

      // Detecting image type and embed
      const isPNG = this.isPngImage(backgroundImageBytes);
      const bgImage = isPNG
        ? await pdfDoc.embedPng(backgroundImageBytes)
        : await pdfDoc.embedJpg(backgroundImageBytes);

      // Adding to all pages
      const pages = pdfDoc.getPages();
      pages.forEach((page) => {
        const { width, height } = page.getSize();
        page.drawImage(bgImage, {
          x: 0,
          y: 0,
          width,
          height,
          blendMode: BlendMode.Multiply,
          interpolation: "cubic",
        });
      });

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(pdfPath, pdfBytes);
      console.log("Background image embedded successfully");
    } catch (error) {
      console.error("Error embedding background image:", error);
      throw error;
    }
  }

  // function to check if image bytes represent a PNG

  isPngImage(bytes) {
    const pngSignature = [0x89, 0x50, 0x4e, 0x47];
    return pngSignature.every((byte, index) => bytes[index] === byte);
  }
}

module.exports = PdfProcessor;
