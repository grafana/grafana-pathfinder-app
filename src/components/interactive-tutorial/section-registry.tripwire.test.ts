/**
 * Phase 0 TRIPWIRE — module-level step registry.
 *
 * Pins the order-sensitive offset math + reset semantics of the global
 * step registry currently embedded in `interactive-section.tsx`
 * (`globalStepRegistry`, `documentStepOffsets`, `autoDocumentOrder`,
 * `interactiveSectionCounter`, plus the public functions
 * `registerSectionSteps`, `getTotalDocumentSteps`, `getDocumentStepPosition`,
 * `resetInteractiveCounters`).
 *
 * Disposable — to be deleted in the same commit that lands Tier A1
 * (extract `section-registry.ts`) once the permanent post-test for the
 * extracted module proves net-positive. See the High-Risk Refactor
 * Guidelines, Principle 4 (per-phase testing sandwich).
 *
 * Why this is a tripwire and not a test of the new module:
 *   Tier A1 moves these functions into `section-registry.ts` *without
 *   changing behaviour*. The tripwire is the contract assertion that
 *   the move preserves: same offsets, same totals, same reset
 *   semantics, same auto-incrementing fallback.
 */

import { createConstantsMock, createInteractiveConfigMock } from '../../test-utils/interactive-section-harness';

// The harness mocks aren't strictly required for the registry — the
// functions are pure — but importing `interactive-section.tsx` pulls in
// React + Grafana UI + the engine barrels via its top-level imports.
// Mock the heaviest of those to keep the test focused on registry
// behaviour without dragging in unrelated modules.

jest.mock('@grafana/ui', () => ({ Button: () => null }));
jest.mock('@grafana/data', () => ({ usePluginContext: () => ({ meta: { jsonData: {} } }) }));
jest.mock('../../lib/analytics', () => {
  return require('../../test-utils/interactive-section-harness').createAnalyticsMock();
});
jest.mock('../../constants', () => createConstantsMock());
jest.mock('../../constants/interactive-config', () => createInteractiveConfigMock());
jest.mock('../../lib/user-storage', () => {
  return require('../../test-utils/interactive-section-harness').createUserStorageMock();
});
jest.mock('../../global-state/alignment-pending-context', () => {
  return require('../../test-utils/interactive-section-harness').createAlignmentContextMock();
});
jest.mock('../../interactive-engine', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveEngineMock();
});
jest.mock('../../requirements-manager', () => {
  return require('../../test-utils/interactive-section-harness').createRequirementsManagerMock();
});
jest.mock('../../docs-retrieval', () => {
  return require('../../test-utils/interactive-section-harness').createDocsRetrievalMock();
});
jest.mock('./interactive-step', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveStepMock();
});
jest.mock('./interactive-multi-step', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveMultiStepMock();
});
jest.mock('./interactive-guided', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveGuidedMock();
});
jest.mock('./interactive-quiz', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveQuizMock();
});
jest.mock('./terminal-step', () => {
  return require('../../test-utils/interactive-section-harness').createTerminalStepMock();
});
jest.mock('./terminal-connect-step', () => {
  return require('../../test-utils/interactive-section-harness').createTerminalConnectStepMock();
});
jest.mock('./code-block-step', () => {
  return require('../../test-utils/interactive-section-harness').createCodeBlockStepMock();
});
jest.mock('./interactive-conditional', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConditionalMock();
});

// Imports under test — must come after `jest.mock` factories.
import {
  registerSectionSteps,
  getTotalDocumentSteps,
  getDocumentStepPosition,
  resetInteractiveCounters as resetCountersUnderTest,
} from './interactive-section';

beforeEach(() => {
  resetCountersUnderTest();
});

describe('section registry — Phase 0 tripwire', () => {
  describe('resetInteractiveCounters', () => {
    it('clears total + offsets, returning the registry to a pristine state', () => {
      registerSectionSteps('a', 2);
      registerSectionSteps('b', 3);
      expect(getTotalDocumentSteps()).toBe(5);

      resetCountersUnderTest();

      expect(getTotalDocumentSteps()).toBe(0);
      expect(getDocumentStepPosition('a', 0)).toEqual({ stepIndex: 0, totalSteps: 0 });
    });
  });

  describe('registerSectionSteps — registration-order offsets', () => {
    it('assigns offsets in registration order and returns the section offset + new total', () => {
      const a = registerSectionSteps('a', 2);
      expect(a).toEqual({ offset: 0, total: 2 });

      const b = registerSectionSteps('b', 3);
      expect(b).toEqual({ offset: 2, total: 5 });

      const c = registerSectionSteps('c', 4);
      expect(c).toEqual({ offset: 5, total: 9 });

      expect(getTotalDocumentSteps()).toBe(9);
      expect(getDocumentStepPosition('a', 0)).toEqual({ stepIndex: 0, totalSteps: 9 });
      expect(getDocumentStepPosition('b', 1)).toEqual({ stepIndex: 3, totalSteps: 9 });
      expect(getDocumentStepPosition('c', 2)).toEqual({ stepIndex: 7, totalSteps: 9 });
    });
  });

  describe('registerSectionSteps — explicit documentOrder wins over registration order', () => {
    it('honours documentOrder when the second registration declares a smaller order than the first', () => {
      // Register `a` first but give it a LARGER documentOrder than `b`.
      // The offset math must place `b` before `a`.
      registerSectionSteps('a', 2, /* documentOrder */ 10);
      registerSectionSteps('b', 3, /* documentOrder */ 5);

      expect(getDocumentStepPosition('b', 0)).toEqual({ stepIndex: 0, totalSteps: 5 });
      expect(getDocumentStepPosition('a', 0)).toEqual({ stepIndex: 3, totalSteps: 5 });
    });
  });

  describe('registerSectionSteps — re-registration preserves documentOrder, updates count', () => {
    it('preserves the original documentOrder when re-registering with no explicit order, and just updates stepCount', () => {
      registerSectionSteps('a', 2, /* documentOrder */ 1);
      registerSectionSteps('b', 3, /* documentOrder */ 2);
      // Re-register `a` with a NEW count but no documentOrder. It must
      // stay before `b` because its prior documentOrder=1 is preserved.
      registerSectionSteps('a', 5 /* no documentOrder */);

      expect(getDocumentStepPosition('a', 0)).toEqual({ stepIndex: 0, totalSteps: 8 });
      expect(getDocumentStepPosition('b', 0)).toEqual({ stepIndex: 5, totalSteps: 8 });
    });
  });

  describe('registerSectionSteps — auto-incrementing fallback', () => {
    it('uses an auto-incrementing counter when no documentOrder is provided and no prior registration exists', () => {
      // Without explicit documentOrder, each new section gets the next
      // auto-increment value — so registration order IS document order.
      registerSectionSteps('x', 1);
      registerSectionSteps('y', 1);
      registerSectionSteps('z', 1);
      expect(getDocumentStepPosition('x', 0)).toEqual({ stepIndex: 0, totalSteps: 3 });
      expect(getDocumentStepPosition('y', 0)).toEqual({ stepIndex: 1, totalSteps: 3 });
      expect(getDocumentStepPosition('z', 0)).toEqual({ stepIndex: 2, totalSteps: 3 });
    });
  });

  describe('getDocumentStepPosition — unknown sectionId', () => {
    it('returns offset=0 + the current total for sections not in the registry', () => {
      registerSectionSteps('a', 2);
      expect(getDocumentStepPosition('not-registered', 4)).toEqual({ stepIndex: 4, totalSteps: 2 });
    });
  });
});
