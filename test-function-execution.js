const MCPManager = require('./mcp-manager.js');
const MCPConfigManager = require('./mcp-config-manager.js');
const MCPFunctionAdapter = require('./mcp-function-adapter.js');

/**
 * Test direct function execution
 */
async function testFunctionExecution() {
  console.log('Testing direct MCP function execution...');

  try {
    // Initialize MCP components
    const configManager = new MCPConfigManager('.insighto/settings/mcp.json');
    const mcpManager = new MCPManager(configManager);
    const mcpFunctionAdapter = new MCPFunctionAdapter(mcpManager);
    
    // Initialize MCP
    await mcpManager.initialize();
    
    // Wait for connections
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get MCP functions
    const mcpFunctions = await mcpFunctionAdapter.getAllMCPFunctions();
    console.log(`Available functions: ${Object.keys(mcpFunctions).join(', ')}`);
    
    // Debug: Check what's actually in the functions object
    console.log('\nFunction object keys and types:');
    for (const [key, value] of Object.entries(mcpFunctions)) {
      console.log(`${key}: ${typeof value} (handler: ${typeof value.handler})`);
    }
    
    // Test calling brave_web_search directly
    const braveSearchFunction = mcpFunctions['mcp_brave-search_brave_web_search'];
    console.log(`\nbraveSearchFunction type: ${typeof braveSearchFunction}`);
    if (braveSearchFunction && braveSearchFunction.handler) {
      console.log('\nTesting brave_web_search function...');
      
      try {
        const result = await braveSearchFunction.handler({
          query: 'JavaScript tutorials'
        });
        console.log('Function result:', result);
      } catch (error) {
        console.error('Function call error:', error.message);
      }
    }
    
    // Test calling with missing parameters
    if (braveSearchFunction && braveSearchFunction.handler) {
      console.log('\nTesting brave_web_search with missing parameters...');
      
      try {
        const result = await braveSearchFunction.handler({});
        console.log('Function result:', result);
      } catch (error) {
        console.error('Expected error:', error.message);
      }
    }
    
    // Cleanup
    await mcpManager.shutdown();
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run test
testFunctionExecution().catch(console.error);