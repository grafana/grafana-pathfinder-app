import { CLOUD_TOKEN_OBJECTIVE, inferWorkflowObjectives } from './workflow-objectives';

const page = 'on-page:/a/grafana-collector-app/alloy';
const actions = [
  { targetAction: 'formfill', refTarget: '#tokenName', requirements: [page] },
  { targetAction: 'button', refTarget: 'Create token', requirements: [page] },
];

it('recognizes the shared token workflow without a guide id or app-specific route', () => {
  expect(inferWorkflowObjectives(actions)).toEqual([page, CLOUD_TOKEN_OBJECTIVE]);
  expect(
    inferWorkflowObjectives(actions.map((action) => ({ ...action, requirements: ['on-page:/a/another-app/setup'] })))
  ).toEqual(['on-page:/a/another-app/setup', CLOUD_TOKEN_OBJECTIVE]);
});

it('leaves unrelated, mixed, ambiguous, and explicitly named workflows alone', () => {
  expect(inferWorkflowObjectives([actions[1]!])).toBeUndefined();
  expect(inferWorkflowObjectives([actions[0]!])).toBeUndefined();
  expect(inferWorkflowObjectives([...actions, { targetAction: 'button', refTarget: 'Install' }])).toBeUndefined();
  expect(inferWorkflowObjectives([{ ...actions[0], targetValue: 'specific-token' }, actions[1]!])).toBeUndefined();
  expect(inferWorkflowObjectives(actions, ['on-page:/a/other-app'])).toBeUndefined();
  expect(inferWorkflowObjectives(actions.map(({ requirements, ...action }) => action))).toBeUndefined();
});

it('recognizes a standalone submit only with the shared component selector and a page scope', () => {
  expect(
    inferWorkflowObjectives(
      [{ targetAction: 'button', refTarget: '[data-testid="generate-token-submit-button"]' }],
      [page]
    )
  ).toEqual([page, CLOUD_TOKEN_OBJECTIVE]);
});
