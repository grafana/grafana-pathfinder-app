import { ALLOWED_GITHUB_REPOS } from "../constants";
import { isAllowedContentUrl, isAllowedGitHubRawUrl, isGitHubRawUrl, isGitHubUrl, isLocalhostUrl } from "security";
import { isDevModeEnabledGlobal } from "utils/dev-mode";

// SECURITY (F6): Check if it's a supported docs URL using secure validation
// Must match the same validation as content-fetcher, docs-panel, link-handler, and global-link-interceptor
// In production: Grafana docs URLs and approved GitHub repos
// In dev mode: Also allows any GitHub URLs and localhost URLs for testing
export function isValidUrl(url: string): boolean {
  return (
    isAllowedContentUrl(url) ||
    isAllowedGitHubRawUrl(url, ALLOWED_GITHUB_REPOS) ||
    isGitHubUrl(url) ||
    (isDevModeEnabledGlobal() && (isLocalhostUrl(url) || isGitHubRawUrl(url)))
  );
}
