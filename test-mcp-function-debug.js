const { Worker } = require('worker_threads');

/**
 * Debug MCP function calling to identify parameter passing issues
 */
async function debugMCPFunctionCalling() {
  console.log('Debugging MCP function calling...');

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
        
        // Test a simple prompt that should trigger brave search
        worker.postMessage({
          id: 'test-search',
          type: 'chat',
          prompt: `Search for "JavaScript tutorials" using web search.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-search') {
        if (message.response) {
          console.log('✓ Response received');
          console.log('Response:', message.response.substring(0, 500) + '...');
        } else if (message.error) {
          console.log('✗ Error:', message.error);
        }
        
        clearTimeout(testTimeout);
        worker.terminate();
        resolve();
      } else if (message.type === 'error') {
        console.error('Worker error:', message.error);
        clearTimeout(testTimeout);
        worker.terminate();
        reject(new Error(message.error));
      }
    });

    worker.on('error', (error) => {
      console.error('Worker thread error:', error);
      clearTimeout(testTimeout);
      reject(error);
    });
  });
}

// Run the debug test
if (require.main === module) {
  debugMCPFunctionCalling()
    .then(() => {
      console.log('\n✅ Debug test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Debug test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { debugMCPFunctionCalling };