import { Command } from 'commander';

import { E2eCommand } from '../commands/e2e';
import { buildOptionForField } from '../contracts/commander-options';

function command(): Command {
  const cmd = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  cmd.addOption(buildOptionForField('allowCloudInstanceMutations', E2eCommand.shape.allowCloudInstanceMutations)!);
  cmd.addOption(buildOptionForField('cloudInstanceAdminToken', E2eCommand.shape.cloudInstanceAdminToken)!);
  return cmd;
}

describe('named mutation CLI options', () => {
  it('defaults to no permission and does not accept a boolean', () => {
    expect(E2eCommand.parse({}).allowCloudInstanceMutations).toEqual([]);
    expect(E2eCommand.safeParse({ allowCloudInstanceMutations: true }).success).toBe(false);
    expect(() => command().parse(['--allow-cloud-instance-mutations'], { from: 'user' })).toThrow(/argument missing/);
  });

  it('collects hostname-valued permission flags and multiple admin token hosts independently', () => {
    const cmd = command().parse(
      [
        '--allow-cloud-instance-mutations',
        'docs.example',
        '--cloud-instance-admin-token',
        'docs.example=DOCS_TOKEN',
        '--cloud-instance-admin-token',
        'other.example=OTHER_TOKEN',
        '--allow-cloud-instance-mutations',
        'other.example',
      ],
      { from: 'user' }
    );
    expect(cmd.opts()).toEqual({
      allowCloudInstanceMutations: ['docs.example', 'other.example'],
      cloudInstanceAdminToken: ['docs.example=DOCS_TOKEN', 'other.example=OTHER_TOKEN'],
    });
  });
});
