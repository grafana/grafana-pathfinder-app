import { safeParseKioskCatalog } from '../../types/kiosk-page.schema';
import { fetchSnapshotJson } from '../../lib/pr-preview-fetch';
import { parseSnapshotUrl, mapPreviewContentUrl } from '../../lib/pr-preview-core';
import { parseKioskData, type PreparedKioskData } from '../kiosk/kiosk-rules';

export async function preparePrKiosk(rawUrl: string, fetchId: string, signal: AbortSignal): Promise<PreparedKioskData> {
  const snapshot = parseSnapshotUrl(rawUrl);
  if (!snapshot) {
    throw new Error('Select a kiosk from a valid PR snapshot.');
  }
  const raw = await fetchSnapshotJson(snapshot, snapshot.path, signal);
  const parsed = safeParseKioskCatalog(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'catalog'}: ${issue.message}`).join('\n')
    );
  }
  const { data, rejectedRules } = parseKioskData(parsed.data);
  if (rejectedRules) {
    throw new Error('The kiosk contains invalid guide or product destinations.');
  }
  const rules = data.rules.map((rule) => ({
    ...rule,
    preview: true,
    url: rule.interactiveLearning === false ? rule.url : mapPreviewContentUrl(rule.url, snapshot, `kiosk${fetchId}`),
  }));
  signal.throwIfAborted();
  return {
    data: { ...data, rules, catalogUrl: rawUrl },
    tier: 'override',
    kioskName: 'pr-preview',
    degraded: false,
    rejectedRules: 0,
  };
}
