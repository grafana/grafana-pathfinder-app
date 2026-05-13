/**
 * Tests for ChallengeBlockForm — focuses on behaviour that's specific to the
 * challenge editor (dynamic Combobox pickers, per-row hint UI, submit
 * serialisation, repositioned failure-message field).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { of } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';

import { ChallengeBlockForm } from './ChallengeBlockForm';
import type { JsonChallengeBlock } from '../../../types/json-guide.types';
import type { JsonBlock } from '../types';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockedGetBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;

/**
 * Wire the backendSrv so /sample-apps and /alloy-scenarios respond with a
 * deterministic catalog. Spies on the fetch call so individual tests can
 * assert it was hit with the right URL.
 */
function mockBackend(): jest.Mock {
  const fetch = jest.fn((opts: { url: string }) => {
    if (opts.url.endsWith('/sample-apps')) {
      return of({
        data: {
          apps: [
            { id: 'linux-node', name: 'Linux Node', description: 'Node exporter + Alloy', status: 'validated' },
            { id: 'nginx', name: 'Nginx', description: 'Nginx + exporter + Alloy', status: 'validated' },
          ],
        },
      });
    }
    if (opts.url.endsWith('/alloy-scenarios')) {
      return of({
        data: {
          scenarios: [
            { id: 'broken-scrape', name: 'Broken scrape', description: 'Misconfigured Alloy', status: 'available' },
          ],
        },
      });
    }
    return of({ data: {} });
  });
  mockedGetBackendSrv.mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
  return fetch;
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
  mockBackend();
});

describe('ChallengeBlockForm', () => {
  describe('basic rendering', () => {
    it('renders the three section headers and the required field labels', () => {
      renderForm();
      // Section headers (rendered as plain divs, not <label>s, so getByText is right).
      expect(screen.getByText('Challenge content')).toBeInTheDocument();
      expect(screen.getByText('Environment')).toBeInTheDocument();
      expect(screen.getByText('Verification')).toBeInTheDocument();
      // Field labels (Grafana <Field> renders the label as plain text inside
      // a <label>; required fields get a trailing " *" suffix so we use a
      // regex matcher).
      expect(screen.getByText(/^Title /)).toBeInTheDocument();
      expect(screen.getByText(/^Brief /)).toBeInTheDocument();
      expect(screen.getByText(/^Success criterion /)).toBeInTheDocument();
    });

    it('uses the new label for the failure-message field', () => {
      renderForm();
      expect(screen.getByText('Message shown when Check my work fails')).toBeInTheDocument();
    });
  });

  describe('dynamic pickers', () => {
    it('fetches /sample-apps when template is vm-aws-sample-app', () => {
      const fetch = mockBackend();
      renderForm({ vmTemplate: 'vm-aws-sample-app' });
      const sampleAppsCall = fetch.mock.calls.find((c) => c[0].url.endsWith('/sample-apps'));
      expect(sampleAppsCall).toBeDefined();
    });

    it('fetches /alloy-scenarios when template is vm-aws-alloy-scenario', () => {
      const fetch = mockBackend();
      renderForm({ vmTemplate: 'vm-aws-alloy-scenario' });
      const scenariosCall = fetch.mock.calls.find((c) => c[0].url.endsWith('/alloy-scenarios'));
      expect(scenariosCall).toBeDefined();
    });

    it('does NOT fetch either catalog for the default template', () => {
      const fetch = mockBackend();
      renderForm(); // no vmTemplate → defaults to ''
      const catalogCalls = fetch.mock.calls.filter(
        (c) => c[0].url.endsWith('/sample-apps') || c[0].url.endsWith('/alloy-scenarios')
      );
      expect(catalogCalls).toHaveLength(0);
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

  describe('submit serialisation', () => {
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
  });
});
