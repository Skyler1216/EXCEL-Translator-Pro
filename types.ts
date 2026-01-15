export interface TranslationProgress {
  status: 'idle' | 'parsing' | 'translating' | 'rebuilding' | 'complete' | 'error';
  currentChunk: number;
  totalChunks: number;
  message?: string;
  error?: string;
}

export interface TranslationResult {
  fileName: string;
  data: ArrayBuffer;
}

export interface ChunkData {
  original: string[];
  translated?: string[];
}