import type { CloudChainTeardownContext, CloudChainTeardownTarget } from './cloud-chain-environment';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export class CloudChainCleanupRegistry {
  private readonly targets = new Set<CloudChainTeardownTarget>();

  track(target: CloudChainTeardownTarget): void {
    this.targets.add(target);
  }

  untrack(target: CloudChainTeardownTarget): void {
    this.targets.delete(target);
  }

  async teardownAll(context?: CloudChainTeardownContext): Promise<string[]> {
    const warnings: string[] = [];
    const targets = [...this.targets];
    for (const target of targets) {
      try {
        warnings.push(...(await target.teardownChain(context)));
      } catch (err) {
        warnings.push(`Failed to tear down active Cloud stack: ${errorMessage(err)}`);
      } finally {
        this.untrack(target);
      }
    }
    return warnings;
  }
}
