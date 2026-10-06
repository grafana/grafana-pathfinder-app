import {
  reportAppInteraction,
  UserInteraction,
  bindExperimentsProvider,
  setupScrollTracking,
  clearScrollTrackingCache,
  buildInteractiveStepProperties,
  getGuideBlockCountProperties,
  reportStepSkipped,
} from './analytics';
import { reportInteraction } from '@grafana/runtime';
import { pushFaroUserAction } from './telemetry/bridge';
import { computeGuideBlockIndex, guideProgress, type CountableBlock } from './guide-stats';
import { evictAllGuideIndexes, publishGuideIndex } from '../global-state/active-guide-index';
import { resetContentKeyForTests, setActiveTabUrl } from '../global-state/content-key';

jest.mock('@grafana/runtime', () => ({
  reportInteraction: jest.fn(),
}));

jest.mock('../../package.json', () => ({
  version: '1.0.0-test',
}));

jest.mock('../security/url-validator', () => ({
  isInteractiveLearningUrl: jest.fn(() => false),
}));

jest.mock('./telemetry/bridge', () => ({
  pushFaroUserAction: jest.fn(),
  pushFaroLog: jest.fn(),
  pushFaroError: jest.fn(),
}));

const mockReportInteraction = reportInteraction as jest.Mock;
const mockPushFaroUserAction = pushFaroUserAction as jest.Mock;

describe('reportAppInteraction', () => {
  it('removes private guide identifiers and authored metadata from the Faro mirror', () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      guide_url: 'backend-guide:private-resource',
      guide_title: 'Private title',
      guide_id: 'private-resource',
      content: 'Private guide content',
    });
    const payload = mockPushFaroUserAction.mock.calls.at(-1)![1];
    expect(payload.guide_url).toMatch(/^private-guide:/);
    expect(payload.action).toBe('open');
    expect(JSON.stringify(payload)).not.toContain('private-resource');
    expect(JSON.stringify(payload)).not.toContain('Private');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).__pathfinderKioskSessionId;
  });

  it('includes kiosk_session_id when window global is set', () => {
    (window as any).__pathfinderKioskSessionId = 'test-session-abc';

    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'open' });

    expect(mockReportInteraction).toHaveBeenCalledWith(
      'pathfinder_docs_panel_interaction',
      expect.objectContaining({
        kiosk_session_id: 'test-session-abc',
        action: 'open',
        plugin_version: '1.0.0-test',
      })
    );
  });

  it('omits kiosk_session_id when window global is not set', () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'open' });

    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties).not.toHaveProperty('kiosk_session_id');
  });

  it('omits kiosk_session_id when window global is empty string', () => {
    (window as any).__pathfinderKioskSessionId = '';

    reportAppInteraction(UserInteraction.DocsPanelInteraction, {});

    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties).not.toHaveProperty('kiosk_session_id');
  });

  it('includes kiosk_session_id alongside other enriched properties', () => {
    (window as any).__pathfinderKioskSessionId = 'kiosk-123';

    reportAppInteraction(UserInteraction.ShowMeButtonClick, {
      step_id: 'step-1',
      content_type: 'interactive-guide',
    });

    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties.kiosk_session_id).toBe('kiosk-123');
    expect(properties.step_id).toBe('step-1');
    expect(properties.content_type).toBe('interactive-guide');
    expect(properties.plugin_version).toBe('1.0.0-test');
  });
});

