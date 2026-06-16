import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { ImageBlockForm } from './ImageBlockForm';
import type { JsonBlock } from '../types';

function renderForm(onSubmit: (block: JsonBlock) => void = jest.fn()) {
  render(<ImageBlockForm onSubmit={onSubmit} onCancel={jest.fn()} />);
  return {
    urlInput: screen.getByPlaceholderText('https://example.com/image.png'),
    submitButton: screen.getByRole('button', { name: 'Add block' }),
  };
}

describe('ImageBlockForm', () => {
  it('rejects relative image paths before submit', () => {
    const onSubmit = jest.fn();
    const { urlInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(urlInput, { target: { value: '/images/logo.png' } });

    expect(screen.getByText('Enter an absolute http or https image URL')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects non-http image URL schemes before submit', () => {
    const onSubmit = jest.fn();
    const { urlInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(urlInput, { target: { value: 'javascript:alert(1)' } });

    expect(screen.getByText('Enter an absolute http or https image URL')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('surfaces an inline error when the preview image cannot load', () => {
    const { urlInput, submitButton } = renderForm();

    fireEvent.change(urlInput, { target: { value: 'https://example.com/missing.png' } });
    fireEvent.error(screen.getByRole('img', { name: 'Preview' }));

    expect(
      screen.getByText('Unable to load image preview. Check that the URL points to an image.')
    ).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  it('submits a trimmed absolute http URL', () => {
    const onSubmit = jest.fn();
    const { urlInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(urlInput, { target: { value: '  https://example.com/image.png  ' } });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'image',
      src: 'https://example.com/image.png',
    });
  });
});
