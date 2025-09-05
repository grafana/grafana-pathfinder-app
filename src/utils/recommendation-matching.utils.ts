/**
 * Shared utilities for recommendation matching logic
 * Eliminates duplication between ContextService and custom docs fetcher
 */

import { config } from '@grafana/runtime';

/**
 * Get current Grafana platform (cloud vs oss)
 */
export function getCurrentPlatform(): string {
  try {
    return config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud') ? 'cloud' : 'oss';
  } catch {
    return 'oss'; // Default to OSS
  }
}

/**
 * Check if match condition matches current platform
 */
export function matchesPlatform(match: any, currentPlatform: string): boolean {
  if (!match) {
    return false;
  }

  // Check for direct targetPlatform property
  if (match.targetPlatform) {
    return match.targetPlatform === currentPlatform;
  }

  // Check AND conditions - all must match
  if (match.and && Array.isArray(match.and)) {
    return match.and.every((condition: any) => matchesPlatform(condition, currentPlatform));
  }

  // Check OR conditions - at least one must match
  if (match.or && Array.isArray(match.or)) {
    return match.or.some((condition: any) => matchesPlatform(condition, currentPlatform));
  }

  // If no platform-related properties, assume it matches (no platform constraint)
  return true;
}

/**
 * Check if match condition matches current URL path
 * Handles both urlPrefix and urlPrefixIn formats
 */
export function matchesUrlPrefix(match: any, currentPath: string): boolean {
  if (!match) {
    return false;
  }

  // Check for direct urlPrefix property
  if (match.urlPrefix) {
    return currentPath.startsWith(match.urlPrefix);
  }

  // Check for urlPrefixIn array property
  if (match.urlPrefixIn && Array.isArray(match.urlPrefixIn)) {
    return match.urlPrefixIn.some((prefix: string) => currentPath.startsWith(prefix));
  }

  // Check AND conditions - all must match
  if (match.and && Array.isArray(match.and)) {
    return match.and.every((condition: any) => matchesUrlPrefix(condition, currentPath));
  }

  // Check OR conditions - at least one must match
  if (match.or && Array.isArray(match.or)) {
    return match.or.some((condition: any) => matchesUrlPrefix(condition, currentPath));
  }

  // If no URL-related properties, assume it matches (no URL constraint)
  return true;
}

/**
 * Check if match condition contains any tag properties
 */
export function containsTagInMatch(match: any): boolean {
  if (!match) {
    return false;
  }

  // Check for direct tag property
  if (match.tag) {
    return true;
  }

  // Recursively check AND conditions
  if (match.and && Array.isArray(match.and)) {
    return match.and.some((condition: any) => containsTagInMatch(condition));
  }

  // Recursively check OR conditions
  if (match.or && Array.isArray(match.or)) {
    return match.or.some((condition: any) => containsTagInMatch(condition));
  }

  return false;
}

/**
 * Check if a rule matches the current context
 * Combines platform, URL, and tag matching logic
 */
export function matchesContext(
  rule: { match: any },
  contextData: { currentPath: string },
  currentPlatform: string
): boolean {
  const match = rule.match;

  if (!match) {
    return false;
  }

  // Check platform match
  if (!matchesPlatform(match, currentPlatform)) {
    return false;
  }

  // Check URL prefix match
  if (!matchesUrlPrefix(match, contextData.currentPath)) {
    return false;
  }

  // Skip entries with tag properties (only want top-level navigation)
  if (containsTagInMatch(match)) {
    return false;
  }

  return true;
}