describe('reportAppInteraction Faro mirroring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mirrors the same interaction name and enriched properties to Faro', () => {
    reportAppInteraction(UserInteraction.ShowMeButtonClick, { step_id: 'step-1' });

    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);

    const [reportedName, reportedProperties] = mockReportInteraction.mock.calls[0];
    const [mirroredName, mirroredProperties] = mockPushFaroUserAction.mock.calls[0];
    expect(mirroredName).toBe(reportedName);
    expect(mirroredProperties).toEqual(reportedProperties);
    // A defensive copy, not the shared reference — neither pipeline can
    // mutate the other's payload.
    expect(mirroredProperties).not.toBe(reportedProperties);
  });

  it('still reports to Rudderstack even if the Faro mirror throws', () => {
    mockPushFaroUserAction.mockImplementationOnce(() => {
      throw new Error('faro is down');
    });

    // reportInteraction is called before the mirror, and the outer try/catch
    // means a later mirror failure can't unwind or suppress that earlier call.
    expect(() => reportAppInteraction(UserInteraction.ShowMeButtonClick, {})).not.toThrow();
    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
  });

  it('still mirrors to Faro when reportInteraction itself throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockReportInteraction.mockImplementationOnce(() => {
      throw new Error('rudderstack down');
    });

    expect(() => reportAppInteraction(UserInteraction.ShowMeButtonClick, { step_id: 'step-1' })).not.toThrow();
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('normalizes *_url properties in the Faro mirror but leaves the RudderStack payload raw', () => {
    const rawUrl = 'https://grafana.com/docs/foo/?token=secret#frag';
    reportAppInteraction(UserInteraction.OpenResourceClick, { content_url: rawUrl });

    const reportedProps = mockReportInteraction.mock.calls[0][1];
    const mirroredProps = mockPushFaroUserAction.mock.calls[0][1];

    expect(reportedProps.content_url).toBe(rawUrl);
    expect(mirroredProps.content_url).toBe('grafana.com/docs/foo/');
  });

  it('does not touch string properties whose key does not end in url', () => {
    reportAppInteraction(UserInteraction.OpenResourceClick, { content_title: 'https://grafana.com/looks-like-a-url' });

    const mirroredProps = mockPushFaroUserAction.mock.calls[0][1];
    expect(mirroredProps.content_title).toBe('https://grafana.com/looks-like-a-url');
  });
});

