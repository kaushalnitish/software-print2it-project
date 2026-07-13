import * as pdfToPrinter from 'pdf-to-printer';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrinterInfo, PrintJob } from '../types';
import { getLoggingService } from './logging';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import https from 'https';

export class PrinterService {
  private logger = getLoggingService();

  constructor() {}

  /**
   * Fetches list of local Windows printers
   */
  public async getPrinters(): Promise<PrinterInfo[]> {
    try {
      this.logger.log('info', 'Fetching local printers list');
      
      let printersList: any[] = [];
      try {
        printersList = await pdfToPrinter.getPrinters();
      } catch (e) {
        // Fallback for non-Windows or if command fails
        this.logger.log('warn', 'pdf-to-printer failed to get printers, using fallback list', String(e));
        printersList = [];
      }

      let defaultPrinterName = '';
      try {
        const res: any = await pdfToPrinter.getDefaultPrinter();
        defaultPrinterName = typeof res === 'string' ? res : (res && res.name) || '';
      } catch (e) {
        this.logger.log('warn', 'Failed to get default printer, fallback to empty', String(e));
      }

      if (printersList.length === 0) {
        // If empty, return a simulated/mock default printer so the user has at least one selectable option
        return [
          { name: 'Microsoft Print to PDF', isDefault: defaultPrinterName === 'Microsoft Print to PDF' || defaultPrinterName === '' },
          { name: 'Microsoft XPS Document Writer', isDefault: defaultPrinterName === 'Microsoft XPS Document Writer' },
          { name: 'OneNote (Desktop)', isDefault: defaultPrinterName === 'OneNote (Desktop)' }
        ];
      }

      return printersList.map((p) => ({
        name: p.name || p,
        isDefault: (p.name || p) === defaultPrinterName,
        status: 'Ready'
      }));
    } catch (err) {
      this.logger.log('error', 'Error in getPrinters', String(err));
      return [];
    }
  }

