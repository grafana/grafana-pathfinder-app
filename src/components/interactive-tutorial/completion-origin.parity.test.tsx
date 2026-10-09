import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChallengeBlock, resetChallengeCounter } from './challenge-block';
import { CodeBlockStep } from './code-block-step';
import { DatasourceCheckStep } from './datasource-check-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveQuiz, resetQuizCounter } from './interactive-quiz';
import { InteractiveStep } from './interactive-step';
import { TerminalConnectStep, resetTerminalConnectStepCounter } from './terminal-connect-step';
import { TerminalStep } from './terminal-step';
import { evictAllGuideIndexes, publishGuideIndex } from '../../global-state/active-guide-index';
import { STANDALONE_SECTION_ID, resetCompletionStoreForTests } from '../../global-state/completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from '../../global-state/content-key';
import { subscribeProgressEvent, type ProgressEventDetail } from '../../global-state/progress-events';
import { computeGuideBlockIndex, type CountableBlock } from '../../lib/guide-stats';
import {
  COMPLETION_AFFORDANCE_BLOCK_TYPES,
  CONDITIONAL_COMPLETION_AFFORDANCE_BLOCK_TYPES,
  NON_COMPLETABLE_INTERACTIVE_BLOCK_TYPES,
} from '../../lib/guide-stats/completion-affordance';
import { interactiveStepStorage } from '../../lib/user-storage';
import { testIds } from '../../constants/testIds';

let mockTerminalStatus: 'connected' | 'disconnected' = 'connected';

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: () => ({
    status: mockTerminalStatus,
    sessionId: 's_parity',
    error: null,
    isTerminalRegistered: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendCommand: jest.fn().mockResolvedValue(undefined),
    openTerminal: jest.fn().mockImplementation(async () => {
      mockTerminalStatus = 'connected';
      return 's_parity';
    }),
    isExpanded: false,
    setIsExpanded: jest.fn(),
    _register: jest.fn(),
  }),
}));

jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  Combobox: require('../../test-utils/data-check-stubs').grafanaUiStub.Combobox,
}));

jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  ...jest.requireActual('../../integrations/coda/useCodaAvailability.hook'),
  useCodaTerminalGate: () => 'configured',
  useCodaSessionEligibility: () => ({ state: 'eligible' }),
  codaUnavailableMessage: () => null,
  useReportSandboxUnavailable: jest.fn(),
}));

jest.mock('../../requirements-manager', () => {
  const checkPostconditions = jest.fn().mockResolvedValue({ requirements: '', pass: true, error: [] });
  const checkRequirements = jest.fn().mockResolvedValue({ requirements: '', pass: true, error: [] });
  return {
    checkPostconditions,
    checkRequirements,
    validateInteractiveRequirements: jest.fn(),
    useGuideRequirements: () => ({ checkPostconditions, checkRequirements }),
    useRequirementsManager: () => ({ manager: { subscribe: () => () => {}, getSnapshot: () => new Map() } }),
    dispatchFix: jest.fn(),
    useStepChecker: ({ isEligibleForChecking }: { isEligibleForChecking?: boolean }) => ({
      status: 'enabled',
      isEnabled: isEligibleForChecking !== false,
      isChecking: false,
      isCompleted: false,
      explanation: null,
      canSkip: false,
      markSkipped: jest.fn(),
      resetStep: jest.fn(),
    }),
  };
});

jest.mock('../../interactive-engine', () => ({
  ...jest.requireActual('../../interactive-engine'),
  clearAndInsertCode: jest.fn().mockResolvedValue({ success: true }),
  GuidedHandler: jest.fn().mockImplementation(() => ({
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
    execute: jest.fn(),
    cancel: jest.fn(),
  })),
}));

jest.mock('../../integrations/coda/coda-api', () => ({
  ...jest.requireActual('../../integrations/coda/coda-api'),
  provisionGcx: jest.fn(),
  canMintGrafanaToken: () => false,
}));

jest.mock('../../lib/datasource/run-data-check-query', () => ({
  runDataCheckQuery: jest.fn().mockResolvedValue({ ok: true, hasData: true, seriesCount: 1, rowCount: 3 }),
}));

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getDataSourceSrv: () => ({
    getList: () => [{ uid: 'prom', name: 'Prometheus', type: 'prometheus', meta: { id: 'prometheus' } }],
  }),
}));

const CONTENT_KEY = 'https://example.com/parity-guide/content.json';
const STEP_ID = 'parity-step';

type CompletableBlockType =
  (typeof COMPLETION_AFFORDANCE_BLOCK_TYPES)[number] | (typeof CONDITIONAL_COMPLETION_AFFORDANCE_BLOCK_TYPES)[number];

interface BlockCase {
  indexBlock: CountableBlock;
  mount: () => React.ReactElement;
  complete: () => Promise<void>;
}

const QUIZ_CHOICES = [
  { id: 'wrong', text: 'Wrong answer', correct: false },
  { id: 'right', text: 'Right answer', correct: true },
];

const click = async (testId: string) => {
  fireEvent.click(await screen.findByTestId(testId));
};

