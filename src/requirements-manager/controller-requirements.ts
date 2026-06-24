// Requirements that probe THIS tab's live DOM / URL / navigation and therefore
// cannot be evaluated from a controller tab driving a different Grafana tab.
// Session / permission requirements (is-admin, has-datasources, dashboard-exists,
// ...) are deliberately NOT listed — they reflect the user's Grafana, are valid
// from any tab, and must still gate so genuine failures surface to the user.
// Exported for the drift tripwire in controller-requirements.test.ts. When a new
// DOM/URL/navigation-probing requirement is added to the requirements checker,
// add its id here too, or it will be (wrongly) evaluated against the controller
// tab instead of stripped (F-1063-2).
export const TAB_LOCAL_REQUIREMENTS = ['exists-reftarget', 'navmenu-open', 'on-page', 'form-valid'];

function isTabLocal(token: string): boolean {
  return TAB_LOCAL_REQUIREMENTS.some((id) => token === id || token.startsWith(`${id}:`));
}

export function stripTabLocalRequirements(requirements: string | undefined): string | undefined {
  if (!requirements) {
    return requirements;
  }
  return requirements
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !isTabLocal(token))
    .join(',');
}