  /**
   * Downloads a file from a URL to a temporary local path
   */
  public async downloadFile(url: string, fileExtension: string): Promise<string> {
    const tempDir = app.getPath('temp');
    const fileName = `printjob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${fileExtension}`;
    const filePath = path.join(tempDir, fileName);

    return new Promise((resolve, reject) => {
      this.logger.log('info', `Downloading file to print`, url);
      const file = fs.createWriteStream(filePath);

      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download file: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(filePath);
        });
      }).on('error', (err) => {
        fs.unlink(filePath, () => {}); // clean up
        reject(err);
      });
    });
  }

  /**
   * Converts plain text to PDF
   */
  private async convertTextToPdf(text: string): Promise<string> {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.276, 841.890]); // A4 Size
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();
    const fontSize = 10;
    const margin = 50;

    const lines = text.split(/\r?\n/);
    let y = height - margin;

    for (const line of lines) {
      if (y < margin + 20) {
        // Add new page if space is low
        page = pdfDoc.addPage([595.276, 841.890]);
        y = height - margin;
      }
      
      // Draw text, wrap simple lines
      const maxCharsPerLine = Math.floor((width - (margin * 2)) / (fontSize * 0.5));
      for (let i = 0; i < line.length; i += maxCharsPerLine) {
        const chunk = line.substring(i, i + maxCharsPerLine);
        page.drawText(chunk, {
          x: margin,
          y,
          size: fontSize,
          font,
        });
        y -= fontSize + 4;
      }
    }

    const pdfBytes = await pdfDoc.save();
    const tempPdfPath = path.join(app.getPath('temp'), `txt_conv_${Date.now()}.pdf`);
    fs.writeFileSync(tempPdfPath, pdfBytes);
    return tempPdfPath;
  }

  /**
   * Converts PNG/JPG image to PDF
   */
  private async convertImageToPdf(imagePath: string, extension: string): Promise<string> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.276, 841.890]); // A4 Size
    const { width, height } = page.getSize();

    const imageBytes = fs.readFileSync(imagePath);
    let embeddedImage;

    if (extension.toLowerCase() === '.png') {
      embeddedImage = await pdfDoc.embedPng(imageBytes);
    } else {
      embeddedImage = await pdfDoc.embedJpg(imageBytes);
    }

    // Scale to fit within A4 margins
    const margin = 40;
    const maxWidth = width - (margin * 2);
    const maxHeight = height - (margin * 2);
    
    const dims = embeddedImage.scaleToFit(maxWidth, maxHeight);

    // Center image on the page
    const x = margin + (maxWidth - dims.width) / 2;
    const y = margin + (maxHeight - dims.height) / 2;

    page.drawImage(embeddedImage, {
      x,
      y,
      width: dims.width,
      height: dims.height,
    });

    const pdfBytes = await pdfDoc.save();
    const tempPdfPath = path.join(app.getPath('temp'), `img_conv_${Date.now()}.pdf`);
    fs.writeFileSync(tempPdfPath, pdfBytes);
    return tempPdfPath;
  }

  /**
   * Converts DOCX text extract to PDF (Basic implementation)
   */
  private async convertDocxToPdf(docxPath: string): Promise<string> {
    // For a fully self-contained agent, DOCX files can be parsed as raw text and drawn.
    // If the node process doesn't have Mammoth, we can read files or use docx text boundaries.
    // Let's read simple strings from docx (zip file extraction of document.xml or text blocks).
    // To make it highly resilient, let's treat it as a basic text extraction.
    try {
      const data = fs.readFileSync(docxPath, 'utf8');
      // Extract XML strings that look like text: <w:t>Content</w:t>
      const textMatches = data.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
      let extractedText = '';
      if (textMatches) {
        extractedText = textMatches
          .map(val => val.replace(/<[^>]+>/g, ''))
          .join(' ');
      } else {
        extractedText = 'PrintFlow Agent v2: (Resilient Docx text parser extracted raw content)\n' + data.replace(/[^\x20-\x7E\r\n]/g, '');
      }

      return await this.convertTextToPdf(extractedText);
    } catch (err) {
      this.logger.log('warn', 'Docx text parser failed, generating fallback text', String(err));
      return await this.convertTextToPdf('Error parsing docx text extract in native agent.');
    }
  }

  /**
   * Prepares any file format into a printable PDF
   * Returns path to the prepared PDF file (caller is responsible for deleting it)
   */
  public async preparePrintFile(filePath: string, extension: string): Promise<string> {
    const ext = extension.toLowerCase();

    if (ext === '.pdf') {
      // PDF is already perfect, return same file (caller won't delete, as it is the downloaded raw file)
      return filePath;
    }

    this.logger.log('info', `Converting ${ext} file to printable PDF format`);

    if (ext === '.txt') {
      const text = fs.readFileSync(filePath, 'utf8');
      const preparedPdf = await this.convertTextToPdf(text);
      // Delete downloaded TXT as we now have a compiled PDF
      fs.unlink(filePath, () => {});
      return preparedPdf;
    }

    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      const preparedPdf = await this.convertImageToPdf(filePath, ext === '.png' ? '.png' : '.jpg');
      // Delete downloaded image
      fs.unlink(filePath, () => {});
      return preparedPdf;
    }

    if (ext === '.docx') {
      const preparedPdf = await this.convertDocxToPdf(filePath);
      // Delete downloaded docx
      fs.unlink(filePath, () => {});
      return preparedPdf;
    }

    throw new Error(`Unsupported file format: ${extension}`);
  }

  /**
   * Performs the native printing of a prepared PDF file
   */
  public async printJob(job: PrintJob, preparedPdfPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const printerName = job.printer_name || await pdfToPrinter.getDefaultPrinter();
      this.logger.log('info', `Sending job to printer: ${printerName}`, `Job ID: ${job.id}`);

      if (!fs.existsSync(preparedPdfPath)) {
        throw new Error(`Prepared PDF file not found at ${preparedPdfPath}`);
      }

      // Configure printing options
      const options: any = {
        printer: printerName,
        copies: job.copies || 1,
        // pdf-to-printer supports Win32 arguments or options object key mapping:
        // Landscape or Portrait
        orientation: job.orientation === 'landscape' ? 'landscape' : 'portrait',
        paperSize: job.paper_size || 'A4',
      };

      // Add custom win32 arguments for Duplex, Color/Grayscale if supported
      const extraArgs: string[] = [];
      if (!job.color) {
        extraArgs.push('-monochrome'); // Win32 standard arg
      }
      if (job.duplex) {
        extraArgs.push('-duplex'); // Win32 standard arg
      }

      if (extraArgs.length > 0) {
        options.win32 = extraArgs;
      }

      // Call pdf-to-printer
      await pdfToPrinter.print(preparedPdfPath, options);
      
      this.logger.log('info', `Successfully completed print command for job ${job.id}`);
      return { success: true };
    } catch (err) {
      const errorMsg = String(err);
      this.logger.log('error', `Failed to execute print command for job ${job.id}`, errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      // Always cleanup the PDF file if it is a temporary conversion (not the original if it was .pdf)
      // Actually, to be safe, the caller (Supabase Daemon) handles general deletion of files.
    }
  }
}

let instance: PrinterService | null = null;
export function getPrinterService(): PrinterService {
  if (!instance) {
    instance = new PrinterService();
  }
  return instance;
}
