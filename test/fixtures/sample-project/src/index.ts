import { FileData } from './types.js';
import { SizeValidator, TypeValidator } from './validators.js';
import { ImageProcessor, DocumentProcessor, DefaultProcessor } from './processors.js';
import { FileProcessingPipeline } from './pipeline.js';
import { FileDropEventHandler, LoggingEventHandler } from './events.js';

function inferMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function createFileData(fileName: string): FileData {
  return {
    fileName,
    fileSize: 1024,
    mimeType: inferMimeType(fileName),
    content: null,
  };
}

export async function handleUserFileDrop(
  fileNames: string[]
): Promise<void> {
  const validators = [new SizeValidator(), new TypeValidator()];
  const processors = [
    new ImageProcessor(),
    new DocumentProcessor(),
    new DefaultProcessor(),
  ];

  const pipeline = new FileProcessingPipeline(validators, processors);
  const dropHandler = new FileDropEventHandler(pipeline);
  const loggingHandler = new LoggingEventHandler(dropHandler);

  const files = fileNames.map(createFileData);

  loggingHandler.handle('file-drop', files);

  const results = await pipeline.handleFileDrop(files);
  for (const result of results) {
    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
    }
  }
}

// Main entry point
if (typeof require !== 'undefined' && require.main === module) {
  const sampleFiles = ['photo.png', 'document.pdf', 'notes.txt', 'data.json'];
  handleUserFileDrop(sampleFiles).catch(console.error);
}
