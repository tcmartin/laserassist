const { Worker } = require('worker_threads');

/**
 * Test to get successful function calls working
 */
async function testSuccessfulFunctionCall() {
  console.log('Testing successful function call...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout'));
    }, 90000); // 90 seconds

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        console.log('✓ Worker ready');
        
        // Test with a very specific and simple function call instruction
        worker.postMessage({
          id: 'test-success',
          type: 'chat',
          prompt: `Please use the mcp_brave-search_brave_web_search function to search for "JavaScript". 

Call the function with exactly these parameters:
{
  "query": "JavaScript"
}

Do not include any optional parameters like count, offset, or freshness. Just use the required query parameter.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-success') {
        if (message.response) {
          console.log('✓ Function call test completed');
          console.log('Response length:', message.response.length);
          console.log('MCP tools used:', message.mcpToolsUsed ? message.mcpToolsUsed.length : 0);
          
          if (message.mcpToolsUsed && message.mcpToolsUsed.length > 0) {
            console.log('✅ SUCCESS: Function was called!');
            message.mcpToolsUsed.forEach((tool, index) => {
              console.log(`  ${index + 1}. ${tool.name} (${tool.serverId}) - ${tool.success ? 'SUCCESS' : 'FAILED'}`);
              if (!tool.success) {
                console.log(`     Error: ${tool.error}`);
              }
            });
          } else {
            console.log('❌ No function calls were made');
          }
          
          console.log('\nResponse preview:');
          console.log(message.response.substring(0, 500) + (message.response.length > 500 ? '...' : ''));
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            functionCalled: message.mcpToolsUsed && message.mcpToolsUsed.length > 0,
            toolsUsed: message.mcpToolsUsed ? message.mcpToolsUsed.length : 0,
            responseLength: message.response.length
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
    console.log('FUNCTION CALL SUCCESS TEST');
    console.log('='.repeat(50));

    const result = await testSuccessfulFunctionCall();
    console.log('\n✅ Test Results:', result);

    if (result.functionCalled) {
      console.log('\n🎉 SUCCESS: Function calling is working!');
    } else {
      console.log('\n❌ Function calling is not working properly');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runTest();
}

module.exports = { testSuccessfulFunctionCall };