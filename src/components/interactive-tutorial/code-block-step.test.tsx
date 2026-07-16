import React from 'react';
import { render } from '@testing-library/react';
import { CodeBlockStep } from './code-block-step';

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
