import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeBlockStep } from './code-block-step';
import {
  STANDALONE_SECTION_ID,
  markStepCompleted,
  resetCompletionStoreForTests,
  useStepCompletion,
} from '../../global-state/completion-store';

const mockClearAndInsertCode = jest.fn();
jest.mock('../../interactive-engine', () => ({
  ...jest.requireActual('../../interactive-engine'),
  useInteractiveElements: () => ({ executeInteractiveAction: jest.fn() }),
  clearAndInsertCode: (...args: unknown[]) => mockClearAndInsertCode(...args),
}));

const mockGetMode = jest.fn(() => 'sidebar');
const mockRequestSidebarHandoffAndWait = jest.fn().mockResolvedValue(undefined);
jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: () => mockGetMode() },
  requestSidebarHandoffAndWait: (...args: unknown[]) => mockRequestSidebarHandoffAndWait(...args),
}));

describe('CodeBlockStep: currentCode resync with the code prop', () => {
  it('picks up code prop updates when rendered outside an AssistantBlockWrapper', () => {
    const { container, rerender } = render(<CodeBlockStep code="query_range(up)" refTarget="#editor" />);

    expect(container.querySelector('code')).toHaveTextContent('query_range(up)');

    // Simulates variable substitution resolving after the initial render (e.g. a
    // requirement/quiz response filling in a template placeholder in the code prop).
    rerender(<CodeBlockStep code="query_range(node_cpu_seconds_total)" refTarget="#editor" />);

    expect(container.querySelector('code')).toHaveTextContent('query_range(node_cpu_seconds_total)');
  });
});

describe('CodeBlockStep: hints', () => {
  const UNSATISFIABLE_REQUIREMENT = 'on-page:/pathfinder-code-block-never-here';

  it('explains an unmet requirement with the authored hint', async () => {
    render(
      <CodeBlockStep
        code="query_range(up)"
        refTarget="#editor"
        requirements={UNSATISFIABLE_REQUIREMENT}
        hints="Open the Explore query editor before inserting this query."
      />
    );

    // The unmet requirement retries for real (maxRetries: 3 * retryDelay: 300ms, see
    // INTERACTIVE_CONFIG) before settling into the blocked state, so this needs the same
    // generous timeout as the retry-chain assertions in step-checker.hook.test.ts rather
    // than RTL's 1000ms default, which leaves too little margin under CI load.
    expect(
      await screen.findByText('Open the Explore query editor before inserting this query.', {}, { timeout: 10000 })
    ).toBeInTheDocument();
  });

  it('falls back to the generic requirement message when no hint is authored', async () => {
    render(<CodeBlockStep code="query_range(up)" refTarget="#editor" requirements={UNSATISFIABLE_REQUIREMENT} />);

    expect(await screen.findByText(/Navigate to the .* page first/, {}, { timeout: 10000 })).toBeInTheDocument();
  });
});

describe('CodeBlockStep: full-screen sidebar handoff on Insert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMode.mockReturnValue('sidebar');
    mockClearAndInsertCode.mockResolvedValue({ success: true });
  });

  it('hands off before inserting when in full screen', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    const { getByRole } = render(
      <CodeBlockStep code="query_range(up)" refTarget="#editor" fullScreenFallbackLocation="/explore" />
    );

    fireEvent.click(getByRole('button', { name: /insert/i }));

    await waitFor(() => {
      expect(mockClearAndInsertCode).toHaveBeenCalled();
    });
    expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledWith({ targetPath: '/explore' });
    const handoffCallOrder = mockRequestSidebarHandoffAndWait.mock.invocationCallOrder[0]!;
    const insertCallOrder = mockClearAndInsertCode.mock.invocationCallOrder[0]!;
    expect(handoffCallOrder).toBeLessThan(insertCallOrder);
  });

  it('does not hand off outside full screen', async () => {
    mockGetMode.mockReturnValue('sidebar');
    const { getByRole } = render(<CodeBlockStep code="query_range(up)" refTarget="#editor" />);

    fireEvent.click(getByRole('button', { name: /insert/i }));

    await waitFor(() => {
      expect(mockClearAndInsertCode).toHaveBeenCalled();
    });
    expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
  });
});

describe('CodeBlockStep: a section reset', () => {
  function Probe({ stepId, sectionId }: { stepId: string; sectionId: string }) {
    const { completed } = useStepCompletion(stepId, sectionId);
    return <span data-testid="probe">{completed ? 'stored' : 'cleared'}</span>;
  }

  beforeEach(() => {
    resetCompletionStoreForTests();
  });

  // The section broadcasts one `resetTrigger` to every child, but clears only
  // the redone step and its tail. A per-child store write would delete the
  // completions the section deliberately kept.
  it('keeps a preceding step complete when the section broadcasts a redo of a later step', () => {
    markStepCompleted('cb-1', 'sec-1', 'manual');
    const props = {
      code: 'query_range(up)',
      refTarget: '#editor',
      stepId: 'cb-1',
      sectionId: 'sec-1',
      onStepComplete: jest.fn(),
    };

    const { rerender } = render(
      <>
        <CodeBlockStep {...props} resetTrigger={0} />
        <Probe stepId="cb-1" sectionId="sec-1" />
      </>
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('stored');

    rerender(
      <>
        <CodeBlockStep {...props} resetTrigger={1} />
        <Probe stepId="cb-1" sectionId="sec-1" />
      </>
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('stored');
  });

  it('clears its own entry when standalone, since no section owns the write', () => {
    markStepCompleted('cb-2', undefined, 'manual');
    const props = { code: 'query_range(up)', refTarget: '#editor', stepId: 'cb-2' };

    const { rerender } = render(
      <>
        <CodeBlockStep {...props} resetTrigger={0} />
        <Probe stepId="cb-2" sectionId={STANDALONE_SECTION_ID} />
      </>
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('stored');

    rerender(
      <>
        <CodeBlockStep {...props} resetTrigger={1} />
        <Probe stepId="cb-2" sectionId={STANDALONE_SECTION_ID} />
      </>
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('cleared');
  });
});
