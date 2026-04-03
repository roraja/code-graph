import { FileData, IFileProcessor, ProcessResult } from './types.js';

export class ImageProcessor implements IFileProcessor {
  private supportedTypes = ['image/png', 'image/jpeg', 'image/gif'];

  async process(file: FileData): Promise<ProcessResult> {
    if (!this.supports(file.mimeType)) {
      return {
        success: false,
        message: `Unsupported image type: ${file.mimeType}`,
        processedBytes: 0,
      };
    }

    const processedBytes = this.resizeImage(file);
    return {
      success: true,
      message: `Processed image ${file.fileName}`,
      processedBytes,
    };
  }

  supports(mimeType: string): boolean {
    return this.supportedTypes.includes(mimeType);
  }

  private resizeImage(file: FileData): number {
    // Simulated image resize logic
    const targetSize = Math.min(file.fileSize, 1024 * 1024);
    return targetSize;
  }
}

export class DocumentProcessor implements IFileProcessor {
  private supportedTypes = ['application/pdf', 'text/plain', 'application/json'];

  async process(file: FileData): Promise<ProcessResult> {
    if (!this.supports(file.mimeType)) {
      return {
        success: false,
        message: `Unsupported document type: ${file.mimeType}`,
        processedBytes: 0,
      };
    }

    const extracted = await this.extractText(file);
    return {
      success: true,
      message: `Extracted ${extracted} chars from ${file.fileName}`,
      processedBytes: file.fileSize,
    };
  }

  supports(mimeType: string): boolean {
    return this.supportedTypes.includes(mimeType);
  }

  private async extractText(file: FileData): Promise<number> {
    if (file.content === null) {
      return 0;
    }
    return file.content.length;
  }
}

export class DefaultProcessor implements IFileProcessor {
  async process(file: FileData): Promise<ProcessResult> {
    return {
      success: true,
      message: `Default processing for ${file.fileName}`,
      processedBytes: file.fileSize,
    };
  }

  supports(_mimeType: string): boolean {
    return true;
  }
}
