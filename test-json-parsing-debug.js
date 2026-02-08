const { Worker } = require('worker_threads');

/**
 * Test to debug JSON parsing issues in function calling
 */
async function testJSONParsingDebug() {
  console.log('Testing JSON parsing debug...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout'));
    }, 60000);

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        console.log('✓ Worker ready');
        
        // Test a simple brave search that might trigger the JSON error
        worker.postMessage({
          id: 'test-json',
          type: 'chat',
          prompt: `Please search for "JavaScript tutorials" using the brave web search function. Use the mcp_brave-search_brave_web_search function with the query parameter set to "JavaScript tutorials".`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-json') {
        if (message.response) {
          console.log('✓ JSON parsing test completed successfully');
          console.log('Response length:', message.response.length);
          console.log('Response preview:', message.response.substring(0, 300));
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            response: message.response
          });
        } else if (message.error) {
          console.log('✗ JSON parsing error:', message.error);
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
    console.log('JSON PARSING DEBUG TEST');
    console.log('='.repeat(50));

    const result = await testJSONParsingDebug();
    console.log('\n✅ Test Results:', result);

    if (!result.success) {
      console.log('\n❌ Test failed with error:', result.error);
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

module.exports = { testJSONParsingDebug };