describe('reportAppInteraction experiment enrichment', () => {
  const HIGHLIGHTED = 'pathfinder.highlighted-guide-experiment';

  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).__pathfinderKioskSessionId;
  });

  // Runs first, while the module-level provider is still unbound (nothing has
  // called bindExperimentsProvider yet), so it exercises the graceful no-op path.
  it('reports without variant/experiments when no provider is bound', () => {
    reportAppInteraction(UserInteraction.SummaryClick, { content_url: 'u' });

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
    expect(props.plugin_version).toBe('1.0.0-test');
  });

  it('passes the enrolled experiment through and rolls variant up to treatment', () => {
    bindExperimentsProvider(() => [
      { flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g', docType: 'learning-journey' },
    ]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.variant).toBe('treatment');
    expect(props.experiments).toEqual([
      expect.objectContaining({ flag: HIGHLIGHTED, variant: 'treatment', guideId: 'g', docType: 'learning-journey' }),
    ]);
  });

  it('rolls variant up to control when no enrolled experiment is treatment', () => {
    bindExperimentsProvider(() => [{ flag: HIGHLIGHTED, variant: 'control', pages: [], guideId: 'g' }]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    expect(mockReportInteraction.mock.calls[0][1].variant).toBe('control');
  });

  it.each([
    ['control before treatment', ['control', 'treatment']],
    ['treatment before control', ['treatment', 'control']],
  ] as const)('rolls multiple experiments up to treatment with %s', (_order, variants) => {
    bindExperimentsProvider(() => variants.map((variant) => ({ flag: HIGHLIGHTED, variant, pages: [], guideId: 'g' })));

    reportAppInteraction(UserInteraction.SummaryClick, {});

    expect(mockReportInteraction.mock.calls[0][1].variant).toBe('treatment');
  });

  it('rolls variant up to excluded when every experiment is excluded', () => {
    bindExperimentsProvider(() => [{ flag: HIGHLIGHTED, variant: 'excluded', pages: [], guideId: 'g' }]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    expect(mockReportInteraction.mock.calls[0][1].variant).toBe('excluded');
  });

  it('omits variant/experiments when the user is enrolled in nothing', () => {
    bindExperimentsProvider(() => []);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
  });

  it('strips experiments from the Faro mirror but keeps it in the RudderStack payload', () => {
    bindExperimentsProvider(() => [
      { flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g', docType: 'learning-journey' },
    ]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    const reportedProps = mockReportInteraction.mock.calls[0][1];
    const mirroredProps = mockPushFaroUserAction.mock.calls[0][1];
    expect(reportedProps).toHaveProperty('experiments');
    expect(mirroredProps).not.toHaveProperty('experiments');
    // Everything else still mirrors, including the small `variant` rollup.
    expect(mirroredProps.variant).toBe(reportedProps.variant);
  });

  it('does not enrich FeatureFlagEvaluated events (recursion guard)', () => {
    bindExperimentsProvider(() => [{ flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g' }]);

    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, { flag_key: HIGHLIGHTED });

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
    expect(props.flag_key).toBe(HIGHLIGHTED);
  });

  it('still mirrors flag exposures to Faro (beforeSend gates delivery, not the mirror)', () => {
    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, { flag_key: HIGHLIGHTED });
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);
  });
});

describe('setupScrollTracking PanelScroll content_type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearScrollTrackingCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function fireScroll(el: HTMLElement): void {
    el.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(150);
  }

  it('keeps content_type in sync with page_type when the tab has no type (both fall back to learning-journey)', () => {
    const el = document.createElement('div');
    const activeTab = { content: { url: 'https://example.com/journey' } };

    const cleanup = setupScrollTracking(el, activeTab, false);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.page_type).toBe('learning-journey');
    expect(props.content_type).toBe('learning-journey');
    cleanup();
  });

  it('maps an interactive tab to the canonical interactive-guide content_type', () => {
    const el = document.createElement('div');
    const activeTab = { type: 'interactive' as const, content: { url: 'https://example.com/guide' } };

    const cleanup = setupScrollTracking(el, activeTab, false);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.page_type).toBe('interactive');
    expect(props.content_type).toBe('interactive-guide');
    cleanup();
  });

  it('reports an empty content_type for the recommendations tab', () => {
    const el = document.createElement('div');

    const cleanup = setupScrollTracking(el, null, true);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.page_type).toBe('recommendations');
    expect(props.content_type).toBe('');
    cleanup();
  });
});

