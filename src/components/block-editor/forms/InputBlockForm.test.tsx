import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { InputBlockForm } from './InputBlockForm';
import { JsonInputBlockSchema } from '../../../types/json-guide.schema';
import type { JsonBlock } from '../types';

function renderForm(onSubmit: (block: JsonBlock) => void = jest.fn()) {
  render(<InputBlockForm onSubmit={onSubmit} onCancel={jest.fn()} />);
  return {
    promptInput: screen.getByPlaceholderText('e.g., What is the name of your Prometheus data source?'),
    variableNameInput: screen.getByPlaceholderText('e.g., prometheusDataSource'),
    submitButton: screen.getByRole('button', { name: 'Add block' }),
  };
}

describe('InputBlockForm', () => {
  it('keeps submit disabled until required fields are filled', () => {
    const { promptInput, variableNameInput, submitButton } = renderForm();

    expect(submitButton).toBeDisabled();

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(variableNameInput, { target: { value: 'datasourceName' } });
    expect(submitButton).toBeEnabled();
  });

  it('rejects invalid variable names before submit', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    fireEvent.change(variableNameInput, { target: { value: '123bad' } });

    expect(
      screen.getByText('Must start with letter/underscore, contain only letters, numbers, underscores')
    ).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects an invalid regex pattern before submit', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);
    const patternInput = screen.getByPlaceholderText('e.g., ^[a-z][a-z0-9-]*$');

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    fireEvent.change(variableNameInput, { target: { value: 'datasourceName' } });
    fireEvent.change(patternInput, { target: { value: '[unclosed' } });
    fireEvent.blur(patternInput);

    expect(screen.getByText('Invalid regex pattern')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not block submit when switching away from text with an invalid pattern', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);
    const patternInput = screen.getByPlaceholderText('e.g., ^[a-z][a-z0-9-]*$');

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    fireEvent.change(variableNameInput, { target: { value: 'datasourceName' } });
    fireEvent.change(patternInput, { target: { value: '[unclosed' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Checkbox' }));

    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'input',
      prompt: 'Enter a name',
      inputType: 'boolean',
      variableName: 'datasourceName',
    });
  });

  it('surfaces an inline error for an initially invalid pattern', () => {
    const onSubmit = jest.fn();
    render(
      <InputBlockForm
        initialData={{
          type: 'input',
          prompt: 'Enter a name',
          inputType: 'text',
          variableName: 'datasourceName',
          pattern: '[unclosed',
        }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        isEditing
      />
    );

    expect(screen.getByText('Invalid regex pattern')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update block' })).toBeDisabled();
  });

  it('submits trimmed required fields', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(promptInput, { target: { value: '  Enter a name  ' } });
    fireEvent.change(variableNameInput, { target: { value: '  datasourceName  ' } });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'input',
      prompt: 'Enter a name',
      inputType: 'text',
      variableName: 'datasourceName',
    });
  });

  describe('the datasource variant', () => {
    function renderDatasourceForm(onSubmit: (block: JsonBlock) => void = jest.fn()) {
      const form = renderForm(onSubmit);
      fireEvent.change(form.promptInput, { target: { value: 'Pick a data source' } });
      fireEvent.change(form.variableNameInput, { target: { value: 'metricsDatasource' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Datasource' }));
      return form;
    }

    const queryInput = () => screen.getByPlaceholderText('e.g., container_cpu_usage_seconds_total');

    it('submits a plain picker with no check fields', () => {
      const onSubmit = jest.fn();
      const { submitButton } = renderDatasourceForm(onSubmit);

      fireEvent.change(screen.getByPlaceholderText('e.g., prometheus, testdata'), {
        target: { value: 'prometheus' },
      });
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledWith({
        type: 'input',
        prompt: 'Pick a data source',
        inputType: 'datasource',
        variableName: 'metricsDatasource',
        datasourceFilter: 'prometheus',
      });
    });

    it('reveals the rest of the check only once a query is entered', () => {
      renderDatasourceForm();
      expect(screen.queryByRole('checkbox', { name: /holds the section up/i })).not.toBeInTheDocument();

      fireEvent.change(queryInput(), { target: { value: 'up' } });
      expect(screen.getByRole('checkbox', { name: /holds the section up/i })).toBeInTheDocument();
    });

    it('submits the full check surface', () => {
      const onSubmit = jest.fn();
      const { submitButton } = renderDatasourceForm(onSubmit);

      fireEvent.change(queryInput(), { target: { value: '  up  ' } });
      fireEvent.change(screen.getByPlaceholderText(/No container metrics here/i), {
        target: { value: 'Nothing here.' },
      });
      fireEvent.change(screen.getByPlaceholderText('e.g., now-6h'), { target: { value: 'now-6h' } });
      fireEvent.change(screen.getByPlaceholderText('e.g., now'), { target: { value: 'now' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /holds the section up/i }));
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledWith({
        type: 'input',
        id: 'check-metricsdatasource',
        prompt: 'Pick a data source',
        inputType: 'datasource',
        variableName: 'metricsDatasource',
        dataCheckQuery: 'up',
        dataCheckFailureMessage: 'Nothing here.',
        dataCheckTimeFrom: 'now-6h',
        dataCheckTimeTo: 'now',
        dataCheckBlocking: true,
      });
    });

    // The form has no id field, so nothing else would supply one — and a
    // blocking check the editor cannot produce validly is a dead authoring path.
    it('emits a blocking check the schema accepts', () => {
      const onSubmit = jest.fn();
      const { submitButton } = renderDatasourceForm(onSubmit);

      fireEvent.change(queryInput(), { target: { value: 'up' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /holds the section up/i }));
      fireEvent.click(submitButton);

      const result = JsonInputBlockSchema.safeParse(onSubmit.mock.calls[0]![0]);
      expect(result.success).toBe(true);
    });

    it('leaves an advisory check without an id, since it stores no completion', () => {
      const onSubmit = jest.fn();
      const { submitButton } = renderDatasourceForm(onSubmit);

      fireEvent.change(queryInput(), { target: { value: 'up' } });
      fireEvent.click(submitButton);

      expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('id');
      expect(JsonInputBlockSchema.safeParse(onSubmit.mock.calls[0]![0]).success).toBe(true);
    });

    it("keeps the guide's own id on an edit rather than deriving a new one", () => {
      const onSubmit = jest.fn();
      render(
        <InputBlockForm
          initialData={{
            type: 'input',
            id: 'check-authored-by-hand',
            prompt: 'Pick a data source',
            inputType: 'datasource',
            variableName: 'metricsDatasource',
            dataCheckQuery: 'up',
            dataCheckBlocking: true,
          }}
          onSubmit={onSubmit}
          onCancel={jest.fn()}
          isEditing
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Update block' }));

      expect(onSubmit.mock.calls[0]![0]).toMatchObject({ id: 'check-authored-by-hand' });
    });

    it('drops the check fields when the query is cleared, which the schema would reject', () => {
      const onSubmit = jest.fn();
      const { submitButton } = renderDatasourceForm(onSubmit);

      fireEvent.change(queryInput(), { target: { value: 'up' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /holds the section up/i }));
      fireEvent.change(queryInput(), { target: { value: '' } });
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledWith({
        type: 'input',
        prompt: 'Pick a data source',
        inputType: 'datasource',
        variableName: 'metricsDatasource',
      });
    });

    it('drops the check fields when the author switches back to a text input', () => {
      const onSubmit = jest.fn();
      const { submitButton } = renderDatasourceForm(onSubmit);

      fireEvent.change(queryInput(), { target: { value: 'up' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledWith({
        type: 'input',
        prompt: 'Pick a data source',
        inputType: 'text',
        variableName: 'metricsDatasource',
      });
    });

    it('round-trips an existing check when editing', () => {
      const onSubmit = jest.fn();
      render(
        <InputBlockForm
          initialData={{
            type: 'input',
            prompt: 'Pick a data source',
            inputType: 'datasource',
            variableName: 'metricsDatasource',
            dataCheckQuery: 'up',
            dataCheckFailureMessage: 'Nothing here.',
            dataCheckBlocking: true,
          }}
          onSubmit={onSubmit}
          onCancel={jest.fn()}
          isEditing
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Update block' }));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          dataCheckQuery: 'up',
          dataCheckFailureMessage: 'Nothing here.',
          dataCheckBlocking: true,
        })
      );
    });
  });
});
