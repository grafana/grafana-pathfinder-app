# PR Tester

The PR Tester component enables developers to test content changes from GitHub Pull Requests before they are merged, streamlining the content review workflow.

## Overview

PR Tester fetches content.json files from GitHub PRs and opens them in the plugin for testing. It supports testing individual guides, opening all PR guides at once, or creating ordered learning paths for sequential testing.

## Location

**Path**: `/src/components/PrTester/`
**Main Component**: `PrTester.tsx`
**API Module**: `github-api.ts`

## Purpose

PR Tester exists to:

- Validate content changes before merging PRs
- Test interactive guides in production-like environment
- Review multiple guides from a single PR efficiently
- Create temporary learning paths for sequential testing
- Catch content errors early in the review process
- Reduce friction in content contribution workflow

## Key Features

### PR URL Input

- **URL Validation**: Validates GitHub PR URL format
- **State Persistence**: Remembers last tested PR URL
- **Auto-detection**: Recognizes GitHub PR URL patterns
- **Error Feedback**: Clear error messages for invalid URLs

### Three Testing Modes

**Single Mode** (default)

- Test one guide at a time
- Select guide from dropdown
- Best for focused review
- Remembers last selected guide

**Open All Mode**

- Opens all PR guides in separate tabs
- Quick overview of all changes
- Efficient for small PRs
- Tabs open sequentially

**Learning Path Mode**

- Create ordered sequence of guides
- Drag-and-drop reordering
- Test guides in logical sequence
- Opens as connected learning path
- Ideal for multi-guide PRs

### Content File Detection

- **Automatic Discovery**: Fetches all content.json files from PR
- **File Filtering**: Shows only valid content files
- **Metadata Display**: Shows guide titles and descriptions
- **File Count**: Displays number of guides found

### State Persistence

All state persists to localStorage:

- PR URL input
- Selected testing mode
- Fetched file list
- Selected file (single mode)
- File order (path mode)

## Architecture

### Core Components

**PrTester.tsx** - Main testing interface

- PR URL input and validation
- Mode selection radio buttons
- File dropdown (single mode)
- File list with drag-and-drop (path mode)
- Test/Open buttons
- Success/error feedback

### GitHub API Module

**github-api.ts** - GitHub API integration

- PR URL parsing
- GitHub API requests
- Content file fetching
- Raw content retrieval
- Error handling

**Functions:**

- `isValidPrUrl(url)` - Validates PR URL format
- `fetchPrContentFilesFromUrl(url)` - Fetches content files from PR
- `parsePrUrl(url)` - Extracts owner, repo, PR number
- `fetchPrFiles(owner, repo, prNumber)` - Gets PR file list
- `fetchContentFile(owner, repo, ref, path)` - Fetches content.json

## Testing Modes

### Single Mode

**Use Case**: Testing individual guides, focused review

**Flow:**

1. Paste PR URL
2. Click "Fetch PR"
3. Select guide from dropdown
4. Click "Test Guide"
5. Guide opens in content tab

**Best For:**

- Detailed guide review
- Step-by-step testing
- Iterative feedback cycles

### Open All Mode

**Use Case**: Quick overview, small PRs

**Flow:**

1. Paste PR URL
2. Click "Fetch PR"
3. Select "Open All" mode
4. Click "Open All Guides"
5. All guides open in separate tabs

**Best For:**

- Small PRs (1-3 guides)
- Quick visual inspection
- Comparing guide styles

### Learning Path Mode

**Use Case**: Sequential testing, related guides

**Flow:**

1. Paste PR URL
2. Click "Fetch PR"
3. Select "Learning Path" mode
4. Drag files to reorder
5. Click "Create Learning Path"
6. Opens as connected journey with navigation

**Best For:**

- Multi-guide PRs
- Sequential content
- Path-based content
- Testing navigation flow

## Data Collected

The PR Tester stores:

- **PR URL**: Last tested PR URL
- **Test Mode**: Selected mode (single/all/path)
- **Fetched Files**: Content file list from PR
- **Fetched URL**: URL that generated current file list
- **Selected File**: Current selection (single mode)
- **Ordered Files**: User's file order (path mode)

All data stored in browser localStorage with these keys:

- `pathfinder-pr-tester-url`
- `pathfinder-pr-tester-mode`
- `pathfinder-pr-tester-files`
- `pathfinder-pr-tester-fetched-url`
- `pathfinder-pr-tester-selected`
- `pathfinder-pr-tester-ordered-files`

## Integration Points

### SelectorDebugPanel

PR Tester is embedded in the dev tools panel:

- Loaded lazily to keep bundle size small
- Only available in dev mode
- Accessed via "PR tester" section
- Shares tab opening callbacks with main panel

### Docs Panel Integration

- Uses `onOpenDocsPage` callback to open guides
- Uses `onOpenLearningJourney` callback for path mode
- Integrates with existing tab system
- Respects content security policies

### GitHub Integration

- Fetches PR metadata via GitHub API
- Retrieves file lists from PR
- Fetches raw content from PR branch
- No authentication required (public repos)
- Rate limiting handled gracefully

### Content System

- Content files must be valid JSON guides
- URLs converted to raw.githubusercontent.com format
- Content validated before opening
- Integrates with content renderer

## GitHub API Usage

### Endpoints Used

**List PR Files:**

```
GET /repos/{owner}/{repo}/pulls/{pr_number}/files
```

**Fetch File Content:**

```
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
```

### Rate Limiting

- Public API: 60 requests/hour (unauthenticated)
- Errors displayed if rate limit exceeded
- Uses conditional requests where possible
- Caches file lists to reduce API calls

### PR URL Format

Supported formats:

- `https://github.com/{owner}/{repo}/pull/{number}`
- `https://github.com/{owner}/{repo}/pulls/{number}`

Extracted information:

- Repository owner
- Repository name
- PR number
- Branch name (from API response)

## Dependencies

### Core Dependencies

- **React**: UI framework
- **@grafana/ui**: Grafana UI components (Input, Select, Button, RadioButtonGroup)
- **@grafana/data**: Data types (SelectableValue)

### Internal Dependencies

- **Content System**: Opens guides in tabs
- **Security**: URL validation (`isGitHubRawUrl`)
- **SelectorDebugPanel**: Container component

## Error Handling

**Invalid PR URL:**

- Clear error message
- Suggests correct format
- Prevents API call

**API Errors:**

- Network failures displayed
- Rate limit warnings
- Invalid response handling

**Content Errors:**

- Invalid JSON detected
- Missing required fields
- Malformed content

**No Content Files:**

- Message if PR has no content.json files
- Suggestions for what to check

## Usage Flow

### Testing a PR

1. Copy PR URL from GitHub
2. Open dev tools (dev mode enabled)
3. Expand "PR tester" section
4. Paste URL and click "Fetch PR"
5. Wait for files to load
6. Select testing mode
7. Configure options (select file, reorder, etc.)
8. Click test/open button
9. Review guides in tabs

### Iterative Testing

1. Test guides from PR
2. Find issues, comment on PR
3. Author updates PR
4. Refresh PR tester (re-fetch)
5. Test updated guides
6. Repeat until approved

## See Also

- `docs/developer/components/SelectorDebugPanel/` - Dev tools container
- `docs/developer/CONTENT_SECURITY.md` - Content security policies
- `docs/developer/components/block-editor/` - Guide authoring tool
