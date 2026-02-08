# Implementation Plan

- [x] 1. Create basic global shortcut functionality

  - Add Electron globalShortcut import to main process
  - Register Ctrl+Shift+Space (Cmd+Shift+Space on Mac) as global shortcut
  - Implement simple window.hide() and window.show() toggle function
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [ ] 2. Add window state preservation

  - Save window bounds and maximized state before hiding
  - Restore window position and state when showing
  - Ensure window focuses properly when shown
  - _Requirements: 4.1, 4.2, 4.4_

- [ ] 3. Handle shortcut registration errors

  - Add try/catch around globalShortcut.register()
  - Log error message if shortcut registration fails
  - Provide fallback message to user if shortcut conflicts
  - _Requirements: 3.2, 3.4_

- [ ] 4. Add basic cross-platform support

  - Detect platform (process.platform) and use appropriate modifier keys
  - Use Cmd+Shift+Space on macOS, Ctrl+Shift+Space on Windows/Linux
  - Test functionality on different platforms
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 5. Clean up on app exit
  - Unregister global shortcut when application closes
  - Add proper cleanup in app 'before-quit' event handler
  - _Requirements: 1.3_
