import { getMonitoringAlertWebhookUrl } from '@/lib/env.server';

/**
 * Where an alert goes.
 *
 * `none` is not a failure. The scheduled probe in
 * `.github/workflows/monitoring.yml` answers a firing alert with a non-2xx and
 * fails the workflow run, and GitHub notifies the repository owner on a failed
 * scheduled run - so the alert reaches somebody with no external account at
 * all. A webhook is the upgrade, not the mechanism.
 */
export type AlertDelivery = 'webhook' | 'none' | 'failed';

const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Posts one alert to `MONITORING_ALERT_WEBHOOK_URL`, if it is set.
 *
 * The body carries `text` and `content` with the same string because Slack
 * reads the first and Discord the second, so one generic payload renders in
 * either without this module knowing which is on the other end. `report` is the
 * full structured summary for anything that wants to parse it.
 *
 * Never throws: a monitoring channel that can take the monitored request down
 * with it is worse than no channel.
 */
export async function deliverAlert(text: string, report: unknown): Promise<AlertDelivery> {
  const url = getMonitoringAlertWebhookUrl();
  if (!url) return 'none';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text, report }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[monitoring] alert webhook rejected the post', {
        status: response.status,
      });
      return 'failed';
    }
    return 'webhook';
  } catch (err) {
    console.error('[monitoring] alert webhook threw', err);
    return 'failed';
  }
}
