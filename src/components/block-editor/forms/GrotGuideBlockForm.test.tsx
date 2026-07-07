import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { GrotGuideBlockForm } from './GrotGuideBlockForm';
import type { JsonBlock } from '../../../types/json-guide.types';

function renderForm(onSubmit: (block: JsonBlock) => void = jest.fn()) {
  render(<GrotGuideBlockForm onSubmit={onSubmit} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import from YAML' }));
  return {
    yamlTextarea: screen.getByPlaceholderText(/welcome:/),
    importButton: screen.getByRole('button', { name: 'Import' }),
    submitButton: screen.getByRole('button', { name: 'Add block' }),
  };
}

function importYaml(yaml: string) {
  const { yamlTextarea, importButton } = renderForm();
  fireEvent.change(yamlTextarea, { target: { value: yaml } });
  fireEvent.click(importButton);
}

describe('GrotGuideBlockForm YAML import', () => {
  it('converts a multi-document YAML file, mapping snake_case fields and skipping unrelated leading documents', () => {
    const onSubmit = jest.fn();
    const { yamlTextarea, importButton, submitButton } = renderForm(onSubmit);

    const yaml = [
      '---',
      'unrelated: frontmatter document',
      '---',
      'welcome:',
      '  title: Hello',
      '  body: Welcome text',
      '  ctas:',
      '    - text: "Let\'s go!"',
      '      screen_id: first_question',
      'screens:',
      '  - type: question',
      '    id: first_question',
      '    title: What next?',
      '    options:',
      '      - text: Option A',
      '        screen_id: result_a',
      '  - type: result',
      '    id: result_a',
      '    title: Result A',
      '    body: Here you go',
      '    links:',
      '      - type: docs',
      '        title: Docs',
      '        link_text: Visit docs',
      '        href: https://grafana.com/docs/',
    ].join('\n');

    fireEvent.change(yamlTextarea, { target: { value: yaml } });
    fireEvent.click(importButton);

    expect(screen.queryByText(/YAML import error/)).not.toBeInTheDocument();

    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'grot-guide',
      welcome: {
        title: 'Hello',
        body: 'Welcome text',
        ctas: [{ text: "Let's go!", screenId: 'first_question' }],
      },
      screens: [
        {
          type: 'question',
          id: 'first_question',
          title: 'What next?',
          options: [{ text: 'Option A', screenId: 'result_a' }],
        },
        {
          type: 'result',
          id: 'result_a',
          title: 'Result A',
          body: 'Here you go',
          links: [{ type: 'docs', title: 'Docs', linkText: 'Visit docs', href: 'https://grafana.com/docs/' }],
        },
      ],
    });
  });

  it('surfaces an error when no document has a welcome or screens field', () => {
    importYaml(['unrelated:', '  field: value'].join('\n'));

    expect(screen.getByText('Invalid YAML: no document found with "welcome" or "screens" fields')).toBeInTheDocument();
  });

  it('surfaces an error when the welcome field is missing', () => {
    importYaml(['screens:', '  - type: result', '    id: a', '    title: A'].join('\n'));

    expect(screen.getByText('Missing "welcome" field in YAML')).toBeInTheDocument();
  });

  it('surfaces an error when the screens field is missing', () => {
    importYaml(['welcome:', '  title: Hi', '  ctas: []'].join('\n'));

    expect(screen.getByText('Missing or invalid "screens" field in YAML')).toBeInTheDocument();
  });

  it('surfaces an error for an unknown screen type', () => {
    importYaml(['welcome:', '  title: Hi', '  ctas: []', 'screens:', '  - type: bogus', '    id: a'].join('\n'));

    expect(screen.getByText('Unknown screen type: bogus')).toBeInTheDocument();
  });
});