const BLOCKS: Record<CompletableBlockType, BlockCase> = {
  interactive: {
    indexBlock: { type: 'interactive' },
    mount: () => (
      <InteractiveStep stepId={STEP_ID} targetAction="button" refTarget="#parity-target" showMe={false} doIt>
        Press the button
      </InteractiveStep>
    ),
    complete: () => click(testIds.interactive.doItButton(STEP_ID)),
  },
  multistep: {
    indexBlock: { type: 'multistep' },
    mount: () => <InteractiveMultiStep stepId={STEP_ID} internalActions={[{ targetAction: 'noop' }]} />,
    complete: () => click(testIds.interactive.doItButton(STEP_ID)),
  },
  guided: {
    indexBlock: { type: 'guided' },
    mount: () => <InteractiveGuided stepId={STEP_ID} internalActions={[{ targetAction: 'noop' }]} />,
    complete: () => click(testIds.interactive.doItButton(STEP_ID)),
  },
  quiz: {
    indexBlock: { type: 'quiz' },
    mount: () => <InteractiveQuiz stepId={STEP_ID} question="Pick one" choices={QUIZ_CHOICES} shuffle={false} />,
    complete: async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Right answer' }));
      fireEvent.click(screen.getByRole('button', { name: /check answer/i }));
    },
  },
  terminal: {
    indexBlock: { type: 'terminal' },
    mount: () => <TerminalStep stepId={STEP_ID} command="echo hello" />,
    complete: () => click(testIds.interactive.terminalExecButton(STEP_ID)),
  },
  'terminal-connect': {
    indexBlock: { type: 'terminal-connect' },
    mount: () => {
      mockTerminalStatus = 'disconnected';
      return <TerminalConnectStep stepId={STEP_ID} />;
    },
    complete: async () => {
      fireEvent.click(await screen.findByTestId(testIds.interactive.terminalConnectButton(STEP_ID)));
    },
  },
  'code-block': {
    indexBlock: { type: 'code-block' },
    mount: () => <CodeBlockStep stepId={STEP_ID} code="up" refTarget="#parity-target" />,
    complete: async () => {
      fireEvent.click(await screen.findByRole('button', { name: /insert/i }));
    },
  },
  challenge: {
    indexBlock: { type: 'challenge' },
    mount: () => (
      <ChallengeBlock
        stepId={STEP_ID}
        title="Parity challenge"
        brief="Solve it"
        mode="standard"
        successCriteria="has-dashboard-named:Parity"
      />
    ),
    complete: async () => {
      fireEvent.click(await screen.findByRole('button', { name: /check my work/i }));
    },
  },
  input: {
    indexBlock: { type: 'input', inputType: 'datasource', dataCheckQuery: 'up', dataCheckBlocking: true },
    mount: () => (
      <DatasourceCheckStep stepId={STEP_ID} variableName="parityDatasource" query="up" datasourceFilter="prometheus" />
    ),
    complete: async () => {
      fireEvent.change(await screen.findByLabelText(/select a data source/i), { target: { value: 'Prometheus' } });
      await click(testIds.dataCheck.runQueryButton(STEP_ID));
    },
  },
};

function publishIndexFor(block: BlockCase): void {
  publishGuideIndex({
    contentKey: CONTENT_KEY,
    index: computeGuideBlockIndex([
      { type: 'markdown' },
      { ...block.indexBlock, id: STEP_ID },
      { type: 'markdown' },
      { type: 'markdown' },
    ]),
    denominatorSource: 'live-pre-inlining',
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('completion origin parity across completable block types', () => {
  let announced: Array<Extract<ProgressEventDetail, { kind: 'guide' }>>;
  let unsubscribe: () => void;

  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
    mockTerminalStatus = 'connected';
    localStorage.clear();
    resetCompletionStoreForTests();
    resetContentKeyForTests();
    evictAllGuideIndexes();
    resetQuizCounter();
    resetChallengeCounter();
    resetTerminalConnectStepCounter();
    setActiveTabUrl(CONTENT_KEY);
    const target = document.createElement('button');
    target.id = 'parity-target';
    document.body.appendChild(target);
    announced = [];
    unsubscribe = subscribeProgressEvent((detail) => {
      if (detail.kind === 'guide') {
        announced.push(detail);
      }
    });
  });

  afterEach(() => {
    unsubscribe();
    document.body.innerHTML = '';
  });

  it('has a driver for exactly the block types that can emit completion evidence', () => {
    expect(Object.keys(BLOCKS).sort()).toEqual(
      [...COMPLETION_AFFORDANCE_BLOCK_TYPES, ...CONDITIONAL_COMPLETION_AFFORDANCE_BLOCK_TYPES].sort()
    );
    for (const passive of NON_COMPLETABLE_INTERACTIVE_BLOCK_TYPES) {
      expect(Object.keys(BLOCKS)).not.toContain(passive);
    }
  });

  it.each(Object.keys(BLOCKS) as CompletableBlockType[])(
    'announces a %s completion to the guide percentage as a change',
    async (type) => {
      const block = BLOCKS[type];
      publishIndexFor(block);
      render(block.mount());
      await settle();
      announced.length = 0;

      await block.complete();

      await waitFor(() => expect(announced.length).toBeGreaterThan(0), { timeout: 5000 });
      expect(announced.map((detail) => detail.origin)).toEqual(['change']);
      expect(announced[0]).toMatchObject({ contentKey: CONTENT_KEY, hasProgress: true });
    }
  );

  it.each(Object.keys(BLOCKS) as CompletableBlockType[])(
    'does not announce a stored %s completion as a change when the guide reopens',
    async (type) => {
      const block = BLOCKS[type];
      publishIndexFor(block);
      await interactiveStepStorage.setCompleted(CONTENT_KEY, STANDALONE_SECTION_ID, new Set([STEP_ID]));

      render(block.mount());
      await settle();

      expect(announced.length).toBeGreaterThan(0);
      expect(announced.every((detail) => detail.origin === 'load')).toBe(true);
    }
  );
});
