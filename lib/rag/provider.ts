export interface RagProvider {
  embedTexts(input: string[]): Promise<number[][]>;
  generateAnswer(input: {
    question: string;
    retrievedChunks: Array<{
      chunkId: string;
      title: string;
      text: string;
      sourceType: 'knowledge_base' | 'session_log';
    }>;
  }): Promise<{
    answer: string;
    usedChunkIds: string[];
    missingInfo: string[];
  }>;
}
