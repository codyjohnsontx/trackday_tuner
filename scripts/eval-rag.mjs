const baseUrl = process.env.RAG_EVAL_BASE_URL ?? 'http://127.0.0.1:3000';
const authCookie = process.env.RAG_EVAL_AUTH_COOKIE;

const queries = [
  { question: 'What does rider sag mean?', expectCitations: true, expectRefusal: false },
  { question: 'What\'s the difference between preload and rebound?', expectCitations: true, expectRefusal: false },
  { question: 'What should I check first if the bike is pushing mid-corner?', expectCitations: true, expectRefusal: false },
  { question: 'What causes tire tearing?', expectCitations: true, expectRefusal: false },
  { question: 'At Road America on the R6, what changed between the earlier and later sessions?', expectCitations: true, expectRefusal: false },
  { question: 'When the rear spun on corner exit, what setup changes were logged afterward?', expectCitations: true, expectRefusal: false },
  { question: 'What conditions were present in the Mid-Ohio BRZ session?', expectCitations: true, expectRefusal: false },
  { question: 'What does the knowledge base say about making multiple setup changes at once?', expectCitations: true, expectRefusal: false },
  { question: 'What lap-time trend showed up after the rear ride height change?', expectCitations: true, expectRefusal: false },
  { question: 'What gearing should I use at Daytona?', expectCitations: false, expectRefusal: true },
];

let hasFailure = false;

for (const entry of queries) {
  const response = await fetch(`${baseUrl}/api/rag/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authCookie ? { cookie: authCookie } : {}),
    },
    body: JSON.stringify({ question: entry.question }),
  });

  const payload = await response.json();
  const citationsCount = Array.isArray(payload.citations) ? payload.citations.length : 0;
  const missingInfo = Array.isArray(payload.missing_info) ? payload.missing_info : [];
  const refused = typeof payload.answer === 'string' && payload.answer.includes("don't have enough grounded Track Tuner context");

  const failed =
    !response.ok ||
    (entry.expectCitations && citationsCount === 0) ||
    (entry.expectRefusal && !refused) ||
    (!entry.expectRefusal && refused);

  if (failed) {
    hasFailure = true;
  }

  console.log([
    failed ? 'FAIL' : 'PASS',
    `q="${entry.question}"`,
    `status=${response.status}`,
    `citations=${citationsCount}`,
    `refused=${refused}`,
    `missing=${missingInfo.length}`,
  ].join(' | '));
}

process.exit(hasFailure ? 1 : 0);
