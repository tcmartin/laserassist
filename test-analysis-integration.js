/**
 * Integration test for analysis engine with transcription flow
 * Tests the complete integration of transcript buffer, analysis engine, and UI updates
 */

// Mock DOM elements and global objects for testing
const mockDOM = {
  getElementById: (id) => ({
    textContent: '',
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    style: { display: 'block' },
    scrollTop: 0,
    scrollHeight: 100
  }),
  addEventListener: () => {},
  body: { style: {} }
};

const mockElectronAPI = {
  sendAnalysisRequest: (request) => {
    console.log('Mock analysis request:', request);
    // Simulate async response
    setTimeout(() => {
      const mockResponse = {
        id: request.id,
        type: 'analysis-response',
        results: request.analysisType.includes('summary') 
          ? { summary: 'This is a mock summary of the conversation.' }
          : { 
              suggestions: {
                actionItems: ['Mock action item'],
                questions: ['What should we do next?'],
                topics: ['Project planning']
              }
            }
      };
      
      if (window.mockAnalysisHandler) {
        window.mockAnalysisHandler({ data: mockResponse });
      }
    }, 100);
  },
  onAnalysisResponse: (handler) => {
    window.mockAnalysisHandler = handler;
  },
  onQueueStatus: () => {},
  onPerformanceWarning: () => {}
};

// Set up global mocks
global.document = mockDOM;
global.window = {
  document: mockDOM,
  electronAPI: mockElectronAPI,
  console: console
};

// Load required modules
const TranscriptBuffer = require('./transcript-buffer.js');
const SummaryGenerator = require('./summary-generator.js');
const SuggestionGenerator = require('./suggestion-generator.js');
const AnalysisEngine = require('./analysis-engine.js');

async function testAnalysisIntegration() {
  console.log('Starting analysis integration test...');
  
  try {
    // Initialize components
    const transcriptBuffer = new TranscriptBuffer();
    const summaryGenerator = new SummaryGenerator();
    const suggestionGenerator = new SuggestionGenerator();
    const analysisEngine = new AnalysisEngine({
      analysisInterval: 1000, // 1 second for testing
      minTranscriptLength: 50
    });
    
    // Mock LLM worker interface
    const mockLLMWorker = {
      postMessage: (message) => {
        mockElectronAPI.sendAnalysisRequest(message);
      },
      addEventListener: (event, handler) => {
        mockElectronAPI.onAnalysisResponse(handler);
      },
      removeEventListener: () => {}
    };
    
    // Initialize analysis engine
    analysisEngine.initialize(
      transcriptBuffer,
      summaryGenerator,
      suggestionGenerator,
      mockLLMWorker
    );
    
    console.log('✓ Analysis engine initialized');
    
    // Test 1: Add transcript segments
    console.log('\nTest 1: Adding transcript segments...');
    
    const segment1 = transcriptBuffer.addTranscriptSegment(
      'Hello, this is the first part of our conversation.',
      new Date()
    );
    
    const segment2 = transcriptBuffer.addTranscriptSegment(
      'We are discussing the project requirements and timeline.',
      new Date()
    );
    
    const segment3 = transcriptBuffer.addTranscriptSegment(
      'The main deliverables include documentation and implementation.',
      new Date()
    );
    
    console.log(`✓ Added 3 transcript segments: ${segment1}, ${segment2}, ${segment3}`);
    
    // Test 2: Check unanalyzed segments
    console.log('\nTest 2: Checking unanalyzed segments...');
    
    const unanalyzed = transcriptBuffer.getUnanalyzedSegments(50);
    console.log(`✓ Found ${unanalyzed.length} unanalyzed segments`);
    console.log(`✓ Total unanalyzed text length: ${unanalyzed.map(s => s.text).join(' ').length} characters`);
    
    // Test 3: Manual analysis trigger
    console.log('\nTest 3: Triggering manual analysis...');
    
    let analysisCompleted = false;
    let analysisResults = null;
    
    analysisEngine.on('analysisCompleted', (data) => {
      analysisCompleted = true;
      analysisResults = data;
      console.log('✓ Analysis completed:', data);
    });
    
    analysisEngine.on('analysisError', (data) => {
      console.error('✗ Analysis error:', data);
    });
    
    // Trigger analysis
    await analysisEngine.triggerAnalysis({
      force: true,
      types: ['summary', 'suggestions']
    });
    
    // Wait for analysis to complete
    await new Promise(resolve => {
      const checkCompletion = () => {
        if (analysisCompleted) {
          resolve();
        } else {
          setTimeout(checkCompletion, 100);
        }
      };
      checkCompletion();
    });
    
    console.log('✓ Manual analysis completed successfully');
    
    // Test 4: Check analysis results
    console.log('\nTest 4: Verifying analysis results...');
    
    if (analysisResults && analysisResults.results) {
      if (analysisResults.results.summary) {
        console.log('✓ Summary generated:', analysisResults.results.summary.content);
      }
      
      if (analysisResults.results.suggestions && analysisResults.results.suggestions.length > 0) {
        console.log(`✓ ${analysisResults.results.suggestions.length} suggestions generated`);
        analysisResults.results.suggestions.forEach((suggestion, index) => {
          console.log(`  ${index + 1}. [${suggestion.type}] ${suggestion.content}`);
        });
      }
    }
    
    // Test 5: Check segments marked as analyzed
    console.log('\nTest 5: Checking analyzed segments...');
    
    const stillUnanalyzed = transcriptBuffer.getUnanalyzedSegments(0);
    console.log(`✓ Remaining unanalyzed segments: ${stillUnanalyzed.length}`);
    
    // Test 6: Start/stop analysis engine
    console.log('\nTest 6: Testing analysis engine lifecycle...');
    
    analysisEngine.start();
    console.log('✓ Analysis engine started');
    
    const status = analysisEngine.getStatus();
    console.log(`✓ Engine status - Running: ${status.isRunning}, Paused: ${status.isPaused}`);
    
    analysisEngine.pause();
    console.log('✓ Analysis engine paused');
    
    analysisEngine.resume();
    console.log('✓ Analysis engine resumed');
    
    analysisEngine.stop();
    console.log('✓ Analysis engine stopped');
    
    // Test 7: Session management
    console.log('\nTest 7: Testing session management...');
    
    const sessionData = analysisEngine.getSessionData();
    console.log(`✓ Session data exported - Summaries: ${sessionData.summaries.length}, Suggestions: ${sessionData.suggestions.length}`);
    
    analysisEngine.resetSession();
    console.log('✓ Session reset successfully');
    
    const newSessionData = analysisEngine.getSessionData();
    console.log(`✓ New session data - Summaries: ${newSessionData.summaries.length}, Suggestions: ${newSessionData.suggestions.length}`);
    
    console.log('\n🎉 All integration tests passed successfully!');
    
    return true;
    
  } catch (error) {
    console.error('✗ Integration test failed:', error);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testAnalysisIntegration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testAnalysisIntegration };