const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs').promises;

/**
 * Test MCP function calling integration
 */
async function testMCPFunctionCalling() {
  console.log('Testing MCP function calling integration...');

  // Create a test file for the MCP filesystem server to work with
  const testDir = '/tmp/mcp-test';
  const testFile = path.join(testDir, 'test.txt');
  
  try {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(testFile, 'This is a test file for MCP integration testing.');
    console.log('✓ Created test file for MCP filesystem server');
  } catch (error) {
    console.error('Failed to create test file:', error);
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let testTimeout;
    let testResults = {
      workerReady: false,
      chatWithFunctions: false,
      analysisWithFunctions: false
    };

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout - worker did not complete within 60 seconds'));
    }, 60000);

    worker.on('message', (message) => {
      console.log('Worker message:', message.type, message.id || '');

      if (message.type === 'ready') {
        testResults.workerReady = true;
        console.log('✓ Worker ready with MCP integration');
        
        // Test chat request that should trigger MCP function calls
        worker.postMessage({
          id: 'test-chat',
          type: 'chat',
          prompt: `Please read the contents of the file /tmp/mcp-test/test.txt and tell me what it contains.`,
          transcriptContext: ''
        });
      } else if (message.id === 'test-chat' && message.response) {
        testResults.chatWithFunctions = true;
        console.log('✓ Chat with MCP functions completed');
        console.log('Response preview:', message.response.substring(0, 200) + '...');
        
        // Test analysis request
        worker.postMessage({
          id: 'test-analysis',
          type: 'analyze-transcript',
          transcript: 'User asked about reading a file. The system used MCP tools to access the filesystem.',
          context: 'Testing MCP integration',
          analysisType: ['summary']
        });
      } else if (message.id === 'test-analysis' && message.type === 'analysis-response') {
        testResults.analysisWithFunctions = true;
        console.log('✓ Analysis with MCP functions completed');
        console.log('Summary:', message.results.summary);
        
        // Test shutdown
        worker.postMessage({
          id: 'shutdown-test',
          type: 'shutdown'
        });
      } else if (message.id === 'shutdown-test' && message.type === 'shutdown-complete') {
        console.log('✓ Shutdown completed');
        clearTimeout(testTimeout);
        worker.terminate();
        
        // Check all test results
        const allPassed = Object.values(testResults).every(result => result === true);
        if (allPassed) {
          resolve(testResults);
        } else {
          reject(new Error(`Some tests failed: ${JSON.stringify(testResults)}`));
        }
      } else if (message.type === 'error') {
        console.error('Worker error:', message.error);
        clearTimeout(testTimeout);
        worker.terminate();
        reject(new Error(`Worker error: ${message.error}`));
      }
    });

    worker.on('error', (error) => {
      console.error('Worker thread error:', error);
      clearTimeout(testTimeout);
      reject(error);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !testResults.workerReady) {
        clearTimeout(testTimeout);
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

// Run the test
if (require.main === module) {
  testMCPFunctionCalling()
    .then((results) => {
      console.log('\n✅ MCP function calling test completed successfully!');
      console.log('Test results:', results);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ MCP function calling test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testMCPFunctionCalling };