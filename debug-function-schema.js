const MCPManager = require('./mcp-manager');
const MCPConfigManager = require('./mcp-config-manager');
const MCPFunctionAdapter = require('./mcp-function-adapter');

async function debugFunctionSchema() {
  console.log('Debugging function schema...');
  
  try {
    // Initialize MCP Manager
    const mcpConfigManager = new MCPConfigManager();
    const mcpManager = new MCPManager(mcpConfigManager);
    const mcpFunctionAdapter = new MCPFunctionAdapter(mcpManager);

    console.log('Initializing MCP Manager...');
    await mcpManager.initialize();
    
    console.log('Getting MCP functions...');
    const mcpFunctions = await mcpFunctionAdapter.getAllMCPFunctions();
    
    console.log(`\n📋 Found ${Object.keys(mcpFunctions).length} MCP functions`);
    
    // Examine the brave search function specifically
    const braveSearchFunction = mcpFunctions['mcp_brave-search_brave_web_search'];
    if (braveSearchFunction) {
      console.log('\n🔍 Brave Search Function Schema:');
      console.log('Function Name:', 'mcp_brave-search_brave_web_search');
      console.log('Description:', braveSearchFunction.description);
      console.log('Parameters Schema:');
      console.log(JSON.stringify(braveSearchFunction.params, null, 2));
      
      // Check if the schema is valid
      if (braveSearchFunction.params && braveSearchFunction.params.properties) {
        console.log('\n✅ Schema has properties:');
        Object.keys(braveSearchFunction.params.properties).forEach(prop => {
          const propDef = braveSearchFunction.params.properties[prop];
          console.log(`  - ${prop}: ${propDef.type} ${braveSearchFunction.params.required && braveSearchFunction.params.required.includes(prop) ? '(required)' : '(optional)'}`);
        });
      } else {
        console.log('\n❌ Schema is missing properties');
      }
    } else {
      console.log('\n❌ Brave search function not found');
      console.log('Available functions:', Object.keys(mcpFunctions));
    }
    
    // Test a simple function call manually
    console.log('\n🧪 Testing manual function call...');
    if (braveSearchFunction && braveSearchFunction.handler) {
      try {
        const testResult = await braveSearchFunction.handler({ query: "test" });
        console.log('✅ Manual function call succeeded');
        console.log('Result length:', typeof testResult === 'string' ? testResult.length : JSON.stringify(testResult).length);
        console.log('Result preview:', typeof testResult === 'string' ? testResult.substring(0, 200) : JSON.stringify(testResult).substring(0, 200));
      } catch (error) {
        console.log('❌ Manual function call failed:', error.message);
      }
    }
    
    await mcpManager.shutdown();
    console.log('\n✅ Debug complete');
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

if (require.main === module) {
  debugFunctionSchema().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { debugFunctionSchema };