/**
 * Computes whether the docs panel should surface the "open read-only in a new
 * tab" button for a tab, and the URL to open.
 *
 * Sibling of `pickGrafanaDocsOpenAction`: that one handles public Grafana docs
 * URLs (directly browser-openable); this one handles the complementary case —
 * custom/private guides on the internal `backend-guide:` / `api:` schemes,
 * which are not addressable HTTP resources. The URL is a same-origin (so
 * authenticated) root link carrying `?doc=&readonly=1`; on the new tab,
 * `module.tsx` mounts a full-screen read-only overlay over Grafana instead of
 * opening the sidebar.
 */

export interface ReadonlyTabOpenAction {
  shouldShow: boolean;
  readonlyUrl?: string;
}

export function pickReadonlyTabOpenAction(url: string | undefined): ReadonlyTabOpenAction {
  if (!url || (!url.startsWith('backend-guide:') && !url.startsWith('api:'))) {
    return { shouldShow: false };
  }
  const params = new URLSearchParams();
  params.set('doc', url);
  params.set('readonly', '1');
  return { shouldShow: true, readonlyUrl: `/?${params.toString()}` };
}
