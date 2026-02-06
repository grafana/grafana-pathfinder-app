# Learning Paths

The Learning Paths component system provides gamified learning experiences with progress tracking, achievement badges, and streak mechanics to encourage continued learning.

## Overview

Learning Paths transform documentation consumption into an engaging learning experience by providing structured paths, tracking progress, rewarding achievements, and maintaining engagement through streaks.

## Location

**Path**: `/src/components/LearningPaths/`
**Main Component**: `LearningPathsPanel.tsx`

## Purpose

Learning Paths exist to:

- Provide structured learning experiences through curated paths
- Track user progress across guides and milestones
- Motivate continued learning through badges and streaks
- Celebrate achievements and learning milestones
- Offer personalized learning dashboard
- Increase documentation engagement and retention

## Key Features

### Learning Path Cards

- **Path Overview**: Visual cards showing path title, description, and icon
- **Progress Tracking**: Progress rings showing completion percentage
- **Continue Button**: Quick access to resume learning
- **Completion Status**: Visual indication of completed paths

### Badge System

- **Achievement Badges**: Unlock badges for completing paths and milestones
- **Badge Collection**: View all available and earned badges
- **Unlock Celebrations**: Toast notifications for newly earned badges
- **Badge Details**: See requirements and unlock criteria

### Streak Tracking

- **Daily Streaks**: Track consecutive days of learning activity
- **Streak Indicators**: Visual display of current streak count
- **Streak Maintenance**: Encourages daily return to maintain streaks
- **Streak History**: Track longest streak achievements

### Progress Dashboard

- **My Learning Tab**: Personalized dashboard showing all learning activity
- **Path Progress**: Individual progress for each learning path
- **Recent Activity**: Quick access to recently viewed guides
- **Completion Statistics**: Overall completion metrics

## Architecture

### Core Components

**LearningPathsPanel.tsx** - Main panel component

- Displays learning path cards
- Manages badge modals
- Shows streak indicators
- Handles guide navigation

**LearningPathCard.tsx** - Individual path card

- Path metadata display
- Progress visualization
- Continue/start actions

**MyLearningTab.tsx** - Learning dashboard

- User's personal learning view
- Progress overview
- Path management

**BadgesDisplay.tsx** - Badge collection view

- Grid of all badges
- Locked/unlocked states
- Badge metadata

**BadgeUnlockedToast.tsx** - Achievement celebration

- Toast notification for new badges
- Badge details display
- Dismissal handling

**StreakIndicator.tsx** - Streak display

- Current streak count
- Flame icon visualization
- Streak milestone indicators

**ProgressRing.tsx** - Progress visualization

- Circular progress indicator
- Percentage display
- Color-coded completion status

**BadgeDetailCard.tsx** - Badge detail view

- Badge requirements
- Unlock criteria
- Achievement date

### Utilities

**badge-utils.ts** - Badge logic utilities

- Badge unlock calculation
- Progress evaluation
- Badge metadata management

## Data Collected

### Learning Progress

- **Completed Guides**: List of guide IDs user has completed
- **Path Progress**: Completion percentage for each path
- **Current Position**: Last viewed guide in each path
- **Completion Timestamps**: When guides were completed

### Badge Data

- **Earned Badges**: List of unlocked badge IDs
- **Unlock Dates**: When each badge was earned
- **Pending Celebrations**: Badges awaiting celebration display
- **Badge Dismissals**: Tracked to avoid re-showing celebrations

### Streak Information

- **Current Streak**: Number of consecutive days with activity
- **Longest Streak**: Best streak achievement
- **Last Activity Date**: Most recent learning activity
- **Streak Start Date**: When current streak began

All data is stored using the user storage system (`/src/lib/user-storage/`) which uses browser localStorage with per-user isolation.

## Integration Points

### User Storage System

Learning Paths deeply integrates with the user storage system:

- `learningProgressStorage` - Guide and path completion
- `interactiveStepStorage` - Step-level progress
- `interactiveCompletionStorage` - Interactive guide completions
- `useUserStorage` hook - Reactive storage access

### Content System

- Reads guide definitions from learning path configurations
- Maps guide IDs to content URLs
- Tracks milestone completion within journeys
- Integrates with journey progress calculation

### Docs Panel

- Learning Paths accessed via "My Learning" tab
- Opens guides in content tabs
- Shares progress tracking infrastructure
- Coordinates navigation with tab system

### Analytics

Reports learning events:

- Guide completions
- Badge unlocks
- Streak milestones
- Path progress updates

## Learning Path Configuration

Learning paths are configured in `/src/learning-paths/`:

- **Path Definitions**: Metadata, guides, requirements
- **Badge Definitions**: Badge metadata, unlock criteria
- **Guide Mapping**: Guide IDs to content URLs

Each path includes:

- `id` - Unique path identifier
- `title` - Display name
- `description` - Path overview
- `icon` - Visual identifier
- `guides` - Ordered list of guide IDs
- `requiredBadges` - Badges to unlock on completion

## Badge System

Badges are earned through:

- **Path Completion**: Complete all guides in a path
- **Milestone Achievement**: Reach specific progress milestones
- **Streak Goals**: Maintain learning streaks
- **Special Achievements**: Complete specific guide sequences

Badge types:

- **Path Badges**: Tied to specific learning paths
- **Milestone Badges**: Progress-based achievements
- **Streak Badges**: Consistency rewards
- **Special Badges**: Unique achievements

## Streak Mechanics

Streaks are maintained by:

- **Daily Activity**: Any guide progress counts
- **Timezone Handling**: Uses user's local timezone
- **Grace Period**: 24-hour window for activity
- **Reset Conditions**: No activity for 24+ hours breaks streak

Streak levels:

- **Beginner**: 1-6 days
- **Intermediate**: 7-13 days
- **Advanced**: 14-29 days
- **Expert**: 30+ days

## Dependencies

### Core Dependencies

- **React**: UI framework
- **@grafana/ui**: Grafana UI components
- **@grafana/data**: Data types

### Internal Dependencies

- **User Storage**: Progress and badge persistence
- **Learning Paths Config**: Path and badge definitions
- **Content System**: Guide content retrieval
- **Analytics**: Event tracking

## Usage Flow

### Starting a Learning Path

1. User navigates to "My Learning" tab
2. Selects a learning path card
3. Clicks "Continue" or "Start"
4. Guide opens in content tab
5. Progress tracked automatically

### Earning a Badge

1. User completes required guides/milestones
2. System evaluates badge criteria
3. Badge unlocked and stored
4. Toast celebration appears
5. Badge added to collection

### Maintaining a Streak

1. User returns daily to plugin
2. Views or completes any guide
3. Streak counter increments
4. Streak indicator updates
5. Milestone badges unlock at thresholds

## See Also

- `docs/developer/USER_STORAGE.md` - Storage system documentation
- `src/learning-paths/` - Path and badge configuration
- `docs/developer/components/docs-panel/` - Content panel integration
