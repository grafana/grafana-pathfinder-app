import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlignmentPrompt } from './AlignmentPrompt';
import { testIds } from '../../../constants/testIds';

describe('AlignmentPrompt', () => {
  it('renders the starting location in the message', () => {
    render(<AlignmentPrompt startingLocation="/connections" onConfirm={() => {}} onCancel={() => {}} />);
    // The path is rendered inside a <code> element
    expect(screen.getByText('/connections')).toBeInTheDocument();
  });

  it('renders both buttons with the expected testIds', () => {
    render(<AlignmentPrompt startingLocation="/explore" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId(testIds.alignmentPrompt.confirmButton)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.alignmentPrompt.cancelButton)).toBeInTheDocument();
  });

  it('calls onConfirm when the Navigate button is clicked', () => {
    const onConfirm = jest.fn();
    render(<AlignmentPrompt startingLocation="/explore" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId(testIds.alignmentPrompt.confirmButton));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the Continue here button is clicked', () => {
    const onCancel = jest.fn();
    render(<AlignmentPrompt startingLocation="/explore" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId(testIds.alignmentPrompt.cancelButton));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the prompt container with its testId', () => {
    render(<AlignmentPrompt startingLocation="/explore" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId(testIds.alignmentPrompt.container)).toBeInTheDocument();
  });
});
