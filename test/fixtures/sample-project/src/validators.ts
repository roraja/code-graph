import { FileData, IFileValidator } from './types.js';

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

export class SizeValidator implements IFileValidator {
  private maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  validate(file: FileData): boolean {
    if (file.fileSize <= 0) {
      return false;
    }
    return file.fileSize <= this.maxSize;
  }

  getMaxSize(): number {
    return this.maxSize;
  }
}

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/json',
];

export class TypeValidator implements IFileValidator {
  private allowedTypes: string[];
  private maxSize: number;

  constructor(
    allowedTypes: string[] = ALLOWED_MIME_TYPES,
    maxSize: number = DEFAULT_MAX_SIZE
  ) {
    this.allowedTypes = allowedTypes;
    this.maxSize = maxSize;
  }

  validate(file: FileData): boolean {
    if (!file.mimeType) {
      return false;
    }
    return this.allowedTypes.includes(file.mimeType);
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  addAllowedType(mimeType: string): void {
    if (!this.allowedTypes.includes(mimeType)) {
      this.allowedTypes.push(mimeType);
    }
  }
}
