to_entries[]
| .key as $id
| .value
| {
    id: $id,
    path,
    type,
    title,
    description,
    category,
    author_name: .author.name,
    author_team: .author.team,
    starting_location: .startingLocation,
    estimated_minutes: .estimatedMinutes,
    min_grafana_version: .minGrafanaVersion,
    milestones: (.milestones // []),
    provides: (.provides // []),
    depends,
    recommends,
    suggests,
    tracks,
    prerequisites,
    targeting,
    test_environment: .testEnvironment,
    stats_version: .stats.version,
    block_count: .stats.blockCount,
    section_count: .stats.sectionCount,
    completable_block_count: .stats.completableBlockCount,
    final_completable_position: .stats.finalCompletablePosition,
    loaded_at: $loaded_at
  }
