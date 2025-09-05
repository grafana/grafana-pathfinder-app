/**
 * Custom Documentation Fetcher
 * Fetches index.json files from user-configured GitHub repositories
 * Integrates with the existing recommendation system pipeline
 */

import { CustomDocsRepo } from '../constants';
import { Recommendation, ContextData } from './context/context.types';
import { getCurrentPlatform, matchesContext } from './recommendation-matching.utils';
import { convertToRawIndexUrl } from './github-url.utils';

// Interface matching the static links structure
interface CustomDocsRule {
  title: string;
  url: string;
  description: string;
  type: string;
  match: {
    and?: Array<{
      urlPrefix?: string;
      urlPrefixIn?: string[];
      targetPlatform?: string;
      tag?: string;
    }>;
    or?: Array<{
      urlPrefix?: string;
      urlPrefixIn?: string[];
      targetPlatform?: string;
      tag?: string;
    }>;
    urlPrefix?: string;
    urlPrefixIn?: string[];
    targetPlatform?: string;
    tag?: string;
  };
}

interface CustomDocsIndex {
  rules: CustomDocsRule[];
}

// convertToRawIndexUrl is now imported from github-url.utils.ts

/**
 * Fetch index.json from a custom docs repository
 */
async function fetchCustomDocsIndex(repo: CustomDocsRepo): Promise<CustomDocsIndex | null> {
  try {
    const indexUrl = convertToRawIndexUrl(repo.url);

    const response = await fetch(indexUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Grafana-Docs-Plugin/1.0',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      console.warn(`Failed to fetch custom docs index from ${repo.name}: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Validate the structure matches expected format
    if (!data || !data.rules || !Array.isArray(data.rules)) {
      console.warn(`Invalid index.json structure from ${repo.name}: missing rules array`);
      return null;
    }

    return data as CustomDocsIndex;
  } catch (error) {
    console.warn(`Failed to fetch custom docs from ${repo.name}:`, error);
    return null;
  }
}

// matchesContext is now imported from recommendation-matching.utils.ts

// Platform, URL, and tag matching logic now imported from recommendation-matching.utils.ts

/**
 * Main function to fetch custom docs recommendations
 * Integrates with the existing recommendation pipeline
 */
export async function getCustomDocsRecommendations(
  contextData: ContextData,
  customRepos: CustomDocsRepo[]
): Promise<Recommendation[]> {
  if (!customRepos || customRepos.length === 0) {
    return [];
  }

  const currentPlatform = getCurrentPlatform();
  const customRecommendations: Recommendation[] = [];

  // Fetch from all configured repositories in parallel
  const fetchPromises = customRepos.map(async (repo) => {
    try {
      const docsIndex = await fetchCustomDocsIndex(repo);

      if (!docsIndex) {
        return [];
      }

      // Filter rules that match current context
      const relevantRules = docsIndex.rules.filter((rule) => matchesContext(rule, contextData, currentPlatform));

      // Convert to recommendation format
      return relevantRules.map(
        (rule): Recommendation => ({
          title: rule.title,
          url: rule.url,
          type: rule.type || 'docs-page',
          summary: rule.description || '',
          matchAccuracy: repo.confidence, // Use the repo's configured confidence
          tag: repo.name, // Use repo name as tag for source identification
        })
      );
    } catch (error) {
      console.warn(`Failed to process custom docs from ${repo.name}:`, error);
      return [];
    }
  });

  // Wait for all repositories to respond
  const results = await Promise.all(fetchPromises);

  // Flatten results into single array
  results.forEach((repoRecommendations) => {
    customRecommendations.push(...repoRecommendations);
  });

  return customRecommendations;
}

// Re-export for backward compatibility
export { convertGitHubUrlToRaw } from './github-url.utils';
