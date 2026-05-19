/**
 * Tests for DocsPanelHeaderMenu — de-duplication of the kebab dropdown
 * (Refresh dev + Give feedback) that previously appeared inline twice
 * in docs-panel.tsx. Pre-mortem H5 calls out telemetry parity: the two
 * call sites emit distinct `interaction_location` values; these tests
 * pin that both flow through unchanged.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DocsPanelHeaderMenu } from './DocsPanelHeaderMenu';

// Mock @grafana/ui so Dropdown always renders its overlay inline (so the
// menu items are reachable in JSDOM without needing portal interaction).
jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  const Menu = ({ children }: any) => Real.createElement('div', { role: 'menu' }, children);
  Menu.Item = ({ label, onClick }: any) =>
    Real.createElement('button', { role: 'menuitem', 'data-label': label, onClick }, label);
  return {
    Menu,
    Dropdown: ({ overlay, children }: any) => Real.createElement(Real.Fragment, null, children, overlay),
    IconButton: (props: any) =>
      Real.createElement('button', { 'aria-label': props['aria-label'], ...props }, props.name),
  };
});

jest.mock('@grafana/i18n', () => ({
  t: (_id: string, defaultMessage: string) => defaultMessage,
}));

// Mock analytics so we can assert on the payload.
jest.mock('../../../lib/analytics', () => {
  const reportAppInteraction = jest.fn();
  return {
    reportAppInteraction,
    UserInteraction: { GeneralPluginFeedbackButton: 'general_plugin_feedback_button' },
  };
});

import { reportAppInteraction } from '../../../lib/analytics';

function makeTab(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tab-1',
    title: 'Tab',
    baseUrl: 'https://example.com/',
    currentUrl: 'https://example.com/page',
    content: { url: 'https://example.com/page', type: 'docs', metadata: {}, content: '' },
    isLoading: false,
    error: null,
    type: 'docs',
    ...overrides,
  };
}

describe('DocsPanelHeaderMenu', () => {
  beforeEach(() => {
    (reportAppInteraction as jest.Mock).mockClear();
    // Prevent jsdom from actually opening the feedback form
    jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('shows Refresh (dev) only when isDevMode=true', () => {
    const { rerender } = render(
      <DocsPanelHeaderMenu
        activeTab={makeTab()}
        isDevMode={false}
        onReload={jest.fn()}
        interactionLocation="docs_panel_header_feedback_menu"
        defaultContentType="docs"
      />
    );
    expect(screen.queryByRole('menuitem', { name: /refresh \(dev\)/i })).not.toBeInTheDocument();

    rerender(
      <DocsPanelHeaderMenu
        activeTab={makeTab()}
        isDevMode
        onReload={jest.fn()}
        interactionLocation="docs_panel_header_feedback_menu"
        defaultContentType="docs"
      />
    );
    expect(screen.getByRole('menuitem', { name: /refresh \(dev\)/i })).toBeInTheDocument();
  });

  it('Refresh (dev) calls onReload with the active tab', () => {
    const onReload = jest.fn();
    const tab = makeTab();
    render(
      <DocsPanelHeaderMenu
        activeTab={tab}
        isDevMode
        onReload={onReload}
        interactionLocation="docs_panel_header_feedback_menu"
        defaultContentType="docs"
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /refresh \(dev\)/i }));
    expect(onReload).toHaveBeenCalledWith(tab);
  });

  it('emits docs_panel_header_feedback_menu telemetry from the docs surface', () => {
    render(
      <DocsPanelHeaderMenu
        activeTab={makeTab({ type: 'docs' })}
        isDevMode={false}
        onReload={jest.fn()}
        interactionLocation="docs_panel_header_feedback_menu"
        defaultContentType="docs"
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /give feedback/i }));
    expect(reportAppInteraction).toHaveBeenCalledWith(
      'general_plugin_feedback_button',
      expect.objectContaining({
        interaction_location: 'docs_panel_header_feedback_menu',
        content_type: 'docs',
      })
    );
  });

  it('emits milestone_progress_bar_feedback_menu telemetry from the milestone surface', () => {
    render(
      <DocsPanelHeaderMenu
        activeTab={makeTab({ type: 'learning-journey' })}
        isDevMode={false}
        onReload={jest.fn()}
        interactionLocation="milestone_progress_bar_feedback_menu"
        defaultContentType="learning-journey"
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /give feedback/i }));
    expect(reportAppInteraction).toHaveBeenCalledWith(
      'general_plugin_feedback_button',
      expect.objectContaining({
        interaction_location: 'milestone_progress_bar_feedback_menu',
        content_type: 'learning-journey',
      })
    );
  });

  it('falls back to defaultContentType when the tab has no `type`', () => {
    render(
      <DocsPanelHeaderMenu
        activeTab={makeTab({ type: undefined })}
        isDevMode={false}
        onReload={jest.fn()}
        interactionLocation="milestone_progress_bar_feedback_menu"
        defaultContentType="learning-journey"
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /give feedback/i }));
    expect(reportAppInteraction).toHaveBeenCalledWith(
      'general_plugin_feedback_button',
      expect.objectContaining({ content_type: 'learning-journey' })
    );
  });
});
