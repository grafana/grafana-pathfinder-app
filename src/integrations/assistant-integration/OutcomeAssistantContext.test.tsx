import React from 'react';
import { render } from '@testing-library/react';
import { createAssistantContextItem, providePageContext } from '@grafana/assistant';
import {
  buildOutcomeAssistantContext,
  OutcomeAssistantContext,
  type OutcomeAssistantContextProps,
} from './OutcomeAssistantContext';

jest.mock('@grafana/assistant', () => ({
  createAssistantContextItem: jest.fn((_type, data) => data),
  providePageContext: jest.fn(),
}));
const props: OutcomeAssistantContextProps = {
  guideRevision: 'revision',
  outcome: { id: 'saved', label: 'Saved dashboard', kind: 'dashboard-saved' },
  resourceUid: 'dashboard-uid',
  checking: false,
  result: null,
};

beforeEach(() => jest.clearAllMocks());

it('bounds data and omits raw conditions, errors, and undeclared fields', () => {
  const data = buildOutcomeAssistantContext({
    ...props,
    outcome: { ...props.outcome, label: 'a'.repeat(1000) + String.fromCharCode(0) },
    resourceUid: 'b'.repeat(1000),
    result: { requirement: 'secret-command', error: 'secret-token', pass: false, verdict: 'unavailable' },
  });
  expect(data.outcome.label).toHaveLength(160);
  expect(data.resource?.uid).toHaveLength(128);
  expect(JSON.stringify(data)).not.toContain('secret');
  expect(data.failedCheck).toEqual({ check: 'dashboard-saved', verdict: 'unavailable', retryable: true });
});

it('keeps historical evidence separate and rejects boolean-only or contradictory success', () => {
  expect(buildOutcomeAssistantContext({ ...props, lastVerifiedAt: 1000 })).toMatchObject({
    status: 'not-checked',
    lastVerifiedAt: 1000,
  });
  for (const result of [
    { requirement: 'manual', pass: true },
    { requirement: 'saved', pass: false, verdict: 'satisfied' as const },
  ]) {
    expect(buildOutcomeAssistantContext({ ...props, result }).status).toBe('invalid');
  }
  expect(
    buildOutcomeAssistantContext({
      ...props,
      result: { requirement: 'saved', pass: true, verdict: 'satisfied' },
    }).status
  ).toBe('satisfied');
});

it('replaces context on selection and guide revision changes, then clears on unmount', () => {
  const registrations: jest.Mock[] = [];
  jest.mocked(providePageContext).mockImplementation(() => {
    const unregister = jest.fn();
    registrations.push(unregister);
    return Object.assign(jest.fn(), { unregister });
  });
  const { rerender, unmount } = render(<OutcomeAssistantContext {...props} />);
  expect(createAssistantContextItem).toHaveBeenLastCalledWith('structured', {
    data: expect.objectContaining({
      status: 'not-checked',
      resource: { uid: 'dashboard-uid', kind: 'dashboard-saved' },
    }),
  });
  rerender(<OutcomeAssistantContext {...props} resourceUid="other" checking />);
  expect(registrations[0]).toHaveBeenCalledTimes(1);
  expect(createAssistantContextItem).toHaveBeenLastCalledWith('structured', {
    data: expect.objectContaining({ status: 'checking', resource: { uid: 'other', kind: 'dashboard-saved' } }),
  });
  rerender(<OutcomeAssistantContext {...props} guideRevision="new-revision" />);
  expect(registrations[1]).toHaveBeenCalledTimes(1);
  unmount();
  expect(registrations[2]).toHaveBeenCalledTimes(1);
});
