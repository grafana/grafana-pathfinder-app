import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useLinkClickHandler } from './link-handler.hook';
import { UserInteraction } from '../lib/analytics';

// Mock analytics reporting
jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    StartLearningJourneyClick: 'start_learning_journey_click',
    'docs_link_click': 'docs_link_click'
  }
}));

describe('useLinkClickHandler', () => {
  // Mock theme object (minimal required properties)
  const mockTheme = {
    colors: { background: { primary: '#000000' } }
  } as any;

  // Mock model with all required functions
  const mockModel = {
    loadTabContent: jest.fn(),
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
    getActiveTab: jest.fn(),
    navigateToNextMilestone: jest.fn(),
    navigateToPreviousMilestone: jest.fn(),
    canNavigateNext: jest.fn(() => true),
    canNavigatePrevious: jest.fn(() => true),
  };

  // Create a div to hold our content and links
  let contentDiv: HTMLDivElement;
  let contentRef: React.RefObject<HTMLDivElement>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create fresh content div for each test
    contentDiv = document.createElement('div');
    contentRef = { current: contentDiv };
    
    // Mock active tab data
    mockModel.getActiveTab.mockReturnValue({
      id: 'tab1',
      title: 'Test Journey',
      baseUrl: 'https://grafana.com/docs/test-journey',
      content: {
        url: 'https://grafana.com/docs/test-journey/milestone1',
        metadata: {
          learningJourney: {
            totalMilestones: 5
          }
        }
      },
      isLoading: false,
      error: null
    });
  });

  describe('Journey Start Button', () => {
    it('should handle journey start button clicks', () => {
      // Render the hook
      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      // Create and add journey start button
      const startButton = document.createElement('button');
      startButton.setAttribute('data-journey-start', 'true');
      startButton.setAttribute('data-milestone-url', 'https://grafana.com/docs/test-journey/milestone1');
      contentDiv.appendChild(startButton);

      // Simulate click
      fireEvent.click(startButton);

      // Verify expected behavior
      expect(mockModel.loadTabContent).toHaveBeenCalledWith(
        'tab1',
        'https://grafana.com/docs/test-journey/milestone1'
      );
    });
  });

  describe('Grafana Documentation Links', () => {
    it('should handle Grafana docs links', () => {
      // Render the hook
      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      // Create and add docs link
      const docsLink = document.createElement('a');
      docsLink.href = 'https://grafana.com/docs/grafana/latest/whatever';
      docsLink.textContent = 'Grafana Docs';
      contentDiv.appendChild(docsLink);

      // Simulate click
      fireEvent.click(docsLink);

      // Verify expected behavior
      expect(mockModel.openDocsPage).toHaveBeenCalledWith(
        'https://grafana.com/docs/grafana/latest/whatever',
        'Grafana Docs'
      );
    });

    it('should handle relative docs links', () => {
      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      const relativeLink = document.createElement('a');
      relativeLink.href = '../relative/path';
      relativeLink.textContent = 'Relative Link';
      contentDiv.appendChild(relativeLink);

      fireEvent.click(relativeLink);

      // Should resolve against current page URL
      expect(mockModel.openDocsPage).toHaveBeenCalledWith(
        expect.stringContaining('/relative/path'),
        'Relative Link'
      );
    });
  });

  describe('Navigation Buttons', () => {
    it('should handle next/previous milestone navigation', () => {
      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      // Create and add navigation buttons
      const nextButton = document.createElement('button');
      nextButton.className = 'journey-bottom-nav-button';
      nextButton.textContent = 'Next';
      
      const prevButton = document.createElement('button');
      prevButton.className = 'journey-bottom-nav-button';
      prevButton.textContent = 'Previous';

      contentDiv.appendChild(nextButton);
      contentDiv.appendChild(prevButton);

      // Test next navigation
      fireEvent.click(nextButton);
      expect(mockModel.navigateToNextMilestone).toHaveBeenCalled();

      // Test previous navigation
      fireEvent.click(prevButton);
      expect(mockModel.navigateToPreviousMilestone).toHaveBeenCalled();
    });
  });

  describe('External Links', () => {
    it('should open external links in new tab', () => {
      // Mock window.open
      const windowOpen = jest.spyOn(window, 'open').mockImplementation();

      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      const externalLink = document.createElement('a');
      externalLink.href = 'https://example.com';
      externalLink.textContent = 'External Link';
      contentDiv.appendChild(externalLink);

      fireEvent.click(externalLink);

      expect(windowOpen).toHaveBeenCalledWith(
        'https://example.com',
        '_blank',
        'noopener,noreferrer'
      );

      windowOpen.mockRestore();
    });
  });

  describe('Side Journey Links', () => {
    it('should handle side journey links', () => {
      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      const sideJourneyLink = document.createElement('a');
      sideJourneyLink.setAttribute('data-side-journey-link', 'true');
      sideJourneyLink.href = '/docs/side-journey';
      sideJourneyLink.textContent = 'Side Journey';
      contentDiv.appendChild(sideJourneyLink);

      fireEvent.click(sideJourneyLink);

      expect(mockModel.openDocsPage).toHaveBeenCalledWith(
        'https://grafana.com/docs/side-journey',
        'Side Journey'
      );
    });
  });

  describe('Analytics Reporting', () => {
    it('should report journey start interactions', () => {
      const { reportAppInteraction } = require('../lib/analytics');

      renderHook(() => useLinkClickHandler({
        contentRef,
        activeTab: mockModel.getActiveTab(),
        theme: mockTheme,
        model: mockModel
      }));

      const startButton = document.createElement('button');
      startButton.setAttribute('data-journey-start', 'true');
      startButton.setAttribute('data-milestone-url', 'https://grafana.com/docs/test-journey/milestone1');
      contentDiv.appendChild(startButton);

      fireEvent.click(startButton);

      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.StartLearningJourneyClick,
        expect.objectContaining({
          journey_title: 'Test Journey',
          journey_url: 'https://grafana.com/docs/test-journey',
          total_milestones: 5
        })
      );
    });
  });
});