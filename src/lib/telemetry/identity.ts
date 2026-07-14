import { config } from '@grafana/runtime';
import { hashUserData } from '../hash.util';
import { isGrafanaCloud } from './filtering';

// The one place the Cloud/OSS identity policy lives — Faro setUser and the
// recommender payload both build from it so their hashes stay joinable.
export interface TelemetryIdentity {
  isCloud: boolean;
  hasEmail: boolean;
  userIdHash: string;
  emailHash: string;
  faroUserId: string;
  orgRole: string;
}

export async function buildTelemetryIdentity(): Promise<TelemetryIdentity> {
  const isCloud = isGrafanaCloud();
  const email = isCloud ? config.bootData.user.email || '' : '';
  const hasEmail = email !== '';
  const userId = isCloud ? config.bootData.user.analytics.identifier || 'unknown' : 'oss-user';
  const userEmail = isCloud ? email || 'unknown@example.com' : 'oss-user@example.com';
  const { hashedUserId, hashedEmail } = await hashUserData(userId, userEmail);
  return {
    isCloud,
    hasEmail,
    userIdHash: hashedUserId,
    emailHash: hashedEmail,
    // Email-less Cloud users fall back to their analytics-id hash — the
    // shared unknown@example.com hash would merge them into one identity.
    faroUserId: isCloud && !hasEmail ? hashedUserId : hashedEmail,
    orgRole: config.bootData.user.orgRole || 'Viewer',
  };
}
