export interface ControllerTabOpenAction {
  shouldShow: boolean;
  controllerUrl?: string;
}

export function pickControllerTabOpenAction(
  url: string | undefined,
  tabType: string | undefined
): ControllerTabOpenAction {
  if (!url || tabType !== 'interactive') {
    return { shouldShow: false };
  }
  const params = new URLSearchParams();
  params.set('doc', url);
  params.set('controller', '1');
  return { shouldShow: true, controllerUrl: `/?${params.toString()}` };
}
