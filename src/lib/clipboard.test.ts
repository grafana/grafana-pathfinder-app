import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExecCommand = document.execCommand;

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  }

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
    document.execCommand = originalExecCommand;
    document.body.innerHTML = '';
  });

  it('resolves true when writeText succeeds', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('resolves false when writeText rejects', async () => {
    setClipboard({ writeText: jest.fn().mockRejectedValue(new Error('denied')) });

    await expect(copyTextToClipboard('hello')).resolves.toBe(false);
  });

  it('does not throw when writeText throws synchronously', async () => {
    setClipboard({
      writeText: () => {
        throw new TypeError('not allowed');
      },
    });
    document.execCommand = jest.fn().mockReturnValue(false);

    let result: Promise<boolean> | undefined;
    expect(() => {
      result = copyTextToClipboard('hello');
    }).not.toThrow();
    await expect(result).resolves.toBe(false);
  });

  it('falls back to execCommand when the clipboard API is missing', async () => {
    setClipboard(undefined);
    let copiedValue: string | undefined;
    document.execCommand = jest.fn((command: string) => {
      copiedValue = document.querySelector('textarea')?.value;
      return command === 'copy';
    });

    await expect(copyTextToClipboard('fallback text')).resolves.toBe(true);
    expect(copiedValue).toBe('fallback text');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('mounts the fallback textarea next to the focused element and restores focus', async () => {
    setClipboard(undefined);
    const modal = document.createElement('div');
    const button = document.createElement('button');
    modal.appendChild(button);
    document.body.appendChild(modal);
    button.focus();

    let parent: Element | null = null;
    document.execCommand = jest.fn(() => {
      parent = document.querySelector('textarea')?.parentElement ?? null;
      return true;
    });

    await expect(copyTextToClipboard('x')).resolves.toBe(true);
    expect(parent).toBe(modal);
    expect(document.activeElement).toBe(button);
  });

  it('resolves false when neither the clipboard API nor execCommand works', async () => {
    setClipboard(undefined);
    document.execCommand = jest.fn(() => {
      throw new Error('unsupported');
    });

    await expect(copyTextToClipboard('hello')).resolves.toBe(false);
  });
});
