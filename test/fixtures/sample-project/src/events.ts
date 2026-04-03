import { FileData, IEventHandler } from './types.js';
import { FileProcessingPipeline } from './pipeline.js';

export class FileDropEventHandler implements IEventHandler {
  private pipeline: FileProcessingPipeline;

  constructor(pipeline: FileProcessingPipeline) {
    this.pipeline = pipeline;
  }

  handle(event: string, data: unknown): void {
    if (event !== 'file-drop') {
      return;
    }

    const files = data as FileData[];
    this.pipeline.handleFileDrop(files).then((results) => {
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      console.log(
        `File drop complete: ${succeeded} succeeded, ${failed} failed`
      );
    });
  }
}

export class LoggingEventHandler implements IEventHandler {
  private logs: string[] = [];
  private inner: IEventHandler | null;

  constructor(inner: IEventHandler | null = null) {
    this.inner = inner;
  }

  handle(event: string, data: unknown): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] Event: ${event}`;
    this.logs.push(logEntry);

    if (this.inner !== null) {
      this.inner.handle(event, data);
    }
  }

  getLogs(): string[] {
    return [...this.logs];
  }
}
