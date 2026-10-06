export function disableRudderstack(): void {
  let bootData: { settings: Record<string, unknown> } | undefined;

  // Grafana assigns boot data after init scripts, before its analytics backend starts.
  Object.defineProperty(window, 'grafanaBootData', {
    configurable: true,
    get: () => bootData,
    set: (value: NonNullable<typeof bootData>) => {
      value.settings.rudderstackWriteKey = '';
      value.settings.rudderstackDataPlaneUrl = '';
      bootData = value;
    },
  });
}
