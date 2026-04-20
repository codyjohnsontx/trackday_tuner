export type KnowledgeVehicleType = 'motorcycle' | 'car' | 'both';

export interface KnowledgeChunk {
  id: string;
  source: string;
  heading: string;
  vehicle_type: KnowledgeVehicleType;
  topic: string | null;
  summary: string | null;
  text: string;
  embedding: number[];
}

export interface KnowledgeIndex {
  version: number;
  model: string;
  dimension: number;
  generated_at: string;
  chunks: KnowledgeChunk[];
}

export interface RetrievedChunk {
  chunk: KnowledgeChunk;
  score: number;
}
