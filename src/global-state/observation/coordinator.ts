import { nextRequiredAction, advanceActionProgress } from './action-progress';
import { conditionTokens } from '../../lib/condition-input';
import type { ConditionInput } from '../../types/requirements.types';

export interface ObservedAction {
  targetAction: string;
  refTarget?: string;
  targetValue?: string;
}

export type ObservationReason = 'objectives' | 'observed' | 'manual' | 'skipped';

export interface ObservationStep {
  id: string;
  stepId: string;
  sectionId?: string;
  actions: ObservedAction[];
  objectives?: ConditionInput;
  verify?: ConditionInput;
  eligible: boolean;
  executing: boolean;
  completed: boolean;
  readCompleted?(): Promise<boolean>;
  commit(reason: ObservationReason): void;
}

interface Entry {
  step: ObservationStep;
  cursor: number;
  requested?: ObservationReason;
  checkCommand?: boolean;
  committed: boolean;
  revision: number;
}

export type ObservationCheck = (
  conditions: ConditionInput,
  step: ObservationStep,
  signal: AbortSignal
) => Promise<boolean>;

function hasObjectives(input: ConditionInput | undefined): boolean {
  return Array.isArray(input) ? input.length > 0 : !!input;
}

export function isPassiveCondition(conditions: ConditionInput): boolean {
  return !conditionTokens(conditions).some((token) => token.startsWith('coda-exit-zero:'));
}

export class CompletionCoordinator {
  private dormant = new Map<string, { step: ObservationStep; cursor: number }>();
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private revision = 0;
  generation = 0;
  private running = false;
  private dirty = false;
  private active = false;
  private abortController = new AbortController();

  constructor(
    private check: ObservationCheck,
    private restoredCursors: Record<string, number> = {}
  ) {}

  restore(cursors: Record<string, number>) {
    this.restoredCursors = cursors;
    this.entries.forEach((entry, id) => {
      const cursor = cursors[id];
      if (cursor === undefined) {
        return;
      }
      entry.cursor = Math.min(cursor, entry.step.actions.length);
      if (entry.cursor > 0 && entry.cursor === entry.step.actions.length) {
        entry.requested = 'observed';
      }
      delete this.restoredCursors[id];
    });
    this.changed();
  }

