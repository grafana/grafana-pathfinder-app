import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { BlockPalette } from './BlockPalette';
import { PALETTE_EXCLUDED_BLOCK_TYPES } from './constants';

/**
 * `constants.test.ts` proves the registries partition `JsonBlock['type']`; this
 * covers the surface that partition exists for — the palette a guide author
 * actually clicks. `challenge` had a schema, metadata and a form yet rendered
 * nowhere.
 */
describe('BlockPalette', () => {
  const openPalette = () => {
    render(<BlockPalette onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId(testIds.blockEditor.addBlockButton));
  };

  it('offers the challenge block under Interactive', () => {
    openPalette();

    const challenge = screen.getByTestId(testIds.blockEditor.blockTypeButton('challenge'));
    expect(challenge).toHaveTextContent('Challenge');

    const groupHeader = challenge.parentElement?.parentElement?.firstElementChild;
    expect(groupHeader).toHaveTextContent('Interactive');
  });

  it('offers no block type that is deliberately excluded', () => {
    openPalette();

    for (const type of PALETTE_EXCLUDED_BLOCK_TYPES) {
      expect(screen.queryByTestId(testIds.blockEditor.blockTypeButton(type))).not.toBeInTheDocument();
    }
  });
});
