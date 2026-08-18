/**
 * A per-run identifier for anything this spec writes to the shared E2E account.
 *
 * All six device projects sign in as one account, and the worker index repeats
 * across them, so the project name has to be in here too: without it one
 * project's cleanup can delete a row another is still using, and
 * `sessions.track_id` being ON DELETE SET NULL makes that a silent rewrite of
 * the other run's data rather than an error anyone sees.
 */
export function runResourceId(testInfo: { project: { name: string }; workerIndex: number }): string {
  return `${testInfo.project.name}-w${testInfo.workerIndex}-${Date.now()}`;
}