describe('step events: block progress properties', () => {
  const GUIDE_KEY = 'bundled:block-progress-guide';
  const blocks: CountableBlock[] = [
    { type: 'markdown' },
    { type: 'interactive', id: 'open-menu' },
    { type: 'section', id: 'explore', blocks: [{ type: 'markdown' }, { type: 'multistep' }] },
    { type: 'conditional', whenTrue: [{ type: 'interactive' }], whenFalse: [{ type: 'markdown' }] },
    { type: 'markdown' },
  ];
  const index = computeGuideBlockIndex(blocks, {
    resolveStepId: (_block, { parentSectionId, index: childIndex }) => `rt:${parentSectionId}:${childIndex}`,
  });
  const [branchChildStepId] = [...index.branchChildPositions.keys()];

  beforeEach(() => {
    jest.clearAllMocks();
    resetContentKeyForTests();
    setActiveTabUrl(GUIDE_KEY);
  });

  afterEach(() => {
    evictAllGuideIndexes();
    resetContentKeyForTests();
    delete window.__DocsPluginActiveTabUrl;
  });

  function publish(contentKey = GUIDE_KEY) {
    publishGuideIndex({ contentKey, index, denominatorSource: 'live-pre-inlining' });
  }

  it('adds the counted position and the guide counts when the active guide has an index', () => {
    publish();

    const props = buildInteractiveStepProperties(
      { target_action: 'button' },
      { stepId: 'rt:__standalone__:1', stepIndex: 0, totalSteps: 2 }
    );

    expect(props).toMatchObject({
      block_position: 2,
      block_progress_rule_version: 'block-position-v1',
      guide_stats_version: 1,
      total_block_count: 6,
      completable_block_count: 2,
      section_count: 1,
    });
  });

  it('leaves completion_percentage as the step position over total_document_steps', () => {
    publish();

    const props = buildInteractiveStepProperties({}, { stepId: 'rt:__standalone__:1', stepIndex: 0, totalSteps: 4 });

    expect(props.completion_percentage).toBe(25);
    expect(props.current_step).toBe(1);
    expect(props.total_document_steps).toBe(4);
  });

  it('credits a conditional branch child at its conditional, and an author id through positionsById', () => {
    publish();

    expect(buildInteractiveStepProperties({}, { stepId: branchChildStepId }).block_position).toBe(5);
    expect(buildInteractiveStepProperties({}, { stepId: 'open-menu' }).block_position).toBe(2);
  });

  it('reports the same position the completion evidence rule credits for every addressable step', () => {
    publish();
    const stepIds = [
      ...index.positionsByStepId.keys(),
      ...index.branchChildPositions.keys(),
      ...index.positionsById.keys(),
    ];

    for (const stepId of stepIds) {
      const credited = guideProgress(index, [{ kind: 'do-it', blockId: stepId }]).position;
      expect(buildInteractiveStepProperties({}, { stepId }).block_position).toBe(credited);
    }
  });

  it.each([
    ['the step has no position in the index', () => publish(), 'standalone-step-1'],
    ['the active guide has no index', () => undefined, 'rt:__standalone__:1'],
    ['the index belongs to another content key', () => publish('bundled:another-guide'), 'rt:__standalone__:1'],
    ['the step has no id', () => publish(), undefined],
  ])('omits every block property when %s', (_case, arrange, stepId) => {
    arrange();

    const props = buildInteractiveStepProperties({}, { stepId, stepIndex: 0, totalSteps: 2 });

    expect(props).not.toHaveProperty('block_position');
    expect(props).not.toHaveProperty('total_block_count');
    expect(props).not.toHaveProperty('completable_block_count');
    expect(props).not.toHaveProperty('section_count');
  });

  it('looks the index up under the content key the completion store resolves, including the legacy global', () => {
    resetContentKeyForTests();
    window.__DocsPluginActiveTabUrl = GUIDE_KEY;
    publish();

    expect(buildInteractiveStepProperties({}, { stepId: 'rt:__standalone__:1' }).block_position).toBe(2);
  });

  it('exposes the guide counts for a content key, and nothing without an index', () => {
    expect(getGuideBlockCountProperties(GUIDE_KEY)).toEqual({});

    publish();

    expect(getGuideBlockCountProperties(GUIDE_KEY)).toEqual({
      block_progress_rule_version: 'block-position-v1',
      guide_stats_version: 1,
      total_block_count: 6,
      completable_block_count: 2,
      section_count: 1,
    });
  });
});

describe('reportStepSkipped', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetContentKeyForTests();
  });

  afterEach(() => {
    evictAllGuideIndexes();
    resetContentKeyForTests();
  });

  it('reports step_skipped with the same step properties as the other step events', () => {
    setActiveTabUrl('bundled:skip-guide');
    reportStepSkipped(
      { targetAction: 'button', interactionLocation: 'interactive_step', skipReason: 'requirements_unmet' },
      { stepId: 'step-a', stepIndex: 1, totalSteps: 4, sectionId: 'intro', sectionTitle: 'Intro' }
    );

    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
    expect(mockReportInteraction).toHaveBeenCalledWith(
      'pathfinder_step_skipped',
      expect.objectContaining({
        ...buildInteractiveStepProperties(
          {},
          { stepId: 'step-a', stepIndex: 1, totalSteps: 4, sectionId: 'intro', sectionTitle: 'Intro' }
        ),
        target_action: 'button',
        interaction_location: 'interactive_step',
        skip_reason: 'requirements_unmet',
      })
    );
  });
});
