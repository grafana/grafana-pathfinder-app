import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ControllerChannelProvider, useControllerChannel } from './controller-channel';
import type { CrossTabMessage } from '../types/cross-tab.types';

class FakeTransport {
  started = false;
  stopped = false;
  postedMessages: unknown[] = [];
  private listener: ((message: CrossTabMessage) => void) | null = null;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  post(payload: unknown): void {
    this.postedMessages.push(payload);
  }

  onMessage(listener: (message: CrossTabMessage) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(message: CrossTabMessage): void {
    this.listener?.(message);
  }
}

function liveHeartbeat(): CrossTabMessage {
  return { source: 'pathfinder', senderId: 'live', timestamp: 0, kind: 'heartbeat', role: 'live' };
}

function Probe() {
  const channel = useControllerChannel();
  return (
    <div>
      <button
        onClick={() =>
          channel?.post({
            kind: 'step-command',
            phase: 'do',
            stepId: 's1',
            action: { targetAction: 'button', refTarget: '#x' },
          })
        }
      >
        post
      </button>
      <span data-testid="connected">{String(channel?.connected)}</span>
    </div>
  );
}

describe('ControllerChannelProvider', () => {
  it('starts the transport on mount and stops it on unmount', () => {
    const transport = new FakeTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.started).toBe(true);
    expect(transport.stopped).toBe(false);

    unmount();
    expect(transport.stopped).toBe(true);
  });

  it('posts a controller heartbeat on mount', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.postedMessages).toContainEqual({ kind: 'heartbeat', role: 'controller' });
  });

  it('forwards channel.post to the transport', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('post'));

    expect(transport.postedMessages).toContainEqual({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      action: { targetAction: 'button', refTarget: '#x' },
    });
  });

  it('reports connected once a live heartbeat arrives', () => {
    const transport = new FakeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    act(() => transport.emit(liveHeartbeat()));
    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });

  it('returns null outside a provider', () => {
    function Peek() {
      const channel = useControllerChannel();
      return <span data-testid="outside">{channel === null ? 'null' : 'present'}</span>;
    }
    render(<Peek />);
    expect(screen.getByTestId('outside')).toHaveTextContent('null');
  });
});
