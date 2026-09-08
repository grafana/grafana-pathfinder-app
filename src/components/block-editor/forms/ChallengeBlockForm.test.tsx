/**
 * Tests for ChallengeBlockForm — focuses on behaviour that's specific to the
 * challenge editor (dynamic Combobox pickers, per-row hint UI, submit
 * serialisation, repositioned failure-message field).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getBackendSrv } from '@grafana/runtime';

import { ChallengeBlockForm } from './ChallengeBlockForm';
import { loadCodaCapabilities, useCodaTerminalGate } from '../../../integrations/coda/useCodaAvailability.hook';
import type { CodaCapabilities } from '../../../integrations/coda/coda-api';
import type { JsonChallengeBlock } from '../../../types/json-guide.types';
import type { JsonBlock } from '../types';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('../../../integrations/coda/useCodaAvailability.hook', () => ({
  useCodaTerminalGate: jest.fn(),
  loadCodaCapabilities: jest.fn(),
}));

const mockedGetBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;
const mockedUseCodaTerminalGate = useCodaTerminalGate as jest.MockedFunction<typeof useCodaTerminalGate>;
const mockedLoadCodaCapabilities = loadCodaCapabilities as jest.MockedFunction<typeof loadCodaCapabilities>;

/**
 * Both catalogues ride on `/v1/capabilities`, which the SDK already fetches
 * once per page load, so the form has no catalogue request of its own to mock.
 */
function codaCapabilities(): CodaCapabilities {
  return {
    registered: true,
    templates: [],
    sampleApps: [
      { id: 'linux-node', name: 'Linux Node', description: 'Node exporter + Alloy', status: 'validated' },
      { id: 'nginx', name: 'Nginx', description: 'Nginx + exporter + Alloy', status: 'validated' },
    ],
    alloyScenarios: [
      { id: 'broken-scrape', name: 'Broken scrape', description: 'Misconfigured Alloy', status: 'experimental' },
    ],
    limits: { maxVMsPerUser: 3, maxExecTimeoutMs: 120_000, maxOutputBytes: 32_768 },
  };
}

function renderForm(initial?: Partial<JsonChallengeBlock>, onSubmit: (b: JsonBlock) => void = jest.fn()) {
  const initialData: JsonChallengeBlock | undefined = initial
    ? ({
        type: 'challenge',
        title: 'Test challenge',
        brief: 'Brief text',
        successCriteria: 'coda-exit-zero:true',
        ...initial,
      } as JsonChallengeBlock)
    : undefined;
  return render(
    <ChallengeBlockForm initialData={initialData} onSubmit={onSubmit} onCancel={jest.fn()} isEditing={!!initialData} />
  );
}

// Grafana's Combobox uses a <canvas> 2d context to size options by measuring
// text width. jsdom's HTMLCanvasElement.getContext returns nothing useful, so
// we stub the methods Combobox actually calls. Local-only — the project-wide
// polyfill (.config/jest-env-polyfill.js) intentionally stays minimal.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: () => ({ width: 0 }),
    font: '',
  })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetBackendSrv.mockReturnValue({ fetch: jest.fn() } as unknown as ReturnType<typeof getBackendSrv>);
  mockedLoadCodaCapabilities.mockResolvedValue(codaCapabilities());
  mockedUseCodaTerminalGate.mockReturnValue('configured');
});

