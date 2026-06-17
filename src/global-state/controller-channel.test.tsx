import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ControllerChannelProvider, useControllerChannel } from './controller-channel';

function makeTransport() {
  return { start: jest.fn(), stop: jest.fn(), post: jest.fn() };
}

function Probe() {
  const channel = useControllerChannel();
  return (
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
  );
}

describe('ControllerChannelProvider', () => {
  it('starts the transport on mount and stops it on unmount', () => {
    const transport = makeTransport();
    const { unmount } = render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(transport.stop).not.toHaveBeenCalled();

    unmount();
    expect(transport.stop).toHaveBeenCalledTimes(1);
  });

  it('forwards channel.post to the transport', () => {
    const transport = makeTransport();
    render(
      <ControllerChannelProvider transport={transport}>
        <Probe />
      </ControllerChannelProvider>
    );

    fireEvent.click(screen.getByText('post'));

    expect(transport.post).toHaveBeenCalledWith({
      kind: 'step-command',
      phase: 'do',
      stepId: 's1',
      action: { targetAction: 'button', refTarget: '#x' },
    });
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
