# AI MVP Spec

## Goal

Ship a post-session AI copilot that gives conservative, explainable setup suggestions based on user session history and curated knowledge docs.

## Scope

- In scope:
  - Authenticated `POST` API for setup advice.
  - Retrieval over approved knowledge documents.
  - Session-aware prompt composition using current + previous session context.
  - Structured response contract with safety and confidence metadata.
- Out of scope:
  - Real-time telemetry analysis.
  - Autonomous setup changes.
  - Public unauthenticated usage.

## Input Schema

`POST /api/ai/tuning-advice` request body:

```json
{
  "vehicle_id": "uuid",
  "session_id": "uuid",
  "question": "Front pushes mid-corner after raising pressure 1 psi.",
  "symptoms": ["understeer_mid_corner"],
  "change_intent": "stability_over_entry",
  "temperature_c": 24
}
```

Validation rules:

- `vehicle_id`, `session_id`, and `question` are required.
- `question` min 10 chars, max 1000 chars.
- `symptoms` optional; max 8 tags.
- Reject unknown keys.

## Retrieval Sources

- Primary user context (database):
  - Current session from `sessions` table.
  - Previous relevant session for same vehicle.
  - Vehicle metadata from `vehicles`.
- Knowledge context (docs):
  - Curated markdown corpus under `docs/knowledge-base/` (planned source of truth).
  - Each chunk stores source path, heading, and excerpt.

Retrieval strategy:

- Top-k semantic retrieval (k=4 default, max 8).
- Prefer docs with vehicle-type relevance.
- Deduplicate near-identical chunks before prompt assembly.

## Output Contract

Response shape:

```json
{
  "summary": "Likely front-end overload from pressure increase and rebound balance.",
  "recommended_changes": [
    {
      "component": "front_tire_pressure",
      "direction": "decrease",
      "magnitude": "0.5 psi",
      "reason": "reduce mid-corner push while preserving entry support"
    }
  ],
  "tradeoffs": [
    "Too large a pressure drop can reduce steering precision."
  ],
  "confidence": "medium",
  "safety_notes": [
    "Make one change at a time.",
    "Verify tire temperatures and pressure hot-off-track."
  ],
  "citations": [
    {
      "source": "docs/knowledge-base/tires/pressure-basics.md",
      "snippet": "..."
    }
  ]
}
```

## Safety + Policy Requirements

- Always include informational-use disclaimer.
- No advice that implies unsafe operation or rule violations.
- Keep adjustments small and incremental.
- Suggest one primary change first, then optional secondary checks.
- Refuse when context is insufficient or question is out-of-domain.

## Rate Limiting + Abuse Controls

- Per-user limit: 20 requests/hour (initial).
- Burst limit: 3 requests/minute.
- Reject oversized payloads (>20 KB).
- Add request tracing id for observability and abuse investigation.

## MVP Quality Rubric

Each response should be scored on:

- Actionability (clear next step).
- Safety tone (incremental and responsible).
- Grounding (uses session and retrieved context).
- Transparency (shows uncertainty and rationale).

Exit criteria:

- >=85% of sampled outputs pass all rubric categories.
- 0 high-severity safety policy violations in evaluation set.