describe('ChallengeBlockForm', () => {
  describe('basic rendering', () => {
    it('renders the section headers and required fields (Coda mode shows all three)', () => {
      // Render in Coda mode to see all three sections — Environment is
      // mode-conditional and only appears for Coda challenges.
      renderForm({ mode: 'coda', vmTemplate: 'vm-aws' });
      expect(screen.getByText('Challenge content')).toBeInTheDocument();
      expect(screen.getByText('Environment')).toBeInTheDocument();
      expect(screen.getByText('Verification')).toBeInTheDocument();
      // Match labels exactly with the optional " *" required suffix and
      // nothing else, so we don't collide with the test's seeded textarea
      // values like "Brief text" / "Test challenge".
      expect(screen.getByText(/^Title \*$/)).toBeInTheDocument();
      expect(screen.getByText(/^Brief \*$/)).toBeInTheDocument();
      expect(screen.getByText(/^Success check \*$/)).toBeInTheDocument();
    });

    it('uses the new label for the failure-message field', () => {
      renderForm();
      expect(screen.getByText('Message shown when Check my work fails')).toBeInTheDocument();
    });
  });

  describe('dynamic pickers', () => {
    it('reads sample apps from capabilities when template is vm-aws-sample-app', async () => {
      renderForm({ vmTemplate: 'vm-aws-sample-app' });
      expect(mockedLoadCodaCapabilities).toHaveBeenCalled();
      await waitFor(() => expect(screen.getByPlaceholderText('Select a sample app...')).toBeInTheDocument());
    });

    it('reads Alloy scenarios from capabilities when template is vm-aws-alloy-scenario', async () => {
      renderForm({ vmTemplate: 'vm-aws-alloy-scenario' });
      expect(mockedLoadCodaCapabilities).toHaveBeenCalled();
      await waitFor(() => expect(screen.getByPlaceholderText('Select a scenario...')).toBeInTheDocument());
    });

    // Issue #1539: a hand-rolled fetch let Grafana's global handler read a Coda
    // 401 as the caller's own session expiring and fire a spurious
    // /api/login/ping plus a replayed request. The SDK's own request sets both
    // `retry: 1` and `showErrorAlert: false`, so the guard is that the form
    // never issues a catalogue request itself.
    it('issues no catalogue request of its own', () => {
      renderForm({ vmTemplate: 'vm-aws-sample-app' });
      expect(mockedGetBackendSrv).not.toHaveBeenCalled();
    });

    // The template list itself now comes from capabilities.templates, since a
    // hardcoded list cannot show a template the provider added and goes on
    // offering ones it removed. loadCodaCapabilities is cached per page load, so
    // this is one request whichever pickers a form happens to show.
    it('reads the template list from capabilities even with no template chosen', () => {
      renderForm(); // no vmTemplate → defaults to ''
      expect(mockedLoadCodaCapabilities).toHaveBeenCalled();
    });

    it('keeps an authored template in the list when the backend no longer offers it', async () => {
      renderForm({ vmTemplate: 'vm-aws-retired' });
      await waitFor(() => expect(screen.getByDisplayValue('vm-aws-retired')).toBeInTheDocument());
    });

    it('tells the author to type an id when Coda cannot be reached', async () => {
      mockedLoadCodaCapabilities.mockResolvedValue(null);
      renderForm({ vmTemplate: 'vm-aws-sample-app' });
      await waitFor(() => expect(screen.getByPlaceholderText('Coda unavailable — type an app id')).toBeInTheDocument());
    });
  });

  describe('hint rows', () => {
    it('Add hint creates a new editable row', () => {
      renderForm();
      // Initially no hints.
      expect(screen.queryByLabelText(/hint 1 text/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /add hint/i }));
      expect(screen.getByLabelText(/hint 1 text/i)).toBeInTheDocument();
    });

    it('reorders hints when arrow buttons are clicked', () => {
      renderForm({ hintLevels: [{ text: 'First hint' }, { text: 'Second hint' }, { text: 'Third hint' }] });

      // Move "Second hint" up.
      fireEvent.click(screen.getByRole('button', { name: /move hint 2 up/i }));

      // The inputs are unlabeled by index after reorder, so re-query by value:
      const inputs = screen.getAllByRole('textbox').filter((el) => (el as HTMLInputElement).value.endsWith(' hint'));
      const values = inputs.map((el) => (el as HTMLInputElement).value);
      expect(values).toEqual(['Second hint', 'First hint', 'Third hint']);
    });

    it('removes a hint when the trash button is clicked', () => {
      renderForm({ hintLevels: [{ text: 'A' }, { text: 'B' }] });
      fireEvent.click(screen.getByRole('button', { name: /remove hint 1/i }));

      // Only "B" should remain; "A" input is gone.
      const inputs = screen.getAllByRole('textbox').filter((el) => ['A', 'B'].includes((el as HTMLInputElement).value));
      expect(inputs.map((el) => (el as HTMLInputElement).value)).toEqual(['B']);
    });

    it('disables move-up on the first hint and move-down on the last', () => {
      renderForm({ hintLevels: [{ text: 'A' }, { text: 'B' }] });
      expect(screen.getByRole('button', { name: /move hint 1 up/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /move hint 2 down/i })).toBeDisabled();
      // The interior moves are enabled.
      expect(screen.getByRole('button', { name: /move hint 1 down/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /move hint 2 up/i })).not.toBeDisabled();
    });
  });

  describe('setup migration', () => {
    it('seeds the setup-script field from legacy setupCommands joined on newlines', () => {
      renderForm({ setupCommands: ['echo one', 'echo two'] });
      // The script TextArea takes the joined value.
      const scriptTextarea = screen.getByPlaceholderText(/sudo systemctl stop alloy/i) as HTMLTextAreaElement;
      expect(scriptTextarea.value).toBe('echo one\necho two');
    });

    it('emits setupScript on submit and drops setupCommands entirely', () => {
      const onSubmit = jest.fn();
      renderForm({ setupCommands: ['echo legacy'] }, onSubmit);
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
      expect(submitted.setupScript).toBe('echo legacy');
      expect(submitted.setupCommands).toBeUndefined();
    });

    it('preserves an existing setupScript over setupCommands when both are present', () => {
      const onSubmit = jest.fn();
      renderForm({ setupScript: 'echo from-script', setupCommands: ['echo from-array'] }, onSubmit);
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
      expect(submitted.setupScript).toBe('echo from-script');
      expect(submitted.setupCommands).toBeUndefined();
    });

    it('omits setupScript entirely when the field is empty', () => {
      const onSubmit = jest.fn();
      renderForm({ setupCommands: ['x'] }, onSubmit);

      // Clear the script field.
      const scriptTextarea = screen.getByPlaceholderText(/sudo systemctl stop alloy/i);
      fireEvent.change(scriptTextarea, { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: /update block/i }));
      const submitted = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
      expect(submitted.setupScript).toBeUndefined();
      expect(submitted.setupCommands).toBeUndefined();
    });
  });

  describe('success check field', () => {
    it('seeds the field by stripping the coda-exit-zero prefix', () => {
      renderForm({ successCriteria: 'coda-exit-zero:test -f /etc/foo' });
      const textbox = screen.getByPlaceholderText(/curl -sf "localhost:9090/) as HTMLTextAreaElement;
      expect(textbox.value).toBe('test -f /etc/foo');
    });

    it('re-attaches the prefix on submit', () => {
      const onSubmit = jest.fn();
      renderForm({ successCriteria: 'coda-exit-zero:original' }, onSubmit);
      const textbox = screen.getByPlaceholderText(/curl -sf "localhost:9090/);
      fireEvent.change(textbox, { target: { value: 'pgrep -x nginx' } });
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
      expect(submitted.successCriteria).toBe('coda-exit-zero:pgrep -x nginx');
    });

    it('silently strips the prefix when the user pastes a fully-prefixed value', () => {
      const onSubmit = jest.fn();
      renderForm({ successCriteria: 'coda-exit-zero:placeholder' }, onSubmit);
      const textbox = screen.getByPlaceholderText(/curl -sf "localhost:9090/) as HTMLTextAreaElement;

      // Simulate paste of a string that still contains the prefix.
      fireEvent.change(textbox, { target: { value: 'coda-exit-zero:test -f /pasted' } });
      // After the onChange handler, the stored value should be bare.
      expect(textbox.value).toBe('test -f /pasted');

      fireEvent.click(screen.getByRole('button', { name: /update block/i }));
      const submitted = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
      // Submit re-attaches; we never end up with a doubled prefix.
      expect(submitted.successCriteria).toBe('coda-exit-zero:test -f /pasted');
    });

    it('shows a warning when the success check contains a comma', () => {
      renderForm({ successCriteria: 'coda-exit-zero:placeholder' });
      const textbox = screen.getByPlaceholderText(/curl -sf "localhost:9090/);

      // No warning initially.
      expect(screen.queryByText(/requirement separators/i)).not.toBeInTheDocument();

      fireEvent.change(textbox, { target: { value: 'awk -F, "{ print $1 }" /tmp/x' } });
      expect(screen.getByText(/requirement separators/i)).toBeInTheDocument();
    });
  });

  describe('submit serialisation', () => {
    it('preserves unrendered challenge fields during an ordinary edit', () => {
      const onSubmit = jest.fn();
      renderForm(
        {
          mode: 'standard',
          id: 'published-challenge-step',
          requirements: ['has-datasource:prometheus'],
          objectives: ['Create a dashboard'],
          skippable: false,
          authorNote: 'Keep the verification aligned with the tutorial.',
        },
        onSubmit
      );

      fireEvent.change(screen.getByDisplayValue('Test challenge'), { target: { value: 'Edited challenge' } });
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Edited challenge',
          id: 'published-challenge-step',
          requirements: ['has-datasource:prometheus'],
          objectives: ['Create a dashboard'],
          skippable: false,
          authorNote: 'Keep the verification aligned with the tutorial.',
        })
      );
    });

    it('serialises hints in the displayed order with empty rows filtered out', () => {
      const onSubmit = jest.fn();
      renderForm(
        {
          hintLevels: [{ text: 'Keep me' }, { text: '' }, { text: 'Me too' }],
        },
        onSubmit
      );
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const submitted = onSubmit.mock.calls[0]![0] as JsonChallengeBlock;
      expect(submitted.hintLevels).toEqual([{ text: 'Keep me' }, { text: 'Me too' }]);
    });

    it('omits hintLevels entirely when all rows are empty', () => {
      const onSubmit = jest.fn();
      renderForm({ hintLevels: [{ text: '' }] }, onSubmit);
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as JsonChallengeBlock;
      expect(submitted.hintLevels).toBeUndefined();
    });

    it('does not restore optional form fields after the author clears them', () => {
      const onSubmit = jest.fn();
      renderForm(
        {
          setupScript: 'echo setup',
          hintLevels: [{ text: 'Original hint' }],
          failureMessage: 'Original failure message',
        },
        onSubmit
      );

      fireEvent.change(screen.getByPlaceholderText(/sudo systemctl stop alloy/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /remove hint 1/i }));
      fireEvent.change(screen.getByDisplayValue('Original failure message'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as JsonChallengeBlock;
      expect(submitted.setupScript).toBeUndefined();
      expect(submitted.hintLevels).toBeUndefined();
      expect(submitted.failureMessage).toBeUndefined();
    });
  });

  describe('mode selector', () => {
    it('renders both mode options', () => {
      renderForm();
      expect(screen.getByRole('radio', { name: /^Standard$/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^Coda VM$/ })).toBeInTheDocument();
    });

    it('infers Coda mode when the initial block has a vmTemplate', () => {
      renderForm({ vmTemplate: 'vm-aws-sample-app' });
      const codaRadio = screen.getByRole('radio', { name: /^Coda VM$/ });
      expect(codaRadio).toBeChecked();
    });

    it('infers Coda mode when the initial block has a setupScript', () => {
      renderForm({ setupScript: 'echo hi' });
      expect(screen.getByRole('radio', { name: /^Coda VM$/ })).toBeChecked();
    });

    it('defaults a brand-new block to Standard mode', () => {
      // No initial block at all — fresh creation flow.
      render(<ChallengeBlockForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
      expect(screen.getByRole('radio', { name: /^Standard$/ })).toBeChecked();
    });

    it('hides the Environment section in Standard mode', () => {
      // Brand-new block → Standard by default.
      render(<ChallengeBlockForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
      expect(screen.queryByText('Environment')).not.toBeInTheDocument();
    });

    it('shows the Environment section after switching to Coda mode', () => {
      render(<ChallengeBlockForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
      // Initially Standard, no Environment section.
      expect(screen.queryByText('Environment')).not.toBeInTheDocument();
      // Switch to Coda mode.
      fireEvent.click(screen.getByRole('radio', { name: /^Coda VM$/ }));
      expect(screen.getByText('Environment')).toBeInTheDocument();
    });
  });

  describe('standard-mode success criterion', () => {
    it('does NOT strip a coda-exit-zero prefix when seeding from a standard-mode block', () => {
      // Author has hand-written a "coda-exit-zero:..." string in standard
      // mode (unusual but supported as a literal requirement). The
      // ConditionChipsField should render it verbatim as a single chip.
      renderForm({ mode: 'standard', successCriteria: 'coda-exit-zero:still-shows-verbatim' });
      // The chip's text is rendered as a span inside the chips row.
      expect(screen.getByText('coda-exit-zero:still-shows-verbatim')).toBeInTheDocument();
    });

    it('emits the literal successCriteria on submit, without prepending coda-exit-zero', () => {
      const onSubmit = jest.fn();
      renderForm({ mode: 'standard', successCriteria: 'has-dashboard-named:My First Dashboard' }, onSubmit);
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as JsonChallengeBlock;
      expect(submitted.successCriteria).toBe('has-dashboard-named:My First Dashboard');
      expect(submitted.mode).toBe('standard');
    });

    it('renders the success check as a ConditionChipsField with existing chips', () => {
      // Use a value that doesn't collide with the field description's code
      // examples (`has-dashboard-named:My Dashboard` appears there).
      renderForm({ mode: 'standard', successCriteria: 'has-dashboard-named:Sales metrics' });
      // The "Add condition" affordance from ConditionChipsField is what
      // visually distinguishes this from the bash TextArea used in Coda mode.
      expect(screen.getByRole('button', { name: /Add condition/i })).toBeInTheDocument();
      expect(screen.getByText('has-dashboard-named:Sales metrics')).toBeInTheDocument();
    });

    it('emits the comma-separated chip list verbatim on submit (multi-requirement supported)', () => {
      const onSubmit = jest.fn();
      // Seed with two pre-existing chips to verify multi-chip pass-through.
      renderForm({ mode: 'standard', successCriteria: 'has-dashboard-named:Foo, has-datasource:prometheus' }, onSubmit);
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as JsonChallengeBlock;
      expect(submitted.successCriteria).toBe('has-dashboard-named:Foo, has-datasource:prometheus');
    });

    it('drops Coda-only fields from submitted output even if state has them', () => {
      const onSubmit = jest.fn();
      // Block originally Coda — has all the Coda fields.
      renderForm(
        {
          mode: 'coda',
          id: 'published-challenge-step',
          vmTemplate: 'vm-aws-sample-app',
          vmScenario: 'legacy-scenario',
          vmApp: 'nginx',
          setupCommands: ['echo legacy'],
          setupScript: 'echo setup',
          successCriteria: 'coda-exit-zero:true',
          requirements: ['has-datasource:prometheus'],
          objectives: ['Create a dashboard'],
          skippable: true,
          authorNote: 'Keep this note.',
        },
        onSubmit
      );

      // Switch to Standard mode.
      fireEvent.click(screen.getByRole('radio', { name: /^Standard$/ }));
      fireEvent.click(screen.getByRole('button', { name: /update block/i }));

      const submitted = onSubmit.mock.calls[0]![0] as JsonChallengeBlock;
      expect(submitted.mode).toBe('standard');
      expect(submitted.id).toBe('published-challenge-step');
      expect(submitted.requirements).toEqual(['has-datasource:prometheus']);
      expect(submitted.objectives).toEqual(['Create a dashboard']);
      expect(submitted.skippable).toBe(true);
      expect(submitted.authorNote).toBe('Keep this note.');
      expect(submitted.vmTemplate).toBeUndefined();
      expect(submitted.vmScenario).toBeUndefined();
      expect(submitted.vmApp).toBeUndefined();
      expect(submitted).not.toHaveProperty('setupCommands');
      expect(submitted.setupScript).toBeUndefined();
    });
  });

  // Issue #1541: an author whose own stack cannot run Coda needs to know their
  // preview will not start. Annotated rather than disabled — a guide is often
  // authored on a stack without Coda for learners on a stack with it.
  describe('Coda availability annotation', () => {
    it('warns in the mode description when Coda cannot run here', () => {
      mockedUseCodaTerminalGate.mockReturnValue('plugin-missing');
      renderForm({ mode: 'coda' } as Partial<JsonChallengeBlock>);

      expect(screen.getByText(/this grafana cannot run coda challenges/i)).toBeInTheDocument();
    });

    it('keeps the Coda VM option selectable so cross-stack authoring still works', () => {
      mockedUseCodaTerminalGate.mockReturnValue('disabled');
      renderForm({ mode: 'standard' } as Partial<JsonChallengeBlock>);

      const codaRadio = screen.getByRole('radio', { name: /coda vm/i });
      expect(codaRadio).not.toBeDisabled();
    });

    it('says nothing when Coda is configured', () => {
      renderForm({ mode: 'coda' } as Partial<JsonChallengeBlock>);

      expect(screen.queryByText(/this grafana cannot run coda challenges/i)).not.toBeInTheDocument();
    });
  });
});
