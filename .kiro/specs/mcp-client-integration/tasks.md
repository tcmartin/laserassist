# Implementation Plan

- [x] 1. Install MCP client and create basic configuration

  - Install mcp-client package dependency
  - Create basic MCP configuration file at .insighto/settings/mcp.json
  - Implement simple configuration loading utility
  - _Requirements: 1.3, 5.1_

- [x] 2. Create MCP Manager for server connections

  - Implement MCPManager class with basic connection handling
  - Add support for stdio connection type (most common)
  - Implement simple tool discovery from connected servers
  - _Requirements: 5.1, 2.5_

- [x] 3. Integrate MCP tools with LLM function calling

  - Modify llm-worker.js to initialize MCP Manager
  - Convert MCP tools to node-llama-cpp function format
  - Combine MCP functions with existing local functions
  - _Requirements: 2.1, 6.1, 6.2_

- [x] 4. Add basic MCP settings UI

  - Create simple MCP server configuration interface
  - Add server enable/disable functionality
  - Implement basic connection testing
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 5. Add MCP tool indicators in chat

  - Show visual indicators when MCP tools are called
  - Display basic loading states for MCP operations
  - Handle and display MCP tool errors gracefully
  - _Requirements: 3.1, 3.3, 3.4_

- [ ] 6. Test and refine core functionality
  - Test MCP integration with a simple MCP server
  - Verify function calling works end-to-end
  - Add basic error handling and recovery
  - _Requirements: 2.2, 2.4, 5.4_
