const MCPFunctionAdapter = require('./mcp-function-adapter');

/**
 * Test MCP error handling functionality
 */
function testMCPErrorHandling() {
  console.log('Testing MCP error handling...');

  // Test parameter validation
  console.log('\n1. Testing parameter validation:');
  const validParams = MCPFunctionAdapter.validateParameters({ key: 'value', empty: null, undef: undefined });
  console.log('✓ Valid parameters:', validParams);
  console.assert(validParams.key === 'value', 'Valid parameter should be preserved');
  console.assert(!validParams.hasOwnProperty('empty'), 'Null parameter should be removed');
  console.assert(!validParams.hasOwnProperty('undef'), 'Undefined parameter should be removed');

  // Test response formatting
  console.log('\n2. Testing response formatting:');
  
  // Test standard MCP response with content array
  const mcpResponse1 = {
    content: [
      { type: 'text', text: 'Hello world' },
      { type: 'image', data: 'base64data' }
    ]
  };
  const formatted1 = MCPFunctionAdapter.formatResponse(mcpResponse1, 'test_tool');
  console.log('✓ Formatted content array response:', formatted1);
  console.assert(formatted1.includes('Hello world'), 'Text content should be included');
  console.assert(formatted1.includes('[Image:'), 'Image should be formatted');

  // Test result-based response
  const mcpResponse2 = { result: 'Direct result' };
  const formatted2 = MCPFunctionAdapter.formatResponse(mcpResponse2, 'test_tool');
  console.log('✓ Formatted result response:', formatted2);
  console.assert(formatted2 === 'Direct result', 'Result should be returned directly');

  // Test string response
  const mcpResponse3 = 'Simple string response';
  const formatted3 = MCPFunctionAdapter.formatResponse(mcpResponse3, 'test_tool');
  console.log('✓ Formatted string response:', formatted3);
  console.assert(formatted3 === 'Simple string response', 'String should be returned as-is');

  // Test error handling
  console.log('\n3. Testing error handling:');
  
  const notFoundError = new Error('Tool not found');
  const errorMsg1 = MCPFunctionAdapter.handleError(notFoundError, 'missing_tool', 'test_server');
  console.log('✓ Not found error:', errorMsg1);
  console.assert(errorMsg1.includes('not available'), 'Should indicate tool is not available');

  const timeoutError = new Error('Request timeout');
  const errorMsg2 = MCPFunctionAdapter.handleError(timeoutError, 'slow_tool', 'test_server');
  console.log('✓ Timeout error:', errorMsg2);
  console.assert(errorMsg2.includes('timed out'), 'Should indicate timeout');

  const paramError = new Error('Invalid parameter: missing required field');
  const errorMsg3 = MCPFunctionAdapter.handleError(paramError, 'param_tool', 'test_server');
  console.log('✓ Parameter error:', errorMsg3);
  console.assert(errorMsg3.includes('invalid parameters'), 'Should indicate parameter issue');

  const genericError = new Error('Something went wrong');
  const errorMsg4 = MCPFunctionAdapter.handleError(genericError, 'generic_tool', 'test_server');
  console.log('✓ Generic error:', errorMsg4);
  console.assert(errorMsg4.includes('failed: Something went wrong'), 'Should include original error message');

  console.log('\n✅ All MCP error handling tests passed!');
}

// Run the test
if (require.main === module) {
  try {
    testMCPErrorHandling();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ MCP error handling test failed:', error.message);
    process.exit(1);
  }
}

module.exports = { testMCPErrorHandling };