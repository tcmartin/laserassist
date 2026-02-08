const MCPManager = require('./mcp-manager.js');
const MCPConfigManager = require('./mcp-config-manager.js');

/**
 * Simple test with just filesystem server
 */
async function testSimpleMCP() {
  console.log('Testing MCP Manager with filesystem server...');

  try {
    // Create a simple config with just filesystem
    const configManager = new MCPConfigManager('.insighto/settings/mcp.json');
    
    // Create a test config with filesystem only
    const testConfig = {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          disabled: false,
          autoApprove: []
        }
      }
    };
    
    await configManager.saveConfig(testConfig);
    
    // Create MCP Manager
    const mcpManager = new MCPManager(configManager);
    
    // Add detailed event logging
    mcpManager.on('server-connected', (serverId, info) => {
      console.log(`✓ Server ${serverId} connected with ${info.tools.length} tools and ${info.resources.length} resources`);
      console.log('Tools:', info.tools.map(t => t.name));
      console.log('Resources:', info.resources.map(r => r.name));
    });
    
    mcpManager.on('server-error', (serverId, error) => {
      console.log(`✗ Server ${serverId} error:`, error.message);
    });
    
    mcpManager.on('server-disconnected', (serverId) => {
      console.log(`- Server ${serverId} disconnected`);
    });
    
    // Initialize
    console.log('Initializing MCP Manager...');
    await mcpManager.initialize();
    
    // Wait a bit for connections to establish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check status
    const status = mcpManager.getConnectionStatus();
    console.log('Final status:', status);
    
    // Get tools
    const tools = await mcpManager.getAllTools();
    console.log(`Total tools found: ${tools.length}`);
    tools.forEach(tool => {
      console.log(`- ${tool.name} (from ${tool.serverId}): ${tool.description || 'No description'}`);
    });
    
    // Test calling a tool if available
    if (tools.length > 0) {
      const firstTool = tools[0];
      console.log(`\nTesting tool call: ${firstTool.name}`);
      
      try {
        // Try to call the tool with minimal parameters
        const result = await mcpManager.callTool(firstTool.name, {});
        console.log('Tool result:', result);
      } catch (error) {
        console.log('Tool call failed (expected for some tools):', error.message);
      }
    }
    
    // Cleanup
    await mcpManager.shutdown();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run test
testSimpleMCP().catch(console.error);