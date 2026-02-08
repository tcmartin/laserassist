const MCPManager = require('./mcp-manager.js');
const MCPConfigManager = require('./mcp-config-manager.js');

/**
 * Final comprehensive test of MCP Manager
 */
async function testMCPFinal() {
  console.log('Final MCP Manager test...');

  try {
    const configManager = new MCPConfigManager('.insighto/settings/mcp.json');
    const mcpManager = new MCPManager(configManager);
    
    await mcpManager.initialize();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test with correct path
    console.log('\n1. Testing with allowed directory...');
    const testDir = '/private/tmp/mcp-test-' + Date.now();
    
    // Create directory
    const createResult = await mcpManager.callTool('create_directory', { path: testDir });
    console.log('✓ Directory created:', createResult.content[0].text);
    
    // Write file
    const testFile = testDir + '/test.txt';
    const writeResult = await mcpManager.callTool('write_file', { 
      path: testFile, 
      content: 'Hello from MCP Manager!' 
    });
    console.log('✓ File written:', writeResult.content[0].text);
    
    // Read file
    const readResult = await mcpManager.callTool('read_file', { path: testFile });
    console.log('✓ File content:', readResult.content[0].text);
    
    // List directory
    const listResult = await mcpManager.callTool('list_directory', { path: testDir });
    console.log('✓ Directory listing:', listResult.content[0].text);
    
    await mcpManager.shutdown();
    console.log('\n✅ MCP Manager implementation complete and working!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testMCPFinal().catch(console.error);