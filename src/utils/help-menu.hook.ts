import { useSelector } from 'react-redux';
import { cloneDeep } from 'lodash';
import { config } from '@grafana/runtime';
import { NavModelItem } from '@grafana/data';
import { t } from '@grafana/i18n';

interface HelpMenuItem {
  key: string;
  label: string;
  icon: string;
  href?: string;
  onClick?: () => void;
}

interface HelpMenuData {
  items: HelpMenuItem[];
  subtitle?: string;
}

// Copied from https://github.com/grafana/grafana/blob/2b8c74d/public/app/core/components/Footer/Footer.tsx#L17
// Get footer links.
function getFooterLinks(): NavModelItem[] {
  return [
    {
      text: t('nav.help/documentation', 'Documentation'),
      icon: 'document-info',
      url: 'https://grafana.com/docs/grafana/latest/?utm_source=grafana_pathfinder',
      target: '_blank',
    },
    {
      text: t('nav.help/support', 'Support'),
      icon: 'question-circle',
      url: 'https://grafana.com/products/enterprise/?utm_source=grafana_pathfinder',
      target: '_blank',
    },
    {
      text: t('nav.help/community', 'Community'),
      icon: 'comments-alt',
      url: 'https://community.grafana.com/?utm_source=grafana_pathfinder',
      target: '_blank',
    },
  ];
}

// Copied from https://github.com/grafana/grafana/blob/2b8c74d/public/app/core/components/AppChrome/MegaMenu/utils.ts#L130
// Get edition and update links.
export function getEditionAndUpdateLinks(): NavModelItem[] {
  const { buildInfo, licenseInfo } = config;
  const stateInfo = licenseInfo.stateInfo ? ` (${licenseInfo.stateInfo})` : '';
  const links: NavModelItem[] = [];

  links.push({
    target: '_blank',
    id: 'version',
    text: `${buildInfo.edition}${stateInfo}`,
    url: licenseInfo.licenseUrl,
    icon: 'external-link-alt',
  });

  if (buildInfo.hasUpdate) {
    links.push({
      target: '_blank',
      id: 'updateVersion',
      text: `New version available!`,
      icon: 'download-alt',
      url: 'https://grafana.com/grafana/download?utm_source=grafana_pathfinder',
    });
  }

  return links;
}

// Copied from https://github.com/grafana/grafana/blob/2b8c74d/public/app/core/components/AppChrome/MegaMenu/utils.ts#L16
// Enrich help item.
function enrichHelpItem(helpItem: NavModelItem): NavModelItem {
  let menuItems = helpItem.children || [];

  if (helpItem.id === 'help') {
    helpItem.children = [
      ...menuItems,
      ...getFooterLinks(),
      ...getEditionAndUpdateLinks(),
      // No keyboard shortcuts until Grafana exposes that for us.
    ];
  }
  return helpItem;
}

export function useGrafanaHelpMenu(): HelpMenuData {
  const navIndex = useSelector((state: any) => state.navIndex);

  if (!navIndex || !navIndex['help']) {
    return { items: [] };
  }

  const helpNode = cloneDeep(navIndex['help']);
  const enrichedHelpNode = enrichHelpItem(helpNode);

  const helpMenuItems: HelpMenuItem[] = (enrichedHelpNode.children || []).map((item) => ({
    key: item.id || item.text,
    label: item.text,
    icon: item.icon || 'question-circle',
    href: item.url,
    onClick: item.onClick,
  }));

  return {
    items: helpMenuItems,
    subtitle: enrichedHelpNode.subTitle,
  };
}
