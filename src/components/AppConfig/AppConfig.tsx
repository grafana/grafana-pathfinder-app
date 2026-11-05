import { OrganizationGuideSettings } from '../OrganizationGuide/OrganizationGuideSettings';
import React from 'react';
import { PluginConfigPageProps, AppPluginMeta } from '@grafana/data';
import { PathfinderPluginConfig } from '../../constants';
import ConfigurationForm from './ConfigurationForm';

type JsonData = PathfinderPluginConfig & {
  isDocsPasswordSet?: boolean;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const AppConfig = (props: AppConfigProps) => {
  return (
    <>
      <ConfigurationForm {...props} />
      <OrganizationGuideSettings />
    </>
  );
};

export default AppConfig;
