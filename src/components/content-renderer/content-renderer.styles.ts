import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getSelectionStyles = (_theme: GrafanaTheme2) => css`
  ::selection {
    background-color: rgba(255, 136, 0, 0.3);
    color: inherit;
  }
`;
