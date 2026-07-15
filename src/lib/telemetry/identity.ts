import { config } from '@grafana/runtime';
import { hashUserData } from '../hash.util';
import { isGrafanaCloud } from './filtering';

// The one place the Cloud/OSS identity policy lives. Faro is first-party
// (Grafana Labs) and takes the raw id/email directly; the recommender is a
// separate service and keeps the hashed pair.
export interface TelemetryIdentity {
  isCloud: boolean;
  hasEmail: boolean;
  userId: string;
  email: string;
  userIdHash: string;
  emailHash: string;
  orgRole: string;
  orgName: string;
}

export async function buildTelemetryIdentity(): Promise<TelemetryIdentity> {
  const isCloud = isGrafanaCloud();
  const email = isCloud ? config.bootData.user.email || '' : '';
  const hasEmail = email !== '';
  const userId = isCloud ? config.bootData.user.analytics.identifier || 'unknown' : 'oss-user';
  // Email-less Cloud users must still hash to a value unique to them, not a
  // shared placeholder literal — derive one from the analytics identifier so
  // emailHash stays distinct per user, but suffixed so it doesn't collapse
  // to the same hash as userIdHash.
  const userEmailForHash = isCloud ? email || `${userId}@no-email.pathfinder` : 'oss-user@example.com';
  const { hashedUserId, hashedEmail } = await hashUserData(userId, userEmailForHash);
  return {
    isCloud,
    hasEmail,
    userId,
    email,
    userIdHash: hashedUserId,
    emailHash: hashedEmail,
    orgRole: config.bootData.user.orgRole || 'Viewer',
    orgName: config.bootData.user.orgName || '',
  };
}
