# RAG Spike

## Overview
This spike explores a minimal but real Retrieval Augmented Generation workflow for Track Tuner. The goal is to answer practical tuning questions using only seeded Track Tuner knowledge-base articles and seeded prior session logs, with citations for every grounded answer.

This is intentionally a narrow vertical slice. It is not the final AI assistant architecture, and it does not read live Supabase user data yet.

## User Flows
- Ask a concept question from the knowledge base, such as the meaning of rider sag or the difference between preload and rebound.
- Ask a historical setup question from seeded session logs, such as what changed between earlier and later Road America R6 sessions.
- Ask a question with insufficient context and receive a grounded refusal plus missing-info hints.

## Data Model
- Knowledge-base docs live in `docs/knowledge-base/*.md` with lightweight frontmatter.
- Session fixtures live in `data/session-logs/*.json` using a stable session shape.
- A generated vector index lives in `data/rag/index.json` and stores chunk text, metadata, snippets, and embeddings.

## Retrieval Approach
- Load and parse both corpora from disk.
- Chunk markdown by headings and paragraphs with overlap.
- Convert session JSON into labeled text summaries and chunk when needed.
- Embed chunks with `text-embedding-3-small`.
- Persist the index to a JSON file for local and CI-friendly development.
- For a query, embed the question, apply optional filters to session chunks, rank by cosine similarity, and keep a balanced mix of knowledge-base and session evidence.
- Refuse cleanly when no chunk clears the minimum similarity threshold.

## Citation Production
- Every chunk has a stable `chunkId`.
- The model receives retrieved chunks and returns structured JSON including `used_chunk_ids`.
- The server maps those IDs back to citations with source type, source id, title, snippet, and score.
- Invalid or missing chunk IDs fall back to a safe grounded response.

## Risks
- Small corpus means weak recall for edge-case questions.
- Session fixtures are not user-specific and do not reflect live Supabase data yet.
- The query route is unauthenticated for the spike because the corpus is seeded only.
- No reranking layer is included.
- The generated index must exist or the route returns a 503.

## Next Steps
- Replace seeded session fixtures with live Supabase user sessions.
- Add auth and user scoping to retrieval.
- Add reranking if retrieval quality is weak.
- Add a simple quality evaluation rubric beyond citation presence.
- Extend the corpus with more track, vehicle, and symptom documents.

## Task Checklist
- [x] Add seeded knowledge-base markdown docs.
- [x] Add seeded session log fixtures.
- [x] Build chunking, source loading, provider, index builder, retrieval, and citation modules.
- [x] Add `npm run rag:index` to build the local JSON index.
- [x] Add `POST /api/rag/query` with validation and grounded refusal behavior.
- [x] Add `/tools/rag` UI and Tools entry card.
- [x] Add unit tests and route tests.
- [x] Add `npm run rag:eval` for local API evaluation.
- [x] Update `.env.example` and `TESTING.md`.
- [ ] Run lint, unit tests, and production build.
