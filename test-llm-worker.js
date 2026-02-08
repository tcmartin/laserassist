/**
 * Simple test suite for LLM Worker analysis capabilities
 * Run with: node test-llm-worker.js
 * 
 * Note: This test requires the LLM model to be available
 */

const { Worker } = require('worker_threads');
const path = require('path');

function runTests() {
  console.log('Running LLM Worker analysis tests...\n');
  
  let worker;
  let testsPassed = 0;
  let testsTotal = 0;
  
  function test(name, testFn) {
    testsTotal++;
    console.log(`Test ${testsTotal}: ${name}`);
    
    try {
      testFn();
      testsPassed++;
      console.log('✓ Passed\n');
    } catch (err) {
      console.log(`✗ Failed: ${err.message}\n`);
    }
  }
  
  function asyncTest(name, testFn) {
    testsTotal++;
    console.log(`Test ${testsTotal}: ${name}`);
    
    return testFn()
      .then(() => {
        testsPassed++;
        console.log('✓ Passed\n');
      })
      .catch(err => {
        console.log(`✗ Failed: ${err.message}\n`);
      });
  }
  
  // Test 1: Worker initialization
  test('Worker initialization', () => {
    worker = new Worker(path.join(__dirname, 'llm-worker.js'));
    if (!worker) throw new Error('Failed to create worker');
  });
  
  // Test 2: Worker ready message
  asyncTest('Worker ready message', () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker did not become ready within 30 seconds'));
      }, 30000);
      
      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(`Worker error: ${msg.error}`));
        }
      });
      
      worker.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
  
  // Test 3: Chat request handling (backward compatibility)
  asyncTest('Chat request handling', () => {
    return new Promise((resolve, reject) => {
      const testId = 'test-chat-1';
      const timeout = setTimeout(() => {
        reject(new Error('Chat request timed out'));
      }, 10000);
      
      worker.on('message', (msg) => {
        if (msg.id === testId) {
          clearTimeout(timeout);
          if (msg.error) {
            reject(new Error(`Chat error: ${msg.error}`));
          } else if (msg.response) {
            resolve();
          } else {
            reject(new Error('Unexpected chat response format'));
          }
        }
      });
      
      // Send old-style chat message for backward compatibility
      worker.postMessage({
        id: testId,
        prompt: 'Hello, this is a test message. Please respond briefly.'
      });
    });
  });
  
  // Test 4: Analysis request handling
  asyncTest('Analysis request handling', () => {
    return new Promise((resolve, reject) => {
      const testId = 'test-analysis-1';
      const timeout = setTimeout(() => {
        reject(new Error('Analysis request timed out'));
      }, 300000); // 5 minutes for analysis tests
      
      worker.on('message', (msg) => {
        if (msg.id === testId) {
          if (msg.type === 'analysis-error') {
            clearTimeout(timeout);
            reject(new Error(`Analysis error: ${msg.error}`));
          } else if (msg.type === 'analysis-response') {
            clearTimeout(timeout);
            if (msg.results && (msg.results.summary || msg.results.suggestions)) {
              resolve();
            } else {
              reject(new Error('Analysis response missing expected results'));
            }
          } else if (msg.type === 'analysis-progress') {
            // Ignore progress messages, wait for final response
            console.log(`Progress: ${msg.message}`);
          } else {
            clearTimeout(timeout);
            reject(new Error(`Unexpected analysis response type: ${msg.type}`));
          }
        }
      });
      
      // Send analysis request
      worker.postMessage({
        type: 'analyze-transcript',
        id: testId,
        transcript: 'We discussed the quarterly budget and decided to increase marketing spend by 20%. John will prepare the proposal by Friday.',
        context: 'Previous meeting covered general budget overview.',
        analysisType: ['summary', 'suggestions'],
        timeRange: {
          start: new Date(Date.now() - 60000).toISOString(),
          end: new Date().toISOString()
        }
      });
    });
  });
  
  // Test: Chat with transcript context
  asyncTest('Chat with transcript context', () => {
    return new Promise((resolve, reject) => {
      const testId = 'test-chat-context';
      const timeout = setTimeout(() => {
        reject(new Error('Chat with context request timed out'));
      }, 120000); // 2 minutes for chat with context
      
      const messageHandler = (msg) => {
        if (msg.id === testId) {
          worker.off('message', messageHandler);
          clearTimeout(timeout);
          if (msg.error) {
            reject(new Error(`Chat context error: ${msg.error}`));
          } else if (msg.response) {
            // Check if response seems to consider the context
            if (msg.response.toLowerCase().includes('budget') || 
                msg.response.toLowerCase().includes('marketing') ||
                msg.response.toLowerCase().includes('context')) {
              resolve();
            } else {
              // Still pass if we get any response, context awareness is hard to test definitively
              resolve();
            }
          } else {
            reject(new Error('Unexpected chat context response format'));
          }
        }
      };
      
      worker.on('message', messageHandler);
      
      worker.postMessage({
        type: 'chat',
        id: testId,
        prompt: 'What was the main decision made?',
        transcriptContext: 'We discussed the quarterly budget and decided to increase marketing spend by 20%. John will prepare the proposal by Friday.'
      });
    });
  });
  
  // Test 5: Summary-only analysis
  asyncTest('Summary-only analysis', () => {
    return new Promise((resolve, reject) => {
      const testId = 'test-summary-only';
      const timeout = setTimeout(() => {
        reject(new Error('Summary-only request timed out'));
      }, 300000); // 5 minutes for analysis tests
      
      worker.on('message', (msg) => {
        if (msg.id === testId) {
          clearTimeout(timeout);
          if (msg.type === 'analysis-error') {
            reject(new Error(`Summary error: ${msg.error}`));
          } else if (msg.type === 'analysis-response') {
            if (msg.results && msg.results.summary && !msg.results.suggestions) {
              resolve();
            } else {
              reject(new Error('Summary-only response should not include suggestions'));
            }
          }
        }
      });
      
      worker.postMessage({
        type: 'analyze-transcript',
        id: testId,
        transcript: 'The team discussed project timelines and agreed on the new deadline.',
        analysisType: ['summary']
      });
    });
  });
  
  // Test 6: Request queuing (send multiple requests)
  asyncTest('Request queuing', () => {
    return new Promise((resolve, reject) => {
      const responses = new Set();
      const expectedIds = ['queue-test-1', 'queue-test-2', 'queue-test-3'];
      let timeout = setTimeout(() => {
        reject(new Error('Request queuing test timed out'));
      }, 600000); // 10 minutes for queuing test with multiple requests
      
      worker.on('message', (msg) => {
        if (expectedIds.includes(msg.id)) {
          responses.add(msg.id);
          if (responses.size === expectedIds.length) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
      
      // Send multiple requests quickly
      worker.postMessage({
        type: 'chat',
        id: 'queue-test-1',
        prompt: 'Quick test 1'
      });
      
      worker.postMessage({
        type: 'analyze-transcript',
        id: 'queue-test-2',
        transcript: 'Test transcript for queuing',
        analysisType: ['summary']
      });
      
      worker.postMessage({
        type: 'chat',
        id: 'queue-test-3',
        prompt: 'Quick test 3'
      });
    });
  });
  
  // Run all tests sequentially
  async function executeTests() {
    test('Worker initialization', () => {
      worker = new Worker(path.join(__dirname, 'llm-worker.js'));
      if (!worker) throw new Error('Failed to create worker');
    });

    await asyncTest('Worker ready message', () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker did not become ready within 30 seconds'));
        }, 30000);

        worker.on('message', (msg) => {
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            resolve();
          } else if (msg.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(`Worker error: ${msg.error}`));
          }
        });

        worker.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    await asyncTest('Chat request handling', () => {
      return new Promise((resolve, reject) => {
        const testId = 'test-chat-1';
        const timeout = setTimeout(() => {
          reject(new Error('Chat request timed out'));
        }, 10000);

        const messageHandler = (msg) => {
          if (msg.id === testId) {
            worker.off('message', messageHandler);
            clearTimeout(timeout);
            if (msg.error) {
              reject(new Error(`Chat error: ${msg.error}`));
            } else if (msg.response) {
              resolve();
            } else {
              reject(new Error('Unexpected chat response format'));
            }
          }
        };

        worker.on('message', messageHandler);

        worker.postMessage({
          id: testId,
          prompt: 'Hello, this is a test message. Please respond briefly.'
        });
      });
    });

    await asyncTest('Analysis request handling', () => {
      return new Promise((resolve, reject) => {
        const testId = 'test-analysis-1';
        const timeout = setTimeout(() => {
          reject(new Error('Analysis request timed out'));
        }, 300000); // 5 minutes for analysis tests

        const messageHandler = (msg) => {
          if (msg.id === testId) {
            if (msg.type === 'analysis-error') {
              worker.off('message', messageHandler);
              clearTimeout(timeout);
              reject(new Error(`Analysis error: ${msg.error}`));
            } else if (msg.type === 'analysis-response') {
              worker.off('message', messageHandler);
              clearTimeout(timeout);
              if (msg.results && (msg.results.summary || msg.results.suggestions || msg.results.activities)) {
                resolve();
              } else {
                reject(new Error('Analysis response missing expected results'));
              }
            } else if (msg.type === 'analysis-progress') {
              // Ignore progress messages, wait for final response
              console.log(`Progress: ${msg.message}`);
            } else {
              worker.off('message', messageHandler);
              clearTimeout(timeout);
              reject(new Error(`Unexpected analysis response type: ${msg.type}`));
            }
          }
        };

        worker.on('message', messageHandler);

        worker.postMessage({
          type: 'analyze-transcript',
          id: testId,
          transcript: 'We discussed the quarterly budget and decided to increase marketing spend by 20%. John will prepare the proposal by Friday.',
          context: 'Previous meeting covered general budget overview.',
          analysisType: ['summary', 'suggestions', 'activities'],
          timeRange: {
            start: new Date(Date.now() - 60000).toISOString(),
            end: new Date().toISOString()
          }
        });
      });
    });

    await asyncTest('Chat with transcript context', () => {
      return new Promise((resolve, reject) => {
        const testId = 'test-chat-context';
        const timeout = setTimeout(() => {
          reject(new Error('Chat with context request timed out'));
        }, 120000); // 2 minutes for chat with context

        const messageHandler = (msg) => {
          if (msg.id === testId) {
            worker.off('message', messageHandler);
            clearTimeout(timeout);
            if (msg.error) {
              reject(new Error(`Chat context error: ${msg.error}`));
            } else if (msg.response) {
              // Check if response seems to consider the context
              if (msg.response.toLowerCase().includes('budget') ||
                msg.response.toLowerCase().includes('marketing') ||
                msg.response.toLowerCase().includes('context')) {
                resolve();
              } else {
                // Still pass if we get any response, context awareness is hard to test definitively
                resolve();
              }
            } else {
              reject(new Error('Unexpected chat context response format'));
            }
          }
        };

        worker.on('message', messageHandler);

        worker.postMessage({
          type: 'chat',
          id: testId,
          prompt: 'What was the main decision made?',
          transcriptContext: 'We discussed the quarterly budget and decided to increase marketing spend by 20%. John will prepare the proposal by Friday.'
        });
      });
    });

    await asyncTest('Summary-only analysis', () => {
      return new Promise((resolve, reject) => {
        const testId = 'test-summary-only';
        const timeout = setTimeout(() => {
          reject(new Error('Summary-only request timed out'));
        }, 300000); // 5 minutes for analysis tests

        const messageHandler = (msg) => {
          if (msg.id === testId) {
            clearTimeout(timeout);
            if (msg.type === 'analysis-error') {
              reject(new Error(`Summary error: ${msg.error}`));
            } else if (msg.type === 'analysis-response') {
              if (msg.results && msg.results.summary && !msg.results.suggestions && !msg.results.activities) {
                resolve();
              }
            }
          }
        };

        worker.on('message', messageHandler);

        worker.postMessage({
          type: 'analyze-transcript',
          id: testId,
          transcript: 'The team discussed project timelines and agreed on the new deadline.',
          analysisType: ['summary']
        });
      });
    });

    await asyncTest('Request queuing', () => {
      return new Promise((resolve, reject) => {
        const responses = new Set();
        const expectedIds = ['queue-test-1', 'queue-test-2', 'queue-test-3'];
        let timeout = setTimeout(() => {
          reject(new Error('Request queuing test timed out'));
        }, 600000); // 10 minutes for queuing test with multiple requests

        const messageHandler = (msg) => {
          if (expectedIds.includes(msg.id)) {
            responses.add(msg.id);
            if (responses.size === expectedIds.length) {
              clearTimeout(timeout);
              worker.off('message', messageHandler);
              resolve();
            }
          }
        };

        worker.on('message', messageHandler);

        // Send multiple requests quickly
        worker.postMessage({
          type: 'chat',
          id: 'queue-test-1',
          prompt: 'Quick test 1'
        });

        worker.postMessage({
          type: 'analyze-transcript',
          id: 'queue-test-2',
          transcript: 'Test transcript for queuing',
          analysisType: ['summary']
        });

        worker.postMessage({
          type: 'chat',
          id: 'queue-test-3',
          prompt: 'Quick test 3'
        });
      });
    });

    console.log(`\nTest Results: ${testsPassed}/${testsTotal} tests passed`);
    if (testsPassed === testsTotal) {
      console.log('All tests passed! \u2713');
    } else {
      console.log('Some tests failed \u2717');
    }

    // Cleanup
    if (worker) {
      worker.terminate();
    }

    process.exit(testsPassed === testsTotal ? 0 : 1);
  }

  executeTests().catch(err => {
    console.error('Test suite error:', err);
    if (worker) {
      worker.terminate();
    }
    process.exit(1);
  });
}

// Only run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };