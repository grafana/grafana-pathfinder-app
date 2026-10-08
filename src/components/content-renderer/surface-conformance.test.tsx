/**
 * Surface conformance: every surface that renders a guide must record the
 * reader's progress and completion the same way.
 *
 * Each row mounts the real surface component around the real ContentRenderer,
 * completion store, identity registry and recorder. Nothing is mocked between
 * the click and the recorder, so a surface that renders a guide but forgets to
 * register its identity or record its completion fails here, where a type
 * check and a render check would both pass.
 *
 * To cover a new guide-rendering surface, add a row to SURFACES. Do not add a
 * second suite or weaken an assertion: the same checks must hold for every row.
 */
import React, { useLayoutEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { testIds } from '../../constants/testIds';
import { resetContentKeyForTests, getContentKey } from '../../global-state/content-key';
import { evictAllGuideIndexes } from '../../global-state/active-guide-index';
import { markStepCompleted, resetCompletionStoreForTests } from '../../global-state/completion-store';
import {
  __resetGuideIdentityRegistryForTests,
  lookupGuideIdentity,
  registerGuideIdentity,
  type RegisteredGuideIdentity,
} from '../../completion-records/guide-identity-registry';
import { __resetRecorderForTests, onCompletionRecorded } from '../../completion-records/completion-recorder';
import { __resetAttemptsForTests, readAttempt } from '../../completion-records/guide-attempts';
import { installProgressObserver, __resetProgressObserverForTests } from '../../completion-records/progress-observer';
import { fetchUnifiedContent } from '../../docs-retrieval';
import { DocsPanelContentArea, type DocsPanelContentAreaProps } from '../docs-panel/components/DocsPanelContentArea';
import { FloatingPanelContent } from '../floating-panel/FloatingPanelContent';
import { GuideReaderOverlay } from '../guide-reader/GuideReaderOverlay';
import { BlockPreview } from '../block-editor/BlockPreview';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? '')) : fallback,
}));

jest.mock('@grafana/data', () => ({
  ...jest.requireActual('@grafana/data'),
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  usePathfinderPluginConfig: () => ({ config: { enableTwoTabController: false } }),
}));

