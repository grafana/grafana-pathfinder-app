import React, { useEffect, useMemo, useRef } from 'react';
import {
  createAssistantContextItem,
  openAssistant,
  OpenAssistantButton,
  useProvidePageContext,
} from '@grafana/assistant';
import { t } from '@grafana/i18n';
import type { RawContent } from '../../types/content.types';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { PLUGIN_BASE_URL } from '../../constants';
import { useIsAssistantAvailable } from '../../integrations/assistant-integration/assistant-dev-mode';
import { buildCourseContext } from '../../integrations/assistant-integration/course-context';

export function CourseAssistant({ content, activeTab }: { content: RawContent; activeTab: LearningJourneyTab | null }) {
  const available = useIsAssistantAvailable();
  const opened = useRef(false);
  const data = useMemo(() => buildCourseContext(content, activeTab), [content, activeTab]);
  const context = useMemo(
    () =>
      data
        ? [
            createAssistantContextItem('structured', {
              title: data.courseTitle,
              data,
            }),
          ]
        : [],
    [data]
  );

  useProvidePageContext(`${PLUGIN_BASE_URL}/fullscreen`, context);

  useEffect(() => {
    if (available && data && !opened.current) {
      opened.current = true;
      openAssistant({ origin: 'grafana-pathfinder-app/course', autoSend: false });
    }
  }, [available, data]);

  if (!available || !data) {
    return null;
  }

  return (
    <OpenAssistantButton
      origin="grafana-pathfinder-app/course"
      prompt=""
      autoSend={false}
      size="sm"
      title={t('fullScreen.openAssistant', 'Open Grafana Assistant')}
    />
  );
}
