const MCPManager = require('./mcp-manager.js');
const MCPConfigManager = require('./mcp-config-manager.js');

/**
 * Test MCP Manager functionality
 */
async function testMCPManager() {
  console.log('Testing MCP Manager...');

  try {
    // Create config manager with test configuration
    const configManager = new MCPConfigManager('.insighto/settings/mcp.json');
    
    // Load existing config or create default
    await configManager.loadConfig();
    
    // Create MCP Manager
    const mcpManager = new MCPManager(configManager);
    
    // Test initialization
    console.log('1. Testing initialization...');
    await mcpManager.initialize();
    console.log('✓ MCP Manager initialized successfully');
    
    // Test getting connection status
    console.log('2. Testing connection status...');
    const status = mcpManager.getConnectionStatus();
    console.log('Connection status:', status);
    console.log('✓ Connection status retrieved');
    
    // Test getting all tools (should be empty if no servers configured)
    console.log('3. Testing tool discovery...');
    const tools = await mcpManager.getAllTools();
    console.log(`Found ${tools.length} tools across all servers`);
    console.log('✓ Tool discovery completed');
    
    // Test getting all resources
    console.log('4. Testing resource discovery...');
    const resources = await mcpManager.getAllResources();
    console.log(`Found ${resources.length} resources across all servers`);
    console.log('✓ Resource discovery completed');
    
    // Test event handling
    console.log('5. Testing event handling...');
    let eventReceived = false;
    mcpManager.on('server-connected', (serverId, info) => {
      console.log(`Server connected event: ${serverId}`, info);
      eventReceived = true;
    });
    
    mcpManager.on('server-disconnected', (serverId) => {
      console.log(`Server disconnected event: ${serverId}`);
    });
    
    mcpManager.on('tool-called', (info) => {
      console.log('Tool called event:', info);
    });
    
    console.log('✓ Event listeners registered');
    
    // Test shutdown
    console.log('6. Testing shutdown...');
    await mcpManager.shutdown();
    console.log('✓ MCP Manager shutdown completed');
    
    console.log('\n✅ All MCP Manager tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testMCPManager().catch(console.error);
}

module.exports = { testMCPManager };