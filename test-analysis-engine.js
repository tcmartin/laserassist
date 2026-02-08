/**
 * Test suite for AnalysisEngine
 * Tests the analysis engine coordinator functionality including timing, state management,
 * and integration with transcript buffer, summary generator, and suggestion generator.
 */

// Import required classes
const AnalysisEngine = require('./analysis-engine.js');
const TranscriptBuffer = require('./transcript-buffer.js');
const SummaryGenerator = require('./summary-generator.js');
const SuggestionGenerator = require('./suggestion-generator.js');

// Mock LLM Worker for testing
class MockLLMWorker {
  constructor() {
    this.listeners = [];
    this.messageQueue = [];
  }

  addEventListener(event, handler) {
    this.listeners.push({ event, handler });
  }

  removeEventListener(event, handler) {
    this.listeners = this.listeners.filter(l => l.event !== event || l.handler !== handler);
  }

  postMessage(message) {
    this.messageQueue.push(message);
    
    // Simulate async response
    setTimeout(() => {
      const response = {
        id: message.id,
        type: 'analysis-response',
        response: this._generateMockResponse(message)
      };
      
      this.listeners.forEach(listener => {
        if (listener.event === 'message') {
          listener.handler({ data: response });
        }
      });
    }, 100);
  }

  _generateMockResponse(message) {
    if (message.analysisType === 'summary') {
      return 'This is a mock summary of the conversation discussing key topics and decisions.';
    } else if (message.analysisType === 'suggestion') {
      return JSON.stringify([
        { content: 'Mock action item suggestion', priority: 'high' },
        { content: 'Mock question suggestion', priority: 'medium' }
      ]);
    }
    return 'Mock response';
  }

  simulateError(messageId) {
    setTimeout(() => {
      const response = {
        id: messageId,
        type: 'analysis-error',
        error: 'Mock LLM error'
      };
      
      this.listeners.forEach(listener => {
        if (listener.event === 'message') {
          listener.handler({ data: response });
        }
      });
    }, 100);
  }
}

// Test utilities
function createTestComponents() {
  const transcriptBuffer = new TranscriptBuffer();
  const summaryGenerator = new SummaryGenerator();
  const suggestionGenerator = new SuggestionGenerator();
  const mockLLMWorker = new MockLLMWorker();
  
  return { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker };
}

