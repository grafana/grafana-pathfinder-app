import { renderHook, waitFor } from '@testing-library/react';

import { useSectionPersistence } from './use-section-persistence';

const memoryStore = new Map<string, unknown>();
const ackKey = (contentKey: string, sectionId: string) => `section-ack::${contentKey}::${sectionId}`;
const collapseKey = (contentKey: string, sectionId: string) => `section-collapse::${contentKey}::${sectionId}`;
const doneKey = (contentKey: string, sectionId: string) => `section-done::${contentKey}::${sectionId}`;

jest.mock('../../../lib/user-storage', () => ({
  interactiveStepStorage: {
    getCompleted: jest.fn(async () => new Set<string>()),
  },
  sectionAcknowledgementStorage: {
    get: jest.fn(async (contentKey: string, sectionId: string) => {
      const value = memoryStore.get(ackKey(contentKey, sectionId));
      return value === undefined ? null : true;
    }),
    set: jest.fn(async (contentKey: string, sectionId: string, value: true) => {
      memoryStore.set(ackKey(contentKey, sectionId), value);
    }),
    clear: jest.fn(async (contentKey: string, sectionId: string) => {
      memoryStore.delete(ackKey(contentKey, sectionId));
    }),
  },
  sectionCollapseStorage: {
    clear: jest.fn(async (contentKey: string, sectionId: string) => {
      memoryStore.delete(collapseKey(contentKey, sectionId));
    }),
  },
  sectionDoneStorage: {
    clear: jest.fn(async (contentKey: string, sectionId: string) => {
      memoryStore.delete(doneKey(contentKey, sectionId));
    }),
  },
}));

beforeEach(() => {
  memoryStore.clear();
  (window as any).__DocsPluginActiveTabUrl = undefined;
});

describe('useSectionPersistence', () => {
  it('clears local section state when the guide emits interactive-progress-cleared for the active content key', async () => {
    const dispatch = jest.fn();

    memoryStore.set(ackKey('/', 'section-1'), true);
    memoryStore.set(collapseKey('/', 'section-1'), true);
    memoryStore.set(doneKey('/', 'section-1'), true);

    renderHook(() =>
      useSectionPersistence({
        sectionId: 'section-1',
        isPreviewMode: false,
        stepComponents: [],
        gateAnalysis: { needsAcknowledgement: true, isAllPassive: true },
        dispatch,
      })
    );

    window.dispatchEvent(new CustomEvent('interactive-progress-cleared', { detail: { contentKey: '/' } }));

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'CLEAR_ACK' });
      expect(memoryStore.get(ackKey('/', 'section-1'))).toBeUndefined();
      expect(memoryStore.get(collapseKey('/', 'section-1'))).toBeUndefined();
      expect(memoryStore.get(doneKey('/', 'section-1'))).toBeUndefined();
    });
  });

  it('ignores interactive-progress-cleared events for a different content key', async () => {
    const dispatch = jest.fn();

    memoryStore.set(ackKey('/', 'section-1'), true);

    renderHook(() =>
      useSectionPersistence({
        sectionId: 'section-1',
        isPreviewMode: false,
        stepComponents: [],
        gateAnalysis: { needsAcknowledgement: true, isAllPassive: true },
        dispatch,
      })
    );

    window.dispatchEvent(new CustomEvent('interactive-progress-cleared', { detail: { contentKey: '/other' } }));

    await waitFor(() => {
      expect(dispatch).not.toHaveBeenCalled();
      expect(memoryStore.get(ackKey('/', 'section-1'))).toBe(true);
    });
  });
});
