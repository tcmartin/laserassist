const { Worker } = require('worker_threads');

/**
 * Test to examine function definitions being passed to the LLM
 */
async function testFunctionDefinitions() {
  console.log('Testing function definitions...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout'));
    }, 30000);

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        console.log('✓ Worker ready');
        
        // Test with a very direct function call instruction
        worker.postMessage({
          id: 'test-definitions',
          type: 'chat',
          prompt: `You have access to function calling. Please list all the functions you have available and then call the mcp_brave-search_brave_web_search function with the parameter {"query": "test"}.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-definitions') {
        if (message.response) {
          console.log('✓ Function definitions test completed');
          console.log('Response length:', message.response.length);
          console.log('MCP tools used:', message.mcpToolsUsed ? message.mcpToolsUsed.length : 0);
          
          console.log('\nFull response:');
          console.log(message.response);
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            functionCalled: message.mcpToolsUsed && message.mcpToolsUsed.length > 0,
            toolsUsed: message.mcpToolsUsed ? message.mcpToolsUsed.length : 0,
            response: message.response
          });
        } else if (message.error) {
          console.log('✗ Error:', message.error);
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: false,
            error: message.error
          });
        }
      } else if (message.type === 'error') {
        console.error('Worker error:', message.error);
        clearTimeout(testTimeout);
        worker.terminate();
        resolve({
          success: false,
          error: message.error
        });
      }
    });

    worker.on('error', (error) => {
      console.error('Worker thread error:', error);
      clearTimeout(testTimeout);
      resolve({
        success: false,
        error: error.message
      });
    });
  });
}

// Run the test
async function runTest() {
  try {
    console.log('='.repeat(50));
    console.log('FUNCTION DEFINITIONS TEST');
    console.log('='.repeat(50));

    const result = await testFunctionDefinitions();
    console.log('\n✅ Test Results:', result);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runTest();
}

module.exports = { testFunctionDefinitions };