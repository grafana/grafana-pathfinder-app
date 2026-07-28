import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveActions } from './SaveActions';

describe('SaveActions: smart label + routing', () => {
  it('not-saved → "Save" (secondary), routes to onSaveDraft', () => {
    const onSaveDraft = jest.fn();
    const onPostToBackend = jest.fn();
    render(
      <SaveActions
        publishedStatus="not-saved"
        hasUnsyncedChanges={false}
        isPosting={false}
        onSaveDraft={onSaveDraft}
        onPostToBackend={onPostToBackend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(onPostToBackend).not.toHaveBeenCalled();
  });

  it('draft with unsynced changes → "Save", routes to onSaveDraft (never publishes)', () => {
    const onSaveDraft = jest.fn();
    const onPostToBackend = jest.fn();
    render(
      <SaveActions
        publishedStatus="draft"
        hasUnsyncedChanges={true}
        isPosting={false}
        onSaveDraft={onSaveDraft}
        onPostToBackend={onPostToBackend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(onPostToBackend).not.toHaveBeenCalled();
  });

  it('draft, synced → "Publish", routes to onPostToBackend', () => {
    const onSaveDraft = jest.fn();
    const onPostToBackend = jest.fn();
    render(
      <SaveActions
        publishedStatus="draft"
        hasUnsyncedChanges={false}
        isPosting={false}
        onSaveDraft={onSaveDraft}
        onPostToBackend={onPostToBackend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPostToBackend).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it('published → "Update", routes to onPostToBackend', () => {
    const onSaveDraft = jest.fn();
    const onPostToBackend = jest.fn();
    render(
      <SaveActions
        publishedStatus="published"
        hasUnsyncedChanges={false}
        isPosting={false}
        onSaveDraft={onSaveDraft}
        onPostToBackend={onPostToBackend}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onPostToBackend).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it('disables the button and drops the click while a backend operation is in progress', () => {
    const onSaveDraft = jest.fn();
    render(
      <SaveActions
        publishedStatus="not-saved"
        hasUnsyncedChanges={false}
        isPosting={true}
        onSaveDraft={onSaveDraft}
        onPostToBackend={jest.fn()}
      />
    );
    // Grafana's Button keeps a tooltipped button focusable via aria-disabled
    // (rather than the native disabled attribute) and drops its onClick.
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(btn);
    expect(onSaveDraft).not.toHaveBeenCalled();
  });
});
