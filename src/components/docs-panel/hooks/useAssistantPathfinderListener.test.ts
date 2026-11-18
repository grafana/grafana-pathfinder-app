import { renderHook, act } from '@testing-library/react';
import { BusEventWithPayload, EventBusSrv } from '@grafana/data';
import { useAssistantPathfinderListener } from './useAssistantPathfinderListener';
import { ASSISTANT_PATHFINDER_EVENT_TYPE, AssistantPathfinderEvent } from '../../../lib/assistant-pathfinder-event';
import { StorageKeys } from '../../../lib/storage-keys';
import type { PanelMode } from '../../../global-state/panel-mode';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

const bus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getAppEvents: () => bus,
}));

// Stands in for the Assistant bundle's own class: same type string, different identity.
class ForeignAssistantPathfinderEvent extends BusEventWithPayload<Record<string, unknown>> {
  static type = 'grafana-assistant:pathfinder';
}

function tab(id: string, baseUrl: string, currentUrl = baseUrl): LearningJourneyTab {
  return { id, baseUrl, currentUrl } as LearningJourneyTab;
}

function makeModel(tabs: LearningJourneyTab[], loadTab = jest.fn().mockResolvedValue(undefined)) {
  return { state: { tabs }, loadTab };
}

function publish(payload: Record<string, unknown>) {
  act(() => {
    bus.publish(new ForeignAssistantPathfinderEvent(payload));
  });
}

function setMode(mode: PanelMode) {
  localStorage.setItem(StorageKeys.PANEL_MODE, mode);
}

describe('useAssistantPathfinderListener', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    localStorage.clear();
    setMode('sidebar');
  });

  it('reloads the matching tab in place without opening a new one', () => {
    const model = makeModel([tab('a', 'bundled:x'), tab('b', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'refresh-guide', name: 'my-guide' });

    expect(model.loadTab).toHaveBeenCalledTimes(1);
    expect(model.loadTab).toHaveBeenCalledWith('b', 'backend-guide:my-guide', {
      source: 'internal_reload',
      rejectOnError: true,
    });
  });

  it('matches on currentUrl', () => {
    const model = makeModel([tab('a', 'bundled:x', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'refresh-guide', name: 'my-guide' });

    expect(model.loadTab).toHaveBeenCalledWith('a', 'backend-guide:my-guide', expect.any(Object));
  });

  it('does nothing when no open tab matches', () => {
    const model = makeModel([tab('a', 'backend-guide:other')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'refresh-guide', name: 'my-guide' });

    expect(model.loadTab).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['path traversal', '../x'],
    ['whitespace', 'my guide'],
    ['colon', 'api:my-guide'],
    ['oversized', 'a'.repeat(254)],
    ['non-string', 42],
  ])('ignores an invalid name (%s)', (_label, name) => {
    const model = makeModel([tab('a', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'refresh-guide', name });

    expect(model.loadTab).not.toHaveBeenCalled();
  });

  it('ignores a payload with no name and never reads content from it', () => {
    const model = makeModel([tab('a', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ content: '{"blocks":[]}' });
    publish({ operation: 'refresh-guide', name: 'my-guide', content: 'x', url: 'https://evil.example' });

    expect(model.loadTab).toHaveBeenCalledTimes(1);
    expect(model.loadTab).toHaveBeenCalledWith('a', 'backend-guide:my-guide', {
      source: 'internal_reload',
      rejectOnError: true,
    });
  });

  it('ignores an unknown operation', () => {
    const model = makeModel([tab('a', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'something-new', name: 'my-guide' });

    expect(model.loadTab).not.toHaveBeenCalled();
  });

  it('ignores an event with no operation', () => {
    const model = makeModel([tab('a', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ name: 'my-guide' });

    expect(model.loadTab).not.toHaveBeenCalled();
  });

  it('only the surface that owns the display reloads', () => {
    setMode('floating');
    const sidebar = makeModel([tab('a', 'backend-guide:my-guide')]);
    const floating = makeModel([tab('a', 'backend-guide:my-guide')]);
    renderHook(() => useAssistantPathfinderListener(sidebar, 'sidebar'));
    renderHook(() => useAssistantPathfinderListener(floating, 'floating'));

    publish({ operation: 'refresh-guide', name: 'my-guide' });

    expect(sidebar.loadTab).not.toHaveBeenCalled();
    expect(floating.loadTab).toHaveBeenCalledTimes(1);
  });

  it('swallows a reload failure so the tab keeps its content', async () => {
    const loadTab = jest.fn().mockRejectedValue(new Error('boom'));
    const model = makeModel([tab('a', 'backend-guide:my-guide')], loadTab);
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'refresh-guide', name: 'my-guide' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadTab).toHaveBeenCalledWith(
      'a',
      'backend-guide:my-guide',
      expect.objectContaining({ rejectOnError: true })
    );
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('warns the user when the reload fails', async () => {
    const loadTab = jest.fn().mockRejectedValue(new Error('boom'));
    const model = makeModel([tab('a', 'backend-guide:my-guide')], loadTab);
    const publishSpy = jest.spyOn(bus, 'publish');
    renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));

    publish({ operation: 'refresh-guide', name: 'my-guide' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(publishSpy).toHaveBeenCalledWith({
      type: 'alert-warning',
      payload: ["Couldn't refresh the guide"],
    });
  });

  it('pins the event type string shared with the Assistant', () => {
    expect(ASSISTANT_PATHFINDER_EVENT_TYPE).toBe('grafana-assistant:pathfinder');
    expect(AssistantPathfinderEvent.type).toBe('grafana-assistant:pathfinder');
  });

  it('stops listening on unmount', () => {
    const model = makeModel([tab('a', 'backend-guide:my-guide')]);
    const { unmount } = renderHook(() => useAssistantPathfinderListener(model, 'sidebar'));
    unmount();

    publish({ operation: 'refresh-guide', name: 'my-guide' });

    expect(model.loadTab).not.toHaveBeenCalled();
  });
});
