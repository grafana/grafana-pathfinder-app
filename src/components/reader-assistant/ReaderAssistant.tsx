import React, { useEffect, useMemo, useRef } from 'react';
import {
  createAssistantContextItem,
  openAssistant,
  OpenAssistantButton,
  useProvidePageContext,
} from '@grafana/assistant';
import { t } from '@grafana/i18n';
import { IconButton } from '@grafana/ui';
import type { RawContent } from '../../types/content.types';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { PLUGIN_BASE_URL } from '../../constants';
import { getOpenAssistant, useIsAssistantAvailable } from '../../integrations/assistant-integration/assistant-dev-mode';
import { buildCourseContext } from '../../integrations/assistant-integration/course-context';
import { buildDocumentContext } from '../../integrations/assistant-integration/assistant-context.utils';

interface ReaderAssistantProps {
  content: RawContent;
  activeTab: LearningJourneyTab | null;
}

function getReaderOrigin(course: ReturnType<typeof buildCourseContext>) {
  return course ? 'grafana-pathfinder-app/course' : 'grafana-pathfinder-app/guide';
}

function buildReaderContext(
  content: RawContent,
  course: ReturnType<typeof buildCourseContext>,
  includeExcerpt = false
) {
  if (course) {
    return [createAssistantContextItem('structured', { title: course.courseTitle, data: course })];
  }
  return buildDocumentContext(content, { includeExcerpt });
}

export function ReaderAssistantIconButton({ content, activeTab }: ReaderAssistantProps) {
  const label = t('fullScreen.askAssistant', 'Ask Assistant');

  const handleClick = () => {
    const course = buildCourseContext(content, activeTab);
    getOpenAssistant({
      origin: getReaderOrigin(course),
      prompt: t('fullScreen.assistantPrompt', 'What will I learn here?'),
      context: buildReaderContext(content, course, true),
      autoSend: false,
    });
  };

  return <IconButton name="ai-sparkle" size="sm" tooltip={label} aria-label={label} onClick={handleClick} />;
}

export function ReaderAssistant({ content, activeTab }: ReaderAssistantProps) {
  const available = useIsAssistantAvailable();
  const opened = useRef(false);
  const course = useMemo(() => buildCourseContext(content, activeTab), [content, activeTab]);
  const origin = getReaderOrigin(course);
  const context = useMemo(() => buildReaderContext(content, course), [content, course]);
  const questionContext = useMemo(
    () => (course ? context : buildReaderContext(content, null, true)),
    [content, context, course]
  );

  useProvidePageContext(`${PLUGIN_BASE_URL}/fullscreen`, context);

  useEffect(() => {
    if (available && course && !opened.current) {
      opened.current = true;
      openAssistant({ origin, autoSend: false });
    }
  }, [available, course, origin]);

  if (!available) {
    return null;
  }

  return (
    <OpenAssistantButton
      origin={origin}
      prompt={t('fullScreen.assistantPrompt', 'What will I learn here?')}
      context={questionContext}
      autoSend={false}
      size="sm"
      title={t('fullScreen.askAssistant', 'Ask Assistant')}
    />
  );
}
