import React, { useMemo } from "react";
import { NavModelItem, usePluginContext } from "@grafana/data";
import { CombinedLearningJourneyPanel } from "components/docs-panel/docs-panel";
import { getConfigWithDefaults } from '../../constants';

export default function MemoizedContextPanel({ helpNode }: { helpNode?: NavModelItem }) {
    const pluginContext = usePluginContext();
    const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
    const panel = useMemo(() => new CombinedLearningJourneyPanel(config, helpNode), [config, helpNode]);

    return (
        <panel.Component model={panel} />
    );
}