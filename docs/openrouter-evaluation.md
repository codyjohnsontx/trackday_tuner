# OpenRouter Evaluation Matrix

## Decision Goal

Decide whether OpenRouter should be adopted after AI MVP quality is proven with a single provider path.

## Candidate Paths

- Path A: Direct provider integration (single model/provider).
- Path B: OpenRouter as routing layer for multi-model access.

## Evaluation Criteria

| Criterion | Weight | Direct Provider | OpenRouter | Notes |
| --- | --- | --- | --- | --- |
| Advice quality consistency | 30% | TBD | TBD | Score against AI MVP rubric. |
| P95 latency | 20% | TBD | TBD | Measure by region and payload size. |
| Cost per 1k requests | 20% | TBD | TBD | Include prompt+completion tokens. |
| Operational resilience | 15% | TBD | TBD | Fallback behavior during outages. |
| Observability/debuggability | 10% | TBD | TBD | Traceability, request logs, error clarity. |
| Implementation complexity | 5% | TBD | TBD | Adapter and maintenance overhead. |

## Required Benchmarks

- Prompt set:
  - 50 real anonymized session-question samples.
  - Mix of motorcycle and car scenarios.
  - At least 10 edge cases (sparse data, conflicting signals).
- Measure:
  - rubric pass rate,
  - token usage,
  - latency,
  - refusal quality,
  - error rates.

## OpenRouter-Specific Use Cases (Future)

- Model A/B testing without app-level refactors.
- Cost-aware model selection by request type.
- Backup/failover routing during provider incidents.
- Task-specific model routing (retrieval summarization vs coaching response).

## Go/No-Go Gate

Adopt OpenRouter only if all conditions are met:

1. Quality: no regression >2% on rubric pass rate vs direct path.
2. Latency: P95 increase <=15%.
3. Cost: net cost neutral or improved for target traffic.
4. Reliability: documented fallback behavior validated in failure drills.
5. Ops: debugging visibility remains sufficient for support workflows.

If any gate fails, keep direct provider path and re-evaluate later.
