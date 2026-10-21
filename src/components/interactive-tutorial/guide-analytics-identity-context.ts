import { createContext } from 'react';
import type { AnalyticsCompletionIdentity } from '../../docs-retrieval';

export const GuideAnalyticsIdentityContext = createContext<AnalyticsCompletionIdentity | undefined>(undefined);
