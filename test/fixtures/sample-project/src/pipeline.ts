import { FileData, IFileProcessor, IFileValidator, ProcessResult } from './types.js';

export class FileProcessingPipeline {
  private validators: IFileValidator[];
  private processors: IFileProcessor[];

  constructor(validators: IFileValidator[], processors: IFileProcessor[]) {
    this.validators = validators;
    this.processors = processors;
  }

  async handleFileDrop(files: FileData[]): Promise<ProcessResult[]> {
    if (files.length === 0) {
      return [];
    }

    const results: ProcessResult[] = [];

    for (const file of files) {
      try {
        const isValid = this.validateFile(file);
        if (!isValid) {
          results.push({
            success: false,
            message: `Validation failed for ${file.fileName}`,
            processedBytes: 0,
          });
          continue;
        }

        const processor = this.findProcessor(file.mimeType);
        const result = await processor.process(file);
        results.push(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        results.push({
          success: false,
          message: `Error processing ${file.fileName}: ${message}`,
          processedBytes: 0,
        });
      }
    }

    return results;
  }

  private validateFile(file: FileData): boolean {
    for (const validator of this.validators) {
      if (!validator.validate(file)) {
        return false;
      }
    }
    return true;
  }

  private findProcessor(mimeType: string): IFileProcessor {
    for (const processor of this.processors) {
      if (processor.supports(mimeType)) {
        return processor;
      }
    }
    // Fallback: return the last processor (should be DefaultProcessor)
    return this.processors[this.processors.length - 1];
  }

  getProcessorCount(): number {
    return this.processors.length;
  }

  getValidatorCount(): number {
    return this.validators.length;
  }
}
