const MCPManager = require('./mcp-manager.js');
const MCPConfigManager = require('./mcp-config-manager.js');

/**
 * Test MCP tool calling functionality
 */
async function testMCPToolCall() {
  console.log('Testing MCP tool calling...');

  try {
    const configManager = new MCPConfigManager('.insighto/settings/mcp.json');
    const mcpManager = new MCPManager(configManager);
    
    await mcpManager.initialize();
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test list_allowed_directories (no parameters needed)
    console.log('\n1. Testing list_allowed_directories...');
    const allowedDirs = await mcpManager.callTool('list_allowed_directories');
    console.log('Allowed directories:', allowedDirs);
    
    // Test list_directory with /tmp
    console.log('\n2. Testing list_directory...');
    const dirListing = await mcpManager.callTool('list_directory', { path: '/tmp' });
    console.log('Directory listing:', dirListing);
    
    // Test create_directory
    console.log('\n3. Testing create_directory...');
    const testDir = '/tmp/mcp-test-' + Date.now();
    const createResult = await mcpManager.callTool('create_directory', { path: testDir });
    console.log('Create directory result:', createResult);
    
    // Test write_file
    console.log('\n4. Testing write_file...');
    const testFile = testDir + '/test.txt';
    const writeResult = await mcpManager.callTool('write_file', { 
      path: testFile, 
      content: 'Hello from MCP Manager test!' 
    });
    console.log('Write file result:', writeResult);
    
    // Test read_file
    console.log('\n5. Testing read_file...');
    const readResult = await mcpManager.callTool('read_file', { path: testFile });
    console.log('Read file result:', readResult);
    
    // Test get_file_info
    console.log('\n6. Testing get_file_info...');
    const fileInfo = await mcpManager.callTool('get_file_info', { path: testFile });
    console.log('File info result:', fileInfo);
    
    await mcpManager.shutdown();
    console.log('\n✅ All tool calls completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testMCPToolCall().catch(console.error);