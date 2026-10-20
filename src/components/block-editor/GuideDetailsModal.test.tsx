import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { GuideDetailsModal, type GuideDetailsModalProps } from './GuideDetailsModal';

function renderModal(overrides: Partial<GuideDetailsModalProps> = {}) {
  const props: GuideDetailsModalProps = {
    isOpen: true,
    initialAuthorName: '',
    initialTeam: '',
    authorPlaceholder: 'Sam Rivera',
    onSave: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(<GuideDetailsModal {...props} />);
  return props;
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('GuideDetailsModal', () => {
  it('shows the name a save would use when the author has not chosen one', () => {
    renderModal();

    expect(screen.getByTestId(testIds.blockEditor.guideDetailsAuthorInput)).toHaveAttribute(
      'placeholder',
      'Sam Rivera'
    );
  });

  it('reports only the fields the author changed', () => {
    const props = renderModal({ initialAuthorName: 'pathfinder-mcp', initialTeam: 'Docs' });

    type(testIds.blockEditor.guideDetailsTeamInput, ' Observability ');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.guideDetailsSave));

    expect(props.onSave).toHaveBeenCalledWith({ team: 'Observability' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('reports a cleared team so it can be removed', () => {
    const props = renderModal({ initialAuthorName: 'Dana', initialTeam: 'Docs' });

    type(testIds.blockEditor.guideDetailsTeamInput, '');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.guideDetailsSave));

    expect(props.onSave).toHaveBeenCalledWith({ team: '' });
  });

  it('reports a new author name', () => {
    const props = renderModal();

    type(testIds.blockEditor.guideDetailsAuthorInput, 'Dana');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.guideDetailsSave));

    expect(props.onSave).toHaveBeenCalledWith({ authorName: 'Dana' });
  });

  it('clears a chosen name so the save default applies again', () => {
    const props = renderModal({ initialAuthorName: 'Dana' });

    type(testIds.blockEditor.guideDetailsAuthorInput, '');
    fireEvent.click(screen.getByTestId(testIds.blockEditor.guideDetailsSave));

    expect((props.onSave as jest.Mock).mock.calls[0][0]).toStrictEqual({ authorName: undefined });
  });
});
