# Design Document

## Overview

This design transforms the current monolithic UI into a modular, overlay-based interface that provides a cleaner, more focused user experience. The new architecture follows modern UI patterns with a compact initial state, contextual panels, and session-based organization. The design emphasizes progressive disclosure, where functionality appears contextually based on user actions and recording state.

## Architecture

### UI State Management

The interface operates in three primary states:

1. **Compact State**: Minimal overlay with essential controls only
2. **Recording State**: Expanded interface with live panels and recording controls
3. **Review State**: Session-based interface for reviewing past conversations

### Component Hierarchy

```
MainOverlay
├── CompactHeader (always visible)
├── RecordingControls (contextual)
├── PanelManager (manages floating panels)
│   ├── LiveInsightsPanel
│   ├── TranscriptPanel
│   ├── SummaryPanel
│   └── SettingsPanel
└── SessionManager (handles conversation storage)
```

### State Transitions

- **Idle → Recording**: User clicks record, UI expands to show contextual panels
- **Recording → Paused**: Recording controls update, panels remain visible
- **Recording → Stopped**: UI contracts to compact state, session is saved
- **Compact → Review**: User accesses past sessions, review interface loads

## Components and Interfaces

### 1. CompactHeader Component

**Purpose**: Always-visible minimal interface that serves as the entry point

**Interface**:
```javascript
interface CompactHeaderProps {
  recordingState: 'idle' | 'recording' | 'paused';
  onRecordStart: () => void;
  onShowSettings: () => void;
  onShowSessions: () => void;
}
```

**Visual Design**:
- Small, rounded overlay (approximately 200x60px)
- Semi-transparent background with blur effect
- Essential controls: Record button, Settings access, Sessions access
- Visual recording indicator when active

### 2. RecordingControls Component

**Purpose**: Contextual controls that appear during recording sessions

**Interface**:
```javascript
interface RecordingControlsProps {
  recordingState: 'recording' | 'paused';
  duration: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}
```

**Features**:
- Pause/Resume toggle button
- Stop recording button
- Recording duration display
- Visual recording status indicator

### 3. PanelManager Component

**Purpose**: Manages the display and positioning of contextual panels

**Interface**:
```javascript
interface PanelManagerProps {
  activePanels: Set<PanelType>;
  panelData: Record<PanelType, any>;
  onPanelToggle: (panel: PanelType) => void;
  onPanelClose: (panel: PanelType) => void;
}

type PanelType = 'insights' | 'transcript' | 'summary' | 'settings';
```

**Layout Strategy**:
- Panels appear as floating overlays near the main interface
- Smart positioning to avoid screen edge conflicts
- Panel stacking and z-index management
- Responsive sizing based on content and screen space

### 4. LiveInsightsPanel Component

**Purpose**: Real-time AI analysis during recording

**Interface**:
```javascript
interface LiveInsightsPanelProps {
  insights: InsightData[];
  isAnalyzing: boolean;
  onRefresh: () => void;
  onExpand: () => void;
}

interface InsightData {
  type: 'summary' | 'suggestion' | 'activity';
  content: string;
  timestamp: number;
  confidence: number;
}
```

**Features**:
- Live updating content during recording
- Categorized insights (summaries, suggestions, activities)
- Manual refresh capability
- Expandable to full-screen view

### 5. TranscriptPanel Component

**Purpose**: Live transcript display with history

**Interface**:
```javascript
interface TranscriptPanelProps {
  transcript: TranscriptSegment[];
  isRecording: boolean;
  onSearch: (query: string) => void;
  onExport: () => void;
}

interface TranscriptSegment {
  text: string;
  timestamp: number;
  speaker?: string;
  confidence: number;
}
```

**Features**:
- Auto-scrolling live transcript
- Search functionality
- Export capabilities
- Speaker identification (when available)

### 6. SessionManager Component

**Purpose**: Handles conversation storage and retrieval

**Interface**:
```javascript
interface SessionManagerProps {
  sessions: ConversationSession[];
  currentSession?: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionExport: (sessionId: string) => void;
}

interface ConversationSession {
  id: string;
  title: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  transcript: TranscriptSegment[];
  insights: InsightData[];
  summary?: string;
}
```

## Data Models

### Session Storage Schema

```javascript
// IndexedDB Schema
const SessionStore = {
  name: 'ConversationSessions',
  keyPath: 'id',
  indexes: [
    { name: 'startTime', keyPath: 'startTime' },
    { name: 'title', keyPath: 'title' }
  ]
};

// Session Data Structure
interface StoredSession {
  id: string;
  metadata: {
    title: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    tags: string[];
  };
  content: {
    transcript: TranscriptSegment[];
    insights: InsightData[];
    summary: string;
    keyPoints: string[];
  };
  settings: {
    analysisEnabled: boolean;
    autoSummary: boolean;
    language: string;
  };
}
```

### UI State Management

```javascript
// Global UI State
interface UIState {
  mode: 'compact' | 'recording' | 'review';
  activePanels: Set<PanelType>;
  recordingState: 'idle' | 'recording' | 'paused';
  currentSession?: string;
  panelPositions: Record<PanelType, Position>;
}

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## Error Handling

### Recording Errors
- Microphone access denied: Show permission request with instructions
- Recording device unavailable: Fallback to system default or show device selector
- Storage quota exceeded: Prompt user to clean up old sessions

### Analysis Errors
- LLM unavailable: Graceful degradation with cached insights
- Network connectivity issues: Queue analysis requests for retry
- Rate limiting: Show user-friendly delay messages

### Panel Management Errors
- Panel positioning conflicts: Automatic repositioning algorithm
- Memory constraints: Lazy loading of panel content
- Rendering errors: Fallback to simplified panel views

## Testing Strategy

### Unit Testing
- Component rendering with various props
- State management logic
- Data transformation functions
- Storage operations (mocked IndexedDB)

### Integration Testing
- Panel interaction workflows
- Recording state transitions
- Session save/load operations
- Cross-panel data synchronization

### User Experience Testing
- Compact to expanded state transitions
- Panel positioning on different screen sizes
- Keyboard navigation and accessibility
- Performance with long recording sessions

### Performance Testing
- Memory usage during extended recording
- Panel rendering performance
- Storage operation efficiency
- UI responsiveness under load

## Implementation Phases

### Phase 1: Core Architecture
- Implement new component structure
- Create state management system
- Build compact header interface
- Basic recording controls

### Phase 2: Panel System
- Develop panel manager
- Implement floating panel positioning
- Create basic transcript and insights panels
- Panel show/hide animations

### Phase 3: Session Management
- Build session storage system
- Implement session list interface
- Add session metadata and search
- Export functionality

### Phase 4: Polish and Optimization
- Smooth animations and transitions
- Accessibility improvements
- Performance optimizations
- User preference persistence

## Accessibility Considerations

- Keyboard navigation for all interactive elements
- Screen reader support for dynamic content
- High contrast mode compatibility
- Focus management during state transitions
- ARIA labels for contextual panels

## Performance Considerations

- Lazy loading of panel content
- Virtual scrolling for long transcripts
- Debounced analysis requests
- Efficient DOM updates using React/Vue patterns
- Memory management for session data