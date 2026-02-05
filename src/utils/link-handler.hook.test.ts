import { renderHook, fireEvent } from '@testing-library/react';
import { useLinkClickHandler } from './link-handler.hook';
import { UserInteraction } from '../lib/analytics';

// Mock analytics reporting
jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  enrichWithJourneyContext: jest.fn((props, _content) => props), // Pass through
  enrichWithStepContext: jest.fn((props) => props), // Pass through
  getContentTypeForAnalytics: jest.fn((url, fallback) => fallback), // Pass through fallback
  UserInteraction: {
    StartLearningJourneyClick: 'start_learning_journey_click',
    OpenExtraResource: 'open_extra_resource',
    MilestoneArrowInteractionClick: 'milestone_arrow_interaction_click',
  },
}));

describe('useLinkClickHandler', () => {
  // Mock theme object (minimal required properties)
  const mockTheme = {
    colors: { background: { primary: '#000000' } },
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
            totalMilestones: 5,
          },
        },
      },
      isLoading: false,
      error: null,
    });
  });

  describe('Journey Start Button', () => {
    it('should handle journey start button clicks', () => {
      // Render the hook
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      // Create and add journey start button
      const startButton = document.createElement('button');
      startButton.setAttribute('data-journey-start', 'true');
      startButton.setAttribute('data-milestone-url', 'https://grafana.com/docs/test-journey/milestone1');
      contentDiv.appendChild(startButton);

      // Simulate click
      fireEvent.click(startButton);

      // Verify expected behavior
      expect(mockModel.loadTabContent).toHaveBeenCalledWith('tab1', 'https://grafana.com/docs/test-journey/milestone1');
    });
  });

  describe('Grafana Documentation Links', () => {
    it('should handle Grafana docs links', () => {
      // Render the hook
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

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
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const relativeLink = document.createElement('a');
      relativeLink.href = '../relative/path';
      relativeLink.textContent = 'Relative Link';
      contentDiv.appendChild(relativeLink);

      fireEvent.click(relativeLink);

      // Should resolve against current page URL
      expect(mockModel.openDocsPage).toHaveBeenCalledWith(expect.stringContaining('/relative/path'), 'Relative Link');
    });
  });

  describe('Navigation Buttons', () => {
    it('should handle next/previous milestone navigation', () => {
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      // Create and add navigation buttons
      const nextButton = document.createElement('button');
      nextButton.setAttribute('data-journey-nav', 'next');
      nextButton.textContent = 'Next';

      const prevButton = document.createElement('button');
      prevButton.setAttribute('data-journey-nav', 'prev');
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

  describe('Interactive Learning Links', () => {
    let windowOpen: jest.SpyInstance;

    beforeEach(() => {
      windowOpen = jest.spyOn(window, 'open').mockImplementation();
    });

    afterEach(() => {
      windowOpen.mockRestore();
    });

    it('should open interactive learning URLs in app tabs', () => {
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const interactiveLink = document.createElement('a');
      interactiveLink.href = 'https://interactive-learning.grafana.net/tutorial/content.json';
      interactiveLink.textContent = 'interactive guide';
      contentDiv.appendChild(interactiveLink);

      fireEvent.click(interactiveLink);

      // Should open in app
      expect(mockModel.openDocsPage).toHaveBeenCalledWith(
        'https://interactive-learning.grafana.net/tutorial/content.json',
        'interactive guide'
      );
      expect(windowOpen).not.toHaveBeenCalled();
    });

    it('should open disallowed URLs in new browser tab', () => {
      jest.useFakeTimers();

      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const disallowedLink = document.createElement('a');
      disallowedLink.href = 'https://not-allowed.com/ExtraContent/README.md';
      disallowedLink.textContent = 'Disallowed Link';
      contentDiv.appendChild(disallowedLink);

      fireEvent.click(disallowedLink);

      // Advance timers to execute the setTimeout delay
      jest.advanceTimersByTime(100);

      // Should open in browser, not in app
      expect(windowOpen).toHaveBeenCalledWith(
        'https://not-allowed.com/ExtraContent/README.md',
        '_blank',
        'noopener,noreferrer'
      );
      expect(mockModel.openDocsPage).not.toHaveBeenCalled();
      expect(mockModel.openLearningJourney).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should open interactive-learning.grafana-dev.net URLs in app', () => {
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const devLink = document.createElement('a');
      devLink.href = 'https://interactive-learning.grafana-dev.net/tutorial/';
      devLink.textContent = 'Dev Tutorial';
      contentDiv.appendChild(devLink);

      fireEvent.click(devLink);

      expect(mockModel.openDocsPage).toHaveBeenCalledWith(
        'https://interactive-learning.grafana-dev.net/tutorial/',
        'Dev Tutorial'
      );
      expect(windowOpen).not.toHaveBeenCalled();
    });
  });

  describe('External Links', () => {
    it('should open external links in new tab', () => {
      jest.useFakeTimers();
      // Mock window.open
      const windowOpen = jest.spyOn(window, 'open').mockImplementation();

      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const externalLink = document.createElement('a');
      externalLink.href = 'https://example.com';
      externalLink.textContent = 'External Link';
      contentDiv.appendChild(externalLink);

      fireEvent.click(externalLink);

      // Advance timers to execute the setTimeout delay
      jest.advanceTimersByTime(100);

      expect(windowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');

      windowOpen.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('Side Journey Links', () => {
    it('should handle side journey links to allowed domains in app', () => {
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const sideJourneyLink = document.createElement('a');
      sideJourneyLink.setAttribute('data-side-journey-link', 'true');
      sideJourneyLink.href = '/docs/side-journey';
      sideJourneyLink.textContent = 'Side Journey';
      contentDiv.appendChild(sideJourneyLink);

      fireEvent.click(sideJourneyLink);

      expect(mockModel.openDocsPage).toHaveBeenCalledWith('https://grafana.com/docs/side-journey', 'Side Journey');
    });

    it('should open external side journey links in browser tab', () => {
      jest.useFakeTimers();
      const windowOpen = jest.spyOn(window, 'open').mockImplementation();

      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const sideJourneyLink = document.createElement('a');
      sideJourneyLink.setAttribute('data-side-journey-link', 'true');
      sideJourneyLink.href = 'https://external-docs.example.com/guide';
      sideJourneyLink.textContent = 'External Guide';
      contentDiv.appendChild(sideJourneyLink);

      fireEvent.click(sideJourneyLink);

      // Advance timers to execute the setTimeout delay
      jest.advanceTimersByTime(100);

      // Should open in browser, not in app
      expect(windowOpen).toHaveBeenCalledWith(
        'https://external-docs.example.com/guide',
        '_blank',
        'noopener,noreferrer'
      );
      expect(mockModel.openDocsPage).not.toHaveBeenCalled();
      expect(mockModel.openLearningJourney).not.toHaveBeenCalled();

      windowOpen.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('Related Journey Links', () => {
    it('should handle related journey links to allowed domains in app', () => {
      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const relatedJourneyLink = document.createElement('a');
      relatedJourneyLink.setAttribute('data-related-journey-link', 'true');
      relatedJourneyLink.href = '/docs/grafana/latest/related-journey';
      relatedJourneyLink.textContent = 'Related Journey';
      contentDiv.appendChild(relatedJourneyLink);

      fireEvent.click(relatedJourneyLink);

      expect(mockModel.openLearningJourney).toHaveBeenCalledWith(
        'https://grafana.com/docs/grafana/latest/related-journey',
        'Related Journey'
      );
    });

    it('should open external related journey links in browser tab', () => {
      jest.useFakeTimers();
      const windowOpen = jest.spyOn(window, 'open').mockImplementation();

      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const relatedJourneyLink = document.createElement('a');
      relatedJourneyLink.setAttribute('data-related-journey-link', 'true');
      relatedJourneyLink.href = 'https://external-learning.example.com/course';
      relatedJourneyLink.textContent = 'External Course';
      contentDiv.appendChild(relatedJourneyLink);

      fireEvent.click(relatedJourneyLink);

      // Advance timers to execute the setTimeout delay
      jest.advanceTimersByTime(100);

      // Should open in browser, not in app
      expect(windowOpen).toHaveBeenCalledWith(
        'https://external-learning.example.com/course',
        '_blank',
        'noopener,noreferrer'
      );
      expect(mockModel.openLearningJourney).not.toHaveBeenCalled();
      expect(mockModel.openDocsPage).not.toHaveBeenCalled();

      windowOpen.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('Analytics Reporting', () => {
    it('should report journey start interactions', () => {
      const { reportAppInteraction } = require('../lib/analytics');

      renderHook(() =>
        useLinkClickHandler({
          contentRef,
          activeTab: mockModel.getActiveTab(),
          theme: mockTheme,
          model: mockModel,
        })
      );

      const startButton = document.createElement('button');
      startButton.setAttribute('data-journey-start', 'true');
      startButton.setAttribute('data-milestone-url', 'https://grafana.com/docs/test-journey/milestone1');
      contentDiv.appendChild(startButton);

      fireEvent.click(startButton);

      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.StartLearningJourneyClick,
        expect.objectContaining({
          content_title: 'Test Journey',
          content_url: 'https://grafana.com/docs/test-journey',
          total_milestones: 5,
        })
      );
    });
  });
});
