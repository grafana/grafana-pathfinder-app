import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ElementPicker } from './ElementPicker';

jest.mock('../../utils/devtools', () => ({
  generateSelectorFromEvent: jest.fn(() => ({ selector: '#target', warnings: [] })),
  generateSelectorForElement: jest.fn(() => '#target'),
}));

describe('ElementPicker', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('cancels once from the button surface and never selects', () => {
    const onSelect = jest.fn();
    const onCancel = jest.fn();
    render(<ElementPicker onSelect={onSelect} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel (Esc)' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels once when the inner label is clicked', () => {
    const onSelect = jest.fn();
    const onCancel = jest.fn();
    render(<ElementPicker onSelect={onSelect} onCancel={onCancel} />);
    const label = screen.getByText('Cancel (Esc)');
    fireEvent.click(label);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders a focusable native button so Enter and Space activate it as a click', () => {
    const onSelect = jest.fn();
    const onCancel = jest.fn();
    render(<ElementPicker onSelect={onSelect} onCancel={onCancel} />);
    const button = screen.getByRole('button', { name: 'Cancel (Esc)' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    act(() => button.focus());
    expect(button).toHaveFocus();
    // jsdom does not synthesize the click browsers fire for Enter/Space on a native button.
    fireEvent.click(button);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onCancel = jest.fn();
    render(<ElementPicker onSelect={jest.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('selects on a normal element click', () => {
    const onSelect = jest.fn();
    const onCancel = jest.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const original = document.elementFromPoint;
    document.elementFromPoint = jest.fn(() => target);
    render(<ElementPicker onSelect={onSelect} onCancel={onCancel} />);
    fireEvent.click(target, { clientX: 5, clientY: 5 });
    expect(onSelect).toHaveBeenCalledWith('#target');
    expect(onCancel).not.toHaveBeenCalled();
    document.elementFromPoint = original;
    target.remove();
  });

  it('removes listeners and restores body overflow on unmount', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    const { unmount } = render(<ElementPicker onSelect={jest.fn()} onCancel={jest.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
    for (const type of ['click', 'mousemove', 'keydown']) {
      const added = add.mock.calls.find((c) => c[0] === type)!;
      const args = added[2] === undefined ? [type, added[1]] : [type, added[1], added[2]];
      expect(remove).toHaveBeenCalledWith(...args);
    }
    add.mockRestore();
    remove.mockRestore();
  });
});
