// Interfaces and types for the file processor
export interface FileData {
  fileName: string;
  fileSize: number;
  mimeType: string;
  content: Buffer | null;
}

export interface ProcessResult {
  success: boolean;
  message: string;
  processedBytes: number;
}

export interface IFileValidator {
  validate(file: FileData): boolean;
  getMaxSize(): number;
}

export interface IFileProcessor {
  process(file: FileData): Promise<ProcessResult>;
  supports(mimeType: string): boolean;
}

export interface IEventHandler {
  handle(event: string, data: unknown): void;
}
