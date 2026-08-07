import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { BlockPalette } from './BlockPalette';
import { PALETTE_EXCLUDED_BLOCK_TYPES } from './constants';

/**
 * `constants.test.ts` proves the registries partition `JsonBlock['type']`; this
 * covers the surface that partition exists for — the palette a guide author
 * actually clicks. `challenge` had a schema, metadata and a form yet was absent
 * from the palette, reachable only by switching an existing block's type.
 */
describe('BlockPalette', () => {
  const openPalette = () => {
    render(<BlockPalette onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId(testIds.blockEditor.addBlockButton));
    // Anchor: proves the palette rendered, so the absence assertions below
    // cannot pass vacuously.
    expect(screen.getByTestId(testIds.blockEditor.blockTypeButton('markdown'))).toBeInTheDocument();
  };

  it('offers the challenge block under Interactive', () => {
    openPalette();

    const group = screen.getByTestId(testIds.blockEditor.paletteGroup('interactive'));
    expect(group).toHaveTextContent('Interactive');
    expect(within(group).getByTestId(testIds.blockEditor.blockTypeButton('challenge'))).toHaveTextContent('Challenge');
  });

  it('offers no block type that is deliberately excluded', () => {
    openPalette();

    for (const type of PALETTE_EXCLUDED_BLOCK_TYPES) {
      expect(screen.queryByTestId(testIds.blockEditor.blockTypeButton(type))).not.toBeInTheDocument();
    }
  });
});
