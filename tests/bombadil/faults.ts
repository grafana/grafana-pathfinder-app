/**
 * Controlled violations for the property-sensitivity check (acceptance
 * criterion 3). Each fault writes the exact storage shape the corresponding
 * defect would leave behind, from an init script, so a property that cannot see
 * it is proven blind. They exercise the PROPERTIES, not the product: a fault
 * run is expected to exit 2, a clean run to exit 0.
 */

export const FAULTS = ['preview-completion', 'reopen-mints', 'cross-credit'] as const;
export type Fault = (typeof FAULTS)[number];

export function isFault(value: string | undefined): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

export function faultInitScript(fault: Fault, ids: { guideB: string; preview: string }): string {
  return `(() => {
    const fault = ${JSON.stringify(fault)};
    const ids = ${JSON.stringify(ids)};
    const QUEUE = 'grafana-pathfinder-app-completion-write-queue-v2:';
    const PERCENT = 'grafana-pathfinder-app-interactive-completion';
    const later = (fn) => window.addEventListener('load', () => setTimeout(fn, 600));
    const queued = (guideId) => {
      const id = 'fault-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem(QUEUE + 'fault:item:' + id, JSON.stringify({
        id, attempts: 0, createdAt: Date.now(),
        body: {
          guideSource: 'bombadil-fixtures', guideId, guideTitle: guideId, guideCategory: 'testing',
          completionPercent: 100, source: 'bombadil-fault', completedAt: new Date().toISOString(), platform: 'oss',
        },
      }));
    };
    if (fault === 'preview-completion') {
      const loadedAsPreview = location.href.includes('pf-pr-');
      later(() => {
        if (loadedAsPreview) queued(ids.preview);
      });
    }
    if (fault === 'reopen-mints') {
      later(() => queued('fault-reopen-' + Date.now()));
    }
    if (fault === 'cross-credit') {
      later(() => {
        const percent = JSON.parse(localStorage.getItem(PERCENT) || '{}');
        const other = 'https://interactive-learning.grafana.net/packages/' + ids.guideB + '/content.json';
        if (Object.keys(percent).some((key) => key !== other)) {
          percent[other] = Math.min(99, (percent[other] || 0) + 10);
          localStorage.setItem(PERCENT, JSON.stringify(percent));
        }
      });
    }
  })();`;
}
