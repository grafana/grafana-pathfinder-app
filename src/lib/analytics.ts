import { reportInteraction } from '@grafana/runtime';
import pluginJson from '../plugin.json';

export enum UserInteraction {
  DocsPanelInteraction = 'docs_panel_interaction',
  GeneralPluginFeedbackButton = 'general_plugin_feedback_button',
  SpecificLearningJourneyFeedbackButton = 'specific_learning_journey_feedback_button',
  DocsPanelScroll = 'docs_panel_scroll',
  LearningJourneySummaryClick = 'learning_journey_summary_click',
  JumpIntoMilestoneClick = 'jump_into_milestone_click',
  StartLearningJourneyClick = 'start_learning_journey_click',
  ViewDocumentationClick = 'view_documentation_click',
  MilestoneArrowInteractionClick = 'milestone_arrow_interaction_click',
  OpenDocumentationButton = 'open_documentation_button',
  CloseTabClick = 'close_tab_click',
  VideoPlayClick = 'video_play_click',
  VideoViewLength = 'video_view_length',
  OpenSidepathView = 'open_sidepath_view',
  ClickSidepathRecommendation = 'click_sidepath_recommendation',
  OpenExtraResourceTab = 'open_extra_resource_tab',
  // For Later:
  ShowMeButtonClick = 'show_me_button_click',
  ClickedHighlightedContentButton = 'clicked_highlighted_content_button',
  DoItButtonClick = 'do_it_button_click',
  DoSectionButtonClick = 'do_section_button_click',
  DismissDocsPanel = 'dismiss_docs_panel',
}

const createInteractionName = (type: UserInteraction) => {
  return `${pluginJson.id.replace(/-/g, '_')}_${type}`;
};

export function reportAppInteraction(type: UserInteraction, properties: Record<string, string | number | boolean> = {}) {
  reportInteraction(createInteractionName(type), properties);
}
