import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useControllerChannel, useControllerConnected } from '../../global-state/controller-channel';
import { ControllerProductLinks } from './ControllerProductLinks';

jest.mock('../../global-state/controller-channel', () => ({
  useControllerChannel: jest.fn(),
  useControllerConnected: jest.fn(),
}));

const post = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useControllerChannel as jest.Mock).mockReturnValue({ post });
  (useControllerConnected as jest.Mock).mockReturnValue(true);
});

it.each(['/dashboards?orgId=1#recent', `${window.location.origin}/explore`])(
  'opens %s in the paired tab before child handlers can navigate the reader',
  (href) => {
    const navigate = jest.fn();
    render(
      <ControllerProductLinks>
        <a href={href} onClick={navigate} target="_blank" rel="noreferrer">
          <span>Open page</span>
        </a>
      </ControllerProductLinks>
    );
    expect(fireEvent.click(screen.getByText('Open page'))).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({ kind: 'navigate-link', url: new URL(href, window.location.href).href });
  }
);

it.each([
  { href: 'https://grafana.com/docs/' },
  { href: '#section' },
  { href: '/dashboards', download: true },
  { href: '/guide', 'data-journey-start': 'true' },
  { href: 'mailto:help@example.com' },
])('preserves normal behavior for %j', (props) => {
  const navigate = jest.fn((event) => event.preventDefault());
  render(
    <ControllerProductLinks>
      <a {...props} onClick={navigate}>
        Open page
      </a>
    </ControllerProductLinks>
  );
  fireEvent.click(screen.getByText('Open page'));
  expect(navigate).toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])('preserves %s clicks', (key) => {
  const navigate = jest.fn((event) => event.preventDefault());
  render(
    <ControllerProductLinks>
      <a href="/dashboards" onClick={navigate}>
        Open page
      </a>
    </ControllerProductLinks>
  );
  fireEvent.click(screen.getByText('Open page'), { [key]: true });
  expect(navigate).toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('keeps the reader open and explains when the main tab is disconnected', () => {
  (useControllerConnected as jest.Mock).mockReturnValue(false);
  render(
    <ControllerProductLinks>
      <a href="/dashboards">Open page</a>
    </ControllerProductLinks>
  );
  expect(fireEvent.click(screen.getByText('Open page'))).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Connect to your Grafana tab');
});
