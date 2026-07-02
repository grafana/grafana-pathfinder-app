import { trySetMonacoModelValue } from './code-block-handler';

type MonacoMock = NonNullable<Window['monaco']>;

describe('trySetMonacoModelValue', () => {
  const URI = 'inmemory://model/1';

  function textareaUnder(uri: string): HTMLElement {
    const root = document.createElement('div');
    root.setAttribute('data-uri', uri);
    const textarea = document.createElement('textarea');
    root.appendChild(textarea);
    document.body.appendChild(root);
    return textarea;
  }

  afterEach(() => {
    window.monaco = undefined;
    document.body.innerHTML = '';
  });

  it('returns false when the Monaco API is unavailable', () => {
    expect(trySetMonacoModelValue(textareaUnder(URI), 'x')).toBe(false);
  });

  it('returns false when the element has no [data-uri] editor', () => {
    window.monaco = { editor: { getEditors: () => [], getModels: () => [] } };
    const orphan = document.createElement('textarea');
    document.body.appendChild(orphan);
    expect(trySetMonacoModelValue(orphan, 'x')).toBe(false);
  });

  it('writes via the matching editor and focuses it', () => {
    const setValue = jest.fn();
    const focus = jest.fn();
    const monaco: MonacoMock = {
      editor: {
        getEditors: () => [{ getModel: () => ({ uri: { toString: () => URI } }), setValue, focus }],
        getModels: () => [],
      },
    };
    window.monaco = monaco;

    expect(trySetMonacoModelValue(textareaUnder(URI), 'sum(rate(x[5m]))')).toBe(true);
    expect(setValue).toHaveBeenCalledWith('sum(rate(x[5m]))');
    expect(focus).toHaveBeenCalled();
  });

  it('falls back to the matching model when no editor matches, without touching the wrong editor', () => {
    const modelSetValue = jest.fn();
    const wrongEditorSetValue = jest.fn();
    const wrongEditorFocus = jest.fn();
    const monaco: MonacoMock = {
      editor: {
        getEditors: () => [
          {
            getModel: () => ({ uri: { toString: () => 'other' } }),
            setValue: wrongEditorSetValue,
            focus: wrongEditorFocus,
          },
        ],
        getModels: () => [{ uri: { toString: () => URI }, setValue: modelSetValue }],
      },
    };
    window.monaco = monaco;

    expect(trySetMonacoModelValue(textareaUnder(URI), 'v')).toBe(true);
    expect(modelSetValue).toHaveBeenCalledWith('v');
    // The non-matching editor is left alone, and the model-fallback path never focuses.
    expect(wrongEditorSetValue).not.toHaveBeenCalled();
    expect(wrongEditorFocus).not.toHaveBeenCalled();
  });
});