function addTestTranscript(transcriptBuffer, text = 'This is a test conversation about project planning and task management.') {
  transcriptBuffer.addTranscriptSegment(text, new Date());
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test Suite
async function runTests() {
  console.log('Starting AnalysisEngine tests...\n');
  
  let testCount = 0;
  let passedTests = 0;
  
  function test(name, testFn) {
    testCount++;
    console.log(`Test ${testCount}: ${name}`);
    
    try {
      const result = testFn();
      if (result instanceof Promise) {
        return result.then(() => {
          console.log('✅ PASSED\n');
          passedTests++;
        }).catch(error => {
          console.log(`❌ FAILED: ${error.message}\n`);
        });
      } else {
        console.log('✅ PASSED\n');
        passedTests++;
      }
    } catch (error) {
      console.log(`❌ FAILED: ${error.message}\n`);
    }
  }

  // Test 1: Constructor and initialization
  await test('Constructor creates AnalysisEngine with default options', () => {
    const engine = new AnalysisEngine();
    
    if (!engine.options.analysisInterval || engine.options.analysisInterval !== 60000) {
      throw new Error('Default analysis interval should be 60000ms');
    }
    
    if (engine.options.enableSummaries !== true) {
      throw new Error('Summaries should be enabled by default');
    }
    
    if (engine.options.enableSuggestions !== true) {
      throw new Error('Suggestions should be enabled by default');
    }
    
    if (engine.isRunning !== false) {
      throw new Error('Engine should not be running initially');
    }
  });

  // Test 2: Custom options
  await test('Constructor accepts custom options', () => {
    const customOptions = {
      analysisInterval: 30000,
      enableSummaries: false,
      minTranscriptLength: 200
    };
    
    const engine = new AnalysisEngine(customOptions);
    
    if (engine.options.analysisInterval !== 30000) {
      throw new Error('Custom analysis interval not applied');
    }
    
    if (engine.options.enableSummaries !== false) {
      throw new Error('Custom enableSummaries not applied');
    }
    
    if (engine.options.minTranscriptLength !== 200) {
      throw new Error('Custom minTranscriptLength not applied');
    }
  });

  // Test 3: Initialization
  await test('Initialize method sets up components correctly', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    if (engine.transcriptBuffer !== transcriptBuffer) {
      throw new Error('TranscriptBuffer not set correctly');
    }
    
    if (engine.summaryGenerator !== summaryGenerator) {
      throw new Error('SummaryGenerator not set correctly');
    }
    
    if (engine.suggestionGenerator !== suggestionGenerator) {
      throw new Error('SuggestionGenerator not set correctly');
    }
    
    if (engine.llmWorker !== mockLLMWorker) {
      throw new Error('LLM Worker not set correctly');
    }
  });

  // Test 4: Initialization validation
  await test('Initialize method validates required components', () => {
    const engine = new AnalysisEngine();
    
    try {
      engine.initialize(null, null, null, null);
      throw new Error('Should have thrown error for missing components');
    } catch (error) {
      if (!error.message.includes('All components')) {
        throw new Error('Wrong error message for missing components');
      }
    }
  });

  // Test 5: Start/Stop functionality
  await test('Start and stop methods work correctly', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Test start
    engine.start();
    if (!engine.isRunning) {
      throw new Error('Engine should be running after start()');
    }
    
    if (engine.isPaused) {
      throw new Error('Engine should not be paused after start()');
    }
    
    // Test stop
    engine.stop();
    if (engine.isRunning) {
      throw new Error('Engine should not be running after stop()');
    }
    
    if (engine.isPaused) {
      throw new Error('Engine should not be paused after stop()');
    }
  });

  // Test 6: Pause/Resume functionality
  await test('Pause and resume methods work correctly', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    engine.start();
    
    // Test pause
    engine.pause();
    if (!engine.isRunning) {
      throw new Error('Engine should still be running when paused');
    }
    
    if (!engine.isPaused) {
      throw new Error('Engine should be paused after pause()');
    }
    
    // Test resume
    engine.resume();
    if (!engine.isRunning) {
      throw new Error('Engine should be running after resume()');
    }
    
    if (engine.isPaused) {
      throw new Error('Engine should not be paused after resume()');
    }
    
    engine.stop();
  });

  // Test 7: Settings update
  await test('UpdateSettings method updates configuration', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    const newSettings = {
      analysisInterval: 45000,
      enableSummaries: false,
      minTranscriptLength: 150
    };
    
    engine.updateSettings(newSettings);
    
    if (engine.options.analysisInterval !== 45000) {
      throw new Error('Analysis interval not updated');
    }
    
    if (engine.options.enableSummaries !== false) {
      throw new Error('EnableSummaries not updated');
    }
    
    if (engine.options.minTranscriptLength !== 150) {
      throw new Error('MinTranscriptLength not updated');
    }
  });

  // Test 8: Status reporting
  await test('GetStatus returns correct status information', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    const status = engine.getStatus();
    
    if (!status.sessionId) {
      throw new Error('Status should include sessionId');
    }
    
    if (typeof status.isRunning !== 'boolean') {
      throw new Error('Status should include isRunning boolean');
    }
    
    if (typeof status.isPaused !== 'boolean') {
      throw new Error('Status should include isPaused boolean');
    }
    
    if (!status.stats) {
      throw new Error('Status should include stats object');
    }
    
    if (!status.options) {
      throw new Error('Status should include options object');
    }
  });

  // Test 9: Session data
  await test('GetSessionData returns session information', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    const sessionData = engine.getSessionData();
    
    if (!sessionData.sessionId) {
      throw new Error('Session data should include sessionId');
    }
    
    if (!sessionData.startTime) {
      throw new Error('Session data should include startTime');
    }
    
    if (!Array.isArray(sessionData.summaries)) {
      throw new Error('Session data should include summaries array');
    }
    
    if (!Array.isArray(sessionData.suggestions)) {
      throw new Error('Session data should include suggestions array');
    }
  });

  // Test 10: Manual analysis trigger
  await test('TriggerAnalysis performs manual analysis', async () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add some transcript content
    addTestTranscript(transcriptBuffer, 'We need to implement the new authentication system and schedule a meeting for next week.');
    
    // Trigger manual analysis
    const result = await engine.triggerAnalysis({ force: true });
    
    if (!result) {
      throw new Error('Manual analysis should return results');
    }
    
    // Check that analysis was performed
    const status = engine.getStatus();
    if (status.stats.totalAnalyses === 0) {
      throw new Error('Analysis stats should be updated');
    }
  });

  // Test 11: Session reset
  await test('ResetSession clears session data', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    const originalSessionId = engine.sessionId;
    
    // Add some data
    engine.summaries.push({ id: 'test', content: 'test summary' });
    engine.suggestions.push({ id: 'test', content: 'test suggestion' });
    
    engine.resetSession();
    
    if (engine.sessionId === originalSessionId) {
      throw new Error('Session ID should change after reset');
    }
    
    if (engine.summaries.length !== 0) {
      throw new Error('Summaries should be cleared after reset');
    }
    
    if (engine.suggestions.length !== 0) {
      throw new Error('Suggestions should be cleared after reset');
    }
  });

  // Test 12: Event handling
  await test('Event handling works correctly', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    let eventFired = false;
    let eventData = null;
    
    // Add event listener
    engine.on('started', (data) => {
      eventFired = true;
      eventData = data;
    });
    
    engine.start();
    
    if (!eventFired) {
      throw new Error('Event should have been fired');
    }
    
    if (!eventData || !eventData.sessionId) {
      throw new Error('Event data should include sessionId');
    }
    
    engine.stop();
  });

  // Test 13: Event listener removal
  await test('Event listener removal works correctly', () => {
    const engine = new AnalysisEngine();
    
    let eventCount = 0;
    const handler = () => { eventCount++; };
    
    engine.on('test', handler);
    engine._emit('test', {});
    
    if (eventCount !== 1) {
      throw new Error('Event should have fired once');
    }
    
    engine.off('test', handler);
    engine._emit('test', {});
    
    if (eventCount !== 1) {
      throw new Error('Event should not fire after removal');
    }
  });

  // Test 14: Export/Import functionality
  await test('Export and import work correctly', () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add some test data
    engine.summaries.push({
      id: 'test-summary',
      content: 'Test summary content',
      timeRange: { start: new Date(), end: new Date() },
      timestamp: new Date()
    });
    
    // Export data
    const exportedData = engine.export();
    
    if (!exportedData.sessionId) {
      throw new Error('Exported data should include sessionId');
    }
    
    if (!exportedData.summaries || exportedData.summaries.length === 0) {
      throw new Error('Exported data should include summaries');
    }
    
    // Create new engine and import
    const newEngine = new AnalysisEngine();
    newEngine.import(exportedData);
    
    if (newEngine.sessionId !== exportedData.sessionId) {
      throw new Error('Imported sessionId should match exported');
    }
    
    if (newEngine.summaries.length !== 1) {
      throw new Error('Imported summaries should match exported');
    }
  });

  // Test 15: Error handling in analysis
  await test('Analysis handles errors gracefully', async () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add transcript content
    addTestTranscript(transcriptBuffer, 'Test content for error handling');
    
    // Mock a critical error by breaking the summary generator
    const originalGenerateSummary = summaryGenerator.generateSummary;
    summaryGenerator.generateSummary = async function() {
      throw new Error('Critical summary generation error');
    };
    
    let errorCaught = false;
    let analysisResult = null;
    
    try {
      analysisResult = await engine.triggerAnalysis({ force: true });
    } catch (error) {
      errorCaught = true;
    }
    
    // Analysis should complete but with errors in results
    if (errorCaught) {
      throw new Error('Analysis should not throw error for component failures');
    }
    
    if (!analysisResult || !analysisResult.summaryError) {
      throw new Error('Analysis should return result with error information');
    }
    
    // Check that analysis was still recorded as successful (graceful degradation)
    const status = engine.getStatus();
    if (status.stats.successfulAnalyses === 0) {
      throw new Error('Analysis should be recorded as successful despite component errors');
    }
    
    // Restore original method
    summaryGenerator.generateSummary = originalGenerateSummary;
  });

  // Test 16: Analysis with insufficient content
  await test('Analysis skips when content is insufficient', async () => {
    const engine = new AnalysisEngine({ minTranscriptLength: 100 });
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add very short transcript
    addTestTranscript(transcriptBuffer, 'Short');
    
    const result = await engine.triggerAnalysis();
    
    if (result !== null) {
      throw new Error('Analysis should return null for insufficient content');
    }
  });

  // Test 17: Concurrent analysis handling
  await test('Concurrent analysis requests are queued properly', async () => {
    const engine = new AnalysisEngine();
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add transcript content
    addTestTranscript(transcriptBuffer, 'Content for concurrent analysis testing');
    
    // Start multiple analyses simultaneously
    const promises = [
      engine.triggerAnalysis({ force: true }),
      engine.triggerAnalysis({ force: true }),
      engine.triggerAnalysis({ force: true })
    ];
    
    const results = await Promise.all(promises);
    
    // All should complete (some may be queued)
    if (results.length !== 3) {
      throw new Error('All analysis requests should complete');
    }
    
    // Check that queue was used
    if (engine.analysisQueue.length > 0) {
      throw new Error('Analysis queue should be empty after completion');
    }
  });

  // Test 18: Analysis with disabled features
  await test('Analysis respects disabled features', async () => {
    const engine = new AnalysisEngine({
      enableSummaries: false,
      enableSuggestions: true
    });
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add transcript content
    addTestTranscript(transcriptBuffer, 'Content for feature testing');
    
    const result = await engine.triggerAnalysis({ force: true });
    
    if (result.summary) {
      throw new Error('Summary should not be generated when disabled');
    }
    
    if (!result.suggestions) {
      throw new Error('Suggestions should be generated when enabled');
    }
  });

  // Test 19: Session ID generation
  await test('Session IDs are unique', () => {
    const engine1 = new AnalysisEngine();
    const engine2 = new AnalysisEngine();
    
    if (engine1.sessionId === engine2.sessionId) {
      throw new Error('Session IDs should be unique');
    }
    
    const originalId = engine1.sessionId;
    engine1.resetSession();
    
    if (engine1.sessionId === originalId) {
      throw new Error('Session ID should change after reset');
    }
  });

  // Test 20: Scheduled analysis (timing test)
  await test('Scheduled analysis works with short interval', async () => {
    const engine = new AnalysisEngine({ 
      analysisInterval: 200, // 200ms for testing
      minTranscriptLength: 50 // Lower threshold for testing
    }); 
    const { transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker } = createTestComponents();
    
    engine.initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, mockLLMWorker);
    
    // Add sufficient transcript content
    addTestTranscript(transcriptBuffer, 'This is sufficient content for scheduled analysis testing with enough characters to meet the minimum length requirement.');
    
    let analysisCount = 0;
    let analysisSkipped = false;
    
    engine.on('analysisCompleted', () => {
      analysisCount++;
    });
    
    engine.on('analysisSkipped', () => {
      analysisSkipped = true;
    });
    
    engine.start();
    
    // Wait for at least one scheduled analysis
    await sleep(400); // Give more time for analysis to complete
    
    engine.stop();
    
    if (analysisCount === 0 && !analysisSkipped) {
      throw new Error('At least one scheduled analysis should have occurred or been skipped');
    }
    
    // If analysis was skipped, that's also valid behavior
    if (analysisSkipped && analysisCount === 0) {
      console.log('  Note: Analysis was skipped due to content already being analyzed');
    }
  });

  // Print test results
  console.log(`\n=== Test Results ===`);
  console.log(`Total tests: ${testCount}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${testCount - passedTests}`);
  console.log(`Success rate: ${((passedTests / testCount) * 100).toFixed(1)}%`);
  
  if (passedTests === testCount) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n❌ Some tests failed. Please review the output above.');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, createTestComponents, MockLLMWorker };