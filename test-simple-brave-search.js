const { Worker } = require('worker_threads');

/**
 * Simple test for Brave search with iterative function calling
 */
async function testSimpleBraveSearch() {
  console.log('Testing simple Brave search with iterative function calling...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout'));
    }, 60000);

    worker.on('message', (message) => {
      if (message.type === 'ready') {
        console.log('✓ Worker ready');
        
        // Simple search request
        worker.postMessage({
          id: 'test-search',
          type: 'chat',
          prompt: `Search for "Node.js tutorials" using web search.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-search') {
        if (message.response) {
          console.log('✓ Search completed');
          console.log('Tools used:', message.mcpToolsUsed ? message.mcpToolsUsed.length : 0);
          console.log('Response length:', message.response.length);
          console.log('Response preview:', message.response.substring(0, 200) + '...');
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            toolsUsed: message.mcpToolsUsed ? message.mcpToolsUsed.length : 0
          });
        } else if (message.error) {
          console.log('✗ Error:', message.error);
          clearTimeout(testTimeout);
          worker.terminate();
          reject(new Error(message.error));
        }
      }
    });

    worker.on('error', (error) => {
      console.error('Worker error:', error);
      clearTimeout(testTimeout);
      reject(error);
    });
  });
}

// Run the test
testSimpleBraveSearch()
  .then((result) => {
    console.log('\n✅ Test completed successfully:', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });