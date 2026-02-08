const { Worker } = require('worker_threads');

/**
 * Simple test to verify context overflow fix
 */
async function testContextFix() {
  console.log('Testing context overflow fix...');

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout'));
    }, 30000);

    worker.on('message', (message) => {
      if (message.type === 'ready') {
        console.log('✓ Worker ready');
        
        // Test with a simple prompt that should trigger file reading
        worker.postMessage({
          id: 'test-simple',
          type: 'chat',
          prompt: 'Please read the file /private/tmp/mcp-test/test.txt',
          transcriptContext: ''
        });
      } else if (message.id === 'test-simple') {
        console.log('✓ Response received');
        console.log('Response length:', message.response?.length || 0);
        
        // Check if function was called
        const hasFunction = message.response?.includes('mcp_filesystem_read_file') || 
                           message.response?.includes('This is a test file');
        
        console.log('Function called or result included:', hasFunction);
        
        clearTimeout(testTimeout);
        worker.terminate();
        resolve({ success: true, hasFunction });
      } else if (message.type === 'error') {
        console.error('Worker error:', message.error);
        
        // Check if it's a context overflow error
        const isContextError = message.error.includes('KV slot') || 
                              message.error.includes('context') || 
                              message.error.includes('batch');
        
        clearTimeout(testTimeout);
        worker.terminate();
        
        if (isContextError) {
          reject(new Error('Context overflow error still occurring'));
        } else {
          resolve({ success: false, error: message.error });
        }
      }
    });

    worker.on('error', (error) => {
      console.error('Worker thread error:', error);
      clearTimeout(testTimeout);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testContextFix()
    .then((result) => {
      console.log('\n✅ Context fix test completed!');
      console.log('Result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Context fix test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testContextFix };