  exportCursors() {
    return {
      ...Object.fromEntries([...this.dormant].map(([id, entry]) => [id, entry.cursor])),
      ...Object.fromEntries(
        [...this.entries]
          .filter(([, entry]) => !entry.committed && !entry.step.completed)
          .map(([id, entry]) => [id, entry.cursor])
      ),
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.revision;

  private changed() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }

  start() {
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
    this.active = true;
    this.recheck();
  }
  stop() {
    this.active = false;
    this.abortController.abort();
    this.entries.forEach((entry) => {
      entry.revision++;
    });
  }

  register(step: ObservationStep) {
    const previous = this.entries.get(step.id);
    const dormant = this.dormant.get(step.id);
    const previousCursor =
      dormant && JSON.stringify(dormant.step.actions) === JSON.stringify(step.actions) ? dormant.cursor : 0;
    const restored = Math.min(this.restoredCursors[step.id] ?? previousCursor, step.actions.length);
    this.dormant.delete(step.id);
    delete this.restoredCursors[step.id];
    const entry: Entry = previous ?? { step, cursor: restored, committed: false, revision: 0 };
    if (restored > 0 && restored === step.actions.length) {
      entry.requested = 'observed';
    }
    entry.step = step;
    this.entries.set(step.id, entry);
    this.changed();
    this.recheck();
    return () => {
      if (this.entries.get(step.id) === entry) {
        entry.revision++;
        this.entries.delete(step.id);
        this.dormant.set(step.id, { step: entry.step, cursor: entry.cursor });
        this.changed();
      }
    };
  }

  update(id: string, step: ObservationStep) {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    const recipeChanged = JSON.stringify(entry.step.actions) !== JSON.stringify(step.actions);
    const changed =
      entry.step.executing !== step.executing ||
      entry.step.completed !== step.completed ||
      entry.step.eligible !== step.eligible ||
      recipeChanged ||
      JSON.stringify(entry.step.verify) !== JSON.stringify(step.verify) ||
      JSON.stringify(entry.step.objectives) !== JSON.stringify(step.objectives);
    entry.step = step;
    if (recipeChanged) {
      entry.cursor = 0;
      entry.requested = undefined;
    }
    if (changed) {
      entry.revision++;
      this.changed();
      this.recheck();
    }
  }

  invalidate() {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.generation++;
    this.entries.forEach((entry) => {
      entry.revision++;
    });
    this.changed();
    this.recheck();
  }

  resetScope(stepId: string | undefined, sectionId: string | undefined) {
    this.dormant.forEach((entry, id) => {
      if (entry.step.sectionId === sectionId && (stepId === undefined || entry.step.stepId === stepId)) {
        this.dormant.delete(id);
      }
    });
    this.entries.forEach((entry, id) => {
      if (entry.step.sectionId === sectionId && (stepId === undefined || entry.step.stepId === stepId)) {
        this.reset(id);
      }
    });
  }

  reset(id?: string) {
    this.abortController.abort();
    this.abortController = new AbortController();
    if (id === undefined) {
      this.dormant.clear();
    } else {
      this.dormant.delete(id);
    }
    this.generation++;
    this.restoredCursors = {};
    this.entries.forEach((entry, key) => {
      if (id !== undefined && key !== id) {
        return;
      }
      entry.cursor = 0;
      entry.requested = undefined;
      entry.checkCommand = false;
      entry.committed = false;
      entry.revision++;
    });
    this.changed();
    this.recheck();
  }

  has(id: string) {
    return this.entries.has(id);
  }

  waitForCompletion(id: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const finish = (result: boolean) => {
        unsubscribe();
        signal.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = () => finish(false);
      const check = () => {
        const entry = this.entries.get(id);
        if (entry?.committed || entry?.step.completed) {
          finish(true);
        } else if (signal.aborted) {
          finish(false);
        }
      };
      unsubscribe = this.subscribe(check);
      signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }

  waiting(id: string) {
    const entry = this.entries.get(id);
    return !!entry?.requested && !entry.committed && !entry.step.completed;
  }

  cursor(id: string) {
    return this.entries.get(id)?.cursor ?? 0;
  }

  pendingActions() {
    return [...this.entries.values()]
      .filter(
        ({ step, committed }) =>
          !committed && !step.completed && step.eligible && !step.executing && !hasObjectives(step.objectives)
      )
      .map((entry) => ({ id: entry.step.id, actions: entry.step.actions, cursor: entry.cursor }));
  }

  observe(matches: (action: ObservedAction) => boolean) {
    if ([...this.entries.values()].some((entry) => entry.step.executing)) {
      return;
    }
    for (const entry of this.entries.values()) {
      const { step } = entry;
      if (entry.committed || step.completed || !step.eligible || step.executing || hasObjectives(step.objectives)) {
        continue;
      }
      const index = nextRequiredAction(step.actions, entry.cursor);
      const action = step.actions[index];
      if (!action || !matches(action)) {
        continue;
      }
      this.observeIndex(step.id, index);
      break;
    }
    this.recheck();
  }

  observeIndex(id: string, index: number) {
    if ([...this.entries.values()].some((entry) => entry.step.executing)) {
      return;
    }
    const entry = this.entries.get(id);
    if (!entry || entry.committed || entry.step.completed || !entry.step.eligible || entry.step.executing) {
      return;
    }
    const cursor = advanceActionProgress(entry.step.actions, entry.cursor, index);
    if (cursor === entry.cursor) {
      return;
    }
    entry.cursor = cursor;
    if (entry.cursor === entry.step.actions.length) {
      entry.requested = 'observed';
    }
    this.changed();
    this.recheck();
  }

  request(id: string, reason: ObservationReason = 'manual') {
    const entry = this.entries.get(id);
    if (!entry || entry.committed || entry.step.completed) {
      return;
    }
    if (reason === 'skipped') {
      this.commit(entry, reason);
      return;
    }
    if (!entry.requested) {
      entry.requested = reason;
      entry.checkCommand = reason === 'manual';
      this.changed();
    }
    this.recheck();
  }

  retry(id: string) {
    const entry = this.entries.get(id);
    if (entry) {
      entry.checkCommand = true;
      this.recheck();
    }
  }

  private commit(entry: Entry, reason: ObservationReason) {
    if (entry.committed || entry.step.completed) {
      return;
    }
    entry.committed = true;
    entry.step.commit(reason);
    this.changed();
  }

  recheck = () => {
    this.dirty = true;
    if (!this.active || this.running) {
      return;
    }
    this.running = true;
    void this.flush().finally(() => {
      this.running = false;
      if (this.dirty && this.active) {
        this.recheck();
      }
    });
  };

  private async flush() {
    this.dirty = false;
    const work = [...this.entries.values()];
    const checks = new Map<string, Promise<boolean>>();
    const check = async (conditions: ConditionInput, step: ObservationStep) => {
      for (const token of conditionTokens(conditions)) {
        const implicitTarget = token.includes('reftarget') ? step.actions[0] : undefined;
        const key = JSON.stringify([token, implicitTarget]);
        let result = checks.get(key);
        if (!result) {
          result = this.check([token], step, this.abortController.signal).catch(() => false);
          checks.set(key, result);
        }
        if (!(await result)) {
          return false;
        }
      }
      return true;
    };
    const worker = async () => {
      while (this.active && work.length) {
        const entry = work.shift()!;
        const { step, revision } = entry;
        if (entry.committed || step.completed || step.executing) {
          continue;
        }
        if (step.readCompleted && (await step.readCompleted())) {
          continue;
        }
        if (!this.active || entry.revision !== revision || this.entries.get(step.id) !== entry) {
          continue;
        }
        const objectiveGate = hasObjectives(step.objectives);
        const conditions = objectiveGate ? step.objectives : entry.requested ? step.verify : undefined;
        if (!objectiveGate && !entry.requested) {
          continue;
        }
        if (conditions && !isPassiveCondition(conditions) && !entry.checkCommand) {
          continue;
        }
        entry.checkCommand = false;
        const invalidBlank = Array.isArray(conditions) && conditions.some((token) => !token.trim());
        const passed =
          !invalidBlank && (conditionTokens(conditions).length ? await check(conditions!, step) : !objectiveGate);
        if (
          !this.active ||
          this.entries.get(step.id) !== entry ||
          revision !== entry.revision ||
          entry.step.executing
        ) {
          continue;
        }
        if (passed) {
          this.commit(entry, objectiveGate ? 'objectives' : entry.requested!);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
}
