export interface RagQueryFilters {
  track?: string;
  bike?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface RagQueryRequest {
  question: string;
  filters?: RagQueryFilters;
}

export interface RagCitation {
  source_type: 'knowledge_base' | 'session_log';
  source_id: string;
  title: string;
  snippet: string;
  score: number;
}

export interface RagQueryResponse {
  answer: string;
  citations: RagCitation[];
  missing_info: string[];
}

export interface RagChunk {
  chunkId: string;
  sourceType: 'knowledge_base' | 'session_log';
  sourceId: string;
  title: string;
  path: string;
  text: string;
  snippet: string;
  embedding: number[];
  metadata: {
    tags?: string[];
    track?: string;
    bike?: string;
    date?: string;
  };
}

export interface RagIndex {
  version: 1;
  createdAt: string;
  embeddingModel: string;
  dimensions: number;
  chunks: RagChunk[];
}

export interface LoadedKnowledgeBaseDoc {
  sourceType: 'knowledge_base';
  id: string;
  title: string;
  path: string;
  tags: string[];
  body: string;
}

export interface SessionLogFixture {
  id: string;
  date: string;
  track: string;
  bike: string;
  setup: Record<string, unknown>;
  conditions: Record<string, unknown>;
  rider_feedback: string[];
  lap_times: string[];
}

export interface LoadedSessionLogDoc {
  sourceType: 'session_log';
  id: string;
  title: string;
  path: string;
  text: string;
  session: SessionLogFixture;
}

export interface RagRetrievedChunk {
  chunkId: string;
  sourceType: 'knowledge_base' | 'session_log';
  sourceId: string;
  title: string;
  path: string;
  text: string;
  snippet: string;
  score: number;
  metadata: RagChunk['metadata'];
}
