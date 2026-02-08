const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs').promises;

/**
 * Test MCP integration with LLM worker
 */
async function testMCPIntegration() {
  console.log('Testing MCP integration with LLM worker...');

  // Ensure MCP config exists for testing
  const mcpConfigPath = '.insighto/settings/mcp.json';
  try {
    await fs.access(mcpConfigPath);
  } catch (error) {
    console.log('Creating test MCP configuration...');
    await fs.mkdir(path.dirname(mcpConfigPath), { recursive: true });
    await fs.writeFile(mcpConfigPath, JSON.stringify({
      mcpServers: {
        "test-server": {
          "command": "echo",
          "args": ["test"],
          "disabled": true,
          "env": {}
        }
      }
    }, null, 2));
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker('./llm-worker.js');
    let workerReady = false;
    let testTimeout;

    // Set up timeout
    testTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Test timeout - worker did not respond within 30 seconds'));
    }, 30000);

    worker.on('message', (message) => {
      console.log('Worker message:', message);

      if (message.type === 'ready') {
        workerReady = true;
        console.log('✓ Worker initialized successfully with MCP integration');
        
        // Test a simple chat request
        worker.postMessage({
          id: 'test-1',
          type: 'chat',
          prompt: 'Hello, can you help me test MCP integration?',
          transcriptContext: ''
        });
      } else if (message.id === 'test-1' && message.response) {
        console.log('✓ Chat request processed successfully');
        console.log('Response:', message.response.substring(0, 100) + '...');
        
        // Test shutdown
        worker.postMessage({
          id: 'shutdown-test',
          type: 'shutdown'
        });
      } else if (message.id === 'shutdown-test' && message.type === 'shutdown-complete') {
        console.log('✓ MCP shutdown completed successfully');
        clearTimeout(testTimeout);
        worker.terminate();
        resolve();
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
      if (code !== 0 && !workerReady) {
        clearTimeout(testTimeout);
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

// Run the test
if (require.main === module) {
  testMCPIntegration()
    .then(() => {
      console.log('\n✅ MCP integration test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ MCP integration test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testMCPIntegration };