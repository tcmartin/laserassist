const { Worker } = require('worker_threads');

/**
 * Test iterative function calling with Brave search
 */
async function testBraveSearchIterative() {
  console.log('Testing iterative function calling with Brave search...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout - worker did not complete within 120 seconds'));
    }, 120000); // 2 minutes for iterative testing

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        console.log('✓ Worker ready with MCP integration');
        
        // Test a complex request that should trigger multiple function calls
        worker.postMessage({
          id: 'test-iterative',
          type: 'chat',
          prompt: `I need to research JavaScript tutorials. Please search for "JavaScript tutorials" and then search for "JavaScript beginner guide" to compare the results. After getting both search results, provide me with a summary of the best resources found.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-iterative') {
        if (message.response) {
          console.log('✓ Iterative function calling completed');
          console.log('Response length:', message.response.length);
          console.log('MCP tools used:', message.mcpToolsUsed ? message.mcpToolsUsed.length : 0);
          
          if (message.mcpToolsUsed) {
            console.log('Tools used:');
            message.mcpToolsUsed.forEach((tool, index) => {
              console.log(`  ${index + 1}. ${tool.name} (${tool.serverId}) - ${tool.success ? 'SUCCESS' : 'FAILED'}`);
              if (!tool.success) {
                console.log(`     Error: ${tool.error}`);
              }
            });
          }
          
          console.log('\nResponse preview:');
          console.log(message.response.substring(0, 500) + (message.response.length > 500 ? '...' : ''));
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            toolsUsed: message.mcpToolsUsed ? message.mcpToolsUsed.length : 0,
            responseLength: message.response.length
          });
        } else if (message.error) {
          console.log('✗ Error:', message.error);
          clearTimeout(testTimeout);
          worker.terminate();
          reject(new Error(message.error));
        }
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

    worker.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(testTimeout);
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

// Test with error handling
async function testBraveSearchWithErrors() {
  console.log('\nTesting Brave search with intentional errors...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Error test timeout'));
    }, 60000);

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        console.log('✓ Worker ready for error testing');
        
        // Test a request that might cause parameter errors
        worker.postMessage({
          id: 'test-errors',
          type: 'chat',
          prompt: `Search for JavaScript tutorials using the brave_web_search function. Make sure to handle any parameter errors properly.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-errors') {
        if (message.response || message.error) {
          console.log('✓ Error handling test completed');
          console.log('Response/Error:', message.response || message.error);
          
          clearTimeout(testTimeout);
          worker.terminate();
          resolve({
            success: true,
            hasResponse: !!message.response,
            hasError: !!message.error
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

// Run the tests
async function runTests() {
  try {
    console.log('='.repeat(60));
    console.log('BRAVE SEARCH ITERATIVE FUNCTION CALLING TESTS');
    console.log('='.repeat(60));

    // Test 1: Iterative function calling
    const result1 = await testBraveSearchIterative();
    console.log('\n✅ Test 1 Results:', result1);

    // Test 2: Error handling
    const result2 = await testBraveSearchWithErrors();
    console.log('\n✅ Test 2 Results:', result2);

    console.log('\n🎉 All tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testBraveSearchIterative, testBraveSearchWithErrors };