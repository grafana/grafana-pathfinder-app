import React from 'react';
import { PluginConfigPageProps, AppPluginMeta } from '@grafana/data';
import { DocsPluginConfig } from '../../constants';
import ConfigurationForm from './ConfigurationForm';

type JsonData = DocsPluginConfig & {
  isDocsPasswordSet?: boolean;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const AppConfig = (props: AppConfigProps) => {
  return <ConfigurationForm {...props} />;
};

export default AppConfig;