jest.mock('../../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn(() => false) }));

jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

jest.mock('../../lib/faro', () => ({ setFaroView: jest.fn(), setFaroViewName: jest.fn() }));

jest.mock('../../completion-records/completion-write-storage', () => ({
  ...jest.requireActual('../../completion-records/completion-write-storage'),
  currentCompletionQueueOwnerKey: () => 'user-1:org-1',
}));

jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../InteractiveLearningBanner', () => ({ InteractiveLearningBanner: () => null }));

jest.mock('../docs-panel/components/LearningJourneyMilestoneToolbar', () => ({
  LearningJourneyMilestoneToolbar: () => null,
}));
jest.mock('../docs-panel/components/PanelModeActionButtons', () => ({ PanelModeActionButtons: () => null }));
jest.mock('../docs-panel/link-handler.hook', () => ({ useLinkClickHandler: jest.fn() }));

jest.mock('../../docs-retrieval', () => ({
  ...jest.requireActual('../../docs-retrieval'),
  fetchUnifiedContent: jest.fn(),
}));

const GUIDE_URL = 'https://example.com/remote-guide/content.json';
const GUIDE_BASE_URL = 'https://example.com/remote-guide';
const STEP_ID = 'conformance-step';
const EXPECTED_IDENTITY: Pick<RegisteredGuideIdentity, 'guideSource' | 'guideId'> = {
  guideSource: 'app-platform',
  guideId: 'remote-guide',
};

const OTHER_SURFACE_IDENTITY: RegisteredGuideIdentity = {
  guideSource: 'bundled',
  guideId: 'another-surface',
  guideTitle: 'Another surface',
  guideCategory: 'interactive',
};

function guideContent(overrides: Partial<RawContent> = {}): RawContent {
  return {
    url: GUIDE_URL,
    type: 'single-doc',
    isNativeJson: true,
    content: JSON.stringify({
      id: 'remote-guide',
      title: 'Remote guide',
      blocks: [
        { type: 'markdown', content: 'Intro' },
        { type: 'markdown', id: STEP_ID, content: 'Do the thing' },
        { type: 'markdown', content: 'More' },
        { type: 'markdown', content: 'Outro' },
      ],
    }),
    lastFetched: '2026-07-31T00:00:00.000Z',
    metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
    ...overrides,
  };
}

function activeTabFor(content: RawContent): LearningJourneyTab {
  return {
    id: 'tab-1',
    title: 'Remote guide',
    type: 'docs',
    baseUrl: GUIDE_BASE_URL,
    currentUrl: content.url,
    content,
    isLoading: false,
    error: null,
  } as unknown as LearningJourneyTab;
}

function sidebarProps(content: RawContent): DocsPanelContentAreaProps {
  const activeTab = activeTabFor(content);
  return {
    styles: new Proxy({}, { get: (_target, prop) => String(prop) }) as DocsPanelContentAreaProps['styles'],
    journeyStyles: 'journeyStyles',
    docsStyles: 'docsStyles',
    interactiveStyles: 'interactiveStyles',
    prismStyles: 'prismStyles',
    model: {
      setActiveTab: jest.fn(),
      openEditorTab: jest.fn(),
      confirmAlignment: jest.fn(),
      dismissAlignment: jest.fn(),
      canNavigateNext: jest.fn(() => false),
      navigateToNextMilestone: jest.fn(),
      setActiveTrackId: jest.fn(),
    } as unknown as DocsPanelContentAreaProps['model'],
    contextPanel: { Component: () => null } as unknown as DocsPanelContentAreaProps['contextPanel'],
    isFullScreenActive: false,
    isRecommendationsTab: false,
    isEditorUser: false,
    isDevMode: false,
    isWysiwygPreview: false,
    activeTab,
    stableContent: content,
    hasInteractiveProgress: false,
    progressKey: null,
    alignmentPendingValue: { isPending: false, startingLocation: null },
    contentRef: React.createRef<HTMLDivElement>(),
    handleResetGuide: jest.fn(),
    reloadActiveTab: jest.fn(),
    restoreScrollPosition: jest.fn(),
  };
}

// The panel publishes the active tab URL from a layout effect, above the content area.
function SidebarMount({ content }: { content: RawContent }) {
  useLayoutEffect(() => {
    window.__DocsPluginActiveTabUrl = content.url;
  }, [content.url]);
  return <DocsPanelContentArea {...sidebarProps(content)} />;
}

function floatingModel() {
  return {
    setActiveTrackId: jest.fn(),
    canNavigateNext: jest.fn(() => false),
    navigateToNextMilestone: jest.fn(),
  } as unknown as React.ComponentProps<typeof FloatingPanelContent>['model'];
}

interface Surface {
  name: string;
  mount: (content: RawContent) => ReturnType<typeof render>;
  ready: () => Promise<unknown>;
}

const SURFACES: Surface[] = [
  {
    name: 'sidebar content area',
    mount: (content) => render(<SidebarMount content={content} />),
    ready: () => screen.findByTestId(testIds.markComplete.button),
  },
  {
    name: 'floating panel',
    mount: (content) =>
      render(<FloatingPanelContent content={content} activeTab={activeTabFor(content)} model={floatingModel()} />),
    ready: () => screen.findByTestId(testIds.markComplete.button),
  },
  {
    name: 'full-screen panel',
    mount: (content) =>
      render(
        <FloatingPanelContent
          content={content}
          activeTab={activeTabFor(content)}
          model={floatingModel()}
          surface="fullscreen"
        />
      ),
    ready: () => screen.findByTestId(testIds.markComplete.button),
  },
  {
    name: 'guide reader',
    mount: (content) => {
      jest
        .mocked(fetchUnifiedContent)
        .mockResolvedValue({ content } as Awaited<ReturnType<typeof fetchUnifiedContent>>);
      return render(<GuideReaderOverlay doc={content.url} />);
    },
    ready: () => screen.findByTestId(testIds.markComplete.button),
  },
];

async function clickMarkComplete(): Promise<void> {
  const button = await screen.findByTestId(testIds.markComplete.button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

let recordedFacts: Array<{ guideSource: string; guideId: string }>;
let stopListening: () => void;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  evictAllGuideIndexes();
  resetCompletionStoreForTests();
  __resetGuideIdentityRegistryForTests();
  __resetRecorderForTests();
  __resetAttemptsForTests();
  __resetProgressObserverForTests();
  installProgressObserver();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
  recordedFacts = [];
  stopListening = onCompletionRecorded((fact) => {
    recordedFacts.push({ guideSource: fact.guideSource, guideId: fact.guideId });
    return true;
  });
});

afterEach(() => {
  stopListening();
  localStorage.clear();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

describe.each(SURFACES)('$name', (surface) => {
  it('registers the guide identity under the key steps persist to', async () => {
    surface.mount(guideContent());
    await surface.ready();

    const stepKey = getContentKey();
    expect(stepKey).toBe(GUIDE_URL);
    expect(lookupGuideIdentity(stepKey)).toEqual(expect.objectContaining(EXPECTED_IDENTITY));
  });

  it('starts an attempt when a step completes', async () => {
    surface.mount(guideContent());
    await surface.ready();
    expect(readAttempt(EXPECTED_IDENTITY)).toBeNull();

    act(() => {
      markStepCompleted(STEP_ID, undefined, 'manual');
    });

    await waitFor(() => expect(readAttempt(EXPECTED_IDENTITY)).not.toBeNull());
  });

  it('records Mark complete exactly once, with the registered identity', async () => {
    surface.mount(guideContent());
    await surface.ready();
    const registered = lookupGuideIdentity(getContentKey());

    await clickMarkComplete();

    await waitFor(() => expect(recordedFacts).toHaveLength(1));
    expect(recordedFacts[0]).toEqual({ guideSource: registered?.guideSource, guideId: registered?.guideId });
    expect(recordedFacts[0]).toEqual(EXPECTED_IDENTITY);
  });

  it("keeps another surface's registration when it unmounts", async () => {
    const { unmount } = surface.mount(guideContent());
    await surface.ready();
    const key = getContentKey();
    const releaseOther = registerGuideIdentity(key, OTHER_SURFACE_IDENTITY);

    unmount();

    expect(lookupGuideIdentity(key)).toEqual(OTHER_SURFACE_IDENTITY);
    releaseOther();
    expect(lookupGuideIdentity(key)).toBeNull();
  });
});

describe('block preview', () => {
  const previewGuide = {
    id: 'preview-guide',
    title: 'Preview guide',
    blocks: [{ type: 'markdown' as const, content: 'Words' }],
  };
  const previewKey = 'block-editor://preview/preview-guide';

  it('is untracked: no identity and no completion record', async () => {
    render(<BlockPreview guide={previewGuide} />);
    await clickMarkComplete();

    expect(lookupGuideIdentity(previewKey)).toBeNull();
    expect(lookupGuideIdentity(getContentKey())).toBeNull();
    expect(recordedFacts).toEqual([]);
  });
});
