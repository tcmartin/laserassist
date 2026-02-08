const { Worker } = require('worker_threads');

/**
 * Test with very simple function call instructions
 */
async function testSimpleFunctionCall() {
  console.log('Testing simple function call...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout'));
    }, 45000); // 45 seconds

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        console.log('✓ Worker ready');
        
        // Test with extremely simple and direct instruction
        worker.postMessage({
          id: 'test-simple',
          type: 'chat',
          prompt: `Call the function mcp_brave-search_brave_web_search with this exact JSON:
{"query": "test"}

Do not add any other parameters. Just call the function with exactly that JSON.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-simple') {
        if (message.response) {
          console.log('✓ Simple function call test completed');
          console.log('Response length:', message.response.length);
          console.log('MCP tools used:', message.mcpToolsUsed ? message.mcpToolsUsed.length : 0);
          
          if (message.mcpToolsUsed && message.mcpToolsUsed.length > 0) {
            console.log('🎉 SUCCESS: Function was called!');
            message.mcpToolsUsed.forEach((tool, index) => {
              console.log(`  ${index + 1}. ${tool.name} (${tool.serverId}) - ${tool.success ? 'SUCCESS' : 'FAILED'}`);
              if (tool.success) {
                console.log(`     Duration: ${tool.duration}ms`);
              } else {
                console.log(`     Error: ${tool.error}`);
              }
            });
          } else {
            console.log('❌ No function calls were made');
          }
          
          console.log('\nResponse preview:');
          console.log(message.response.substring(0, 300) + (message.response.length > 300 ? '...' : ''));
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            functionCalled: message.mcpToolsUsed && message.mcpToolsUsed.length > 0,
            toolsUsed: message.mcpToolsUsed ? message.mcpToolsUsed.length : 0,
            responseLength: message.response.length,
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
    console.log('SIMPLE FUNCTION CALL TEST');
    console.log('='.repeat(50));

    const result = await testSimpleFunctionCall();
    console.log('\n✅ Test Results:', result);

    if (result.functionCalled) {
      console.log('\n🎉 SUCCESS: Function calling is working!');
    } else {
      console.log('\n❌ Function calling is still not working');
      if (result.response) {
        console.log('LLM Response:', result.response);
      }
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

module.exports = { testSimpleFunctionCall };