import * as codaClient from '@grafana/coda-client';

it('requires migrating the local URL adapter when the installed SDK exports its builder', () => {
  // When upgrading the SDK, replace the local URL builder with the exported one,
  // retaining Grafana's appSubUrl prefix and the IDE route, then remove this tripwire.
  expect(codaClient).not.toHaveProperty('codaWorkspaceUrl');
});
