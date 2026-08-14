/** Stubs shared by the data-check suites, pulled in from `jest.mock` factories. */

import React from 'react';

export const grafanaUiStub = {
  Alert: ({ title, children }: any) => (
    <div role="alert">
      {title}
      {children}
    </div>
  ),
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Combobox: ({ options, value, onChange, placeholder, isClearable: _isClearable, ...rest }: any) => (
    <select
      aria-label={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? { value: e.target.value } : null)}
      {...rest}
    >
      <option value="">{placeholder}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Field: ({ children }: any) => <div>{children}</div>,
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
  useStyles2: () => new Proxy({}, { get: (_target: unknown, key: string) => key }),
};

export const loggerStub = {
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
};

export const analyticsStub = {
  reportAppInteraction: jest.fn(),
  buildInteractiveStepProperties: (
    baseProperties: Record<string, string | number | boolean>,
    stepContext: Record<string, unknown>
  ) => ({ ...baseProperties, step_id: stepContext.stepId }),
  UserInteraction: {
    DataCheckRun: 'data_check_run',
    DataCheckPassed: 'data_check_passed',
    DataCheckFailed: 'data_check_failed',
    DataCheckSkipped: 'data_check_skipped',
    InputBlockSubmit: 'input_block_submit',
  },
};

export const DATASOURCE_LIST = [
  { uid: 'prom-1', name: 'Prometheus', type: 'prometheus' },
  { uid: 'prom-2', name: 'Prometheus staging', type: 'prometheus' },
  { uid: 'loki-1', name: 'Loki', type: 'loki' },
  { uid: 'mysql-1', name: 'Reporting', type: 'mysql' },
];
