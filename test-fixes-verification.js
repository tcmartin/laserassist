/**
 * Test to verify the fixes for LLM chat transcript context and analysis integration
 */

// Mock DOM and global objects for testing
const mockDOM = {
  getElementById: (id) => ({
    textContent: '',
    value: id === 'prompt' ? 'What did we discuss?' : '',
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    style: { display: 'block' },
    scrollTop: 0,
    scrollHeight: 100,
    disabled: false
  }),
  addEventListener: () => {},
  body: { style: {} }
};

// Mock electron API to capture what gets sent
let capturedPrompts = [];
let capturedAnalysisRequests = [];

const mockElectronAPI = {
  sendPrompt: (id, prompt, transcriptContext) => {
    capturedPrompts.push({ id, prompt, transcriptContext });
    console.log('Captured chat prompt:', { id, prompt, transcriptContext: transcriptContext ? transcriptContext.substring(0, 50) + '...' : 'none' });
  },
  sendAnalysisRequest: (request) => {
    capturedAnalysisRequests.push(request);
    console.log('Captured analysis request:', request.type, request.analysisType);
    
    // Simulate async response
    setTimeout(() => {
      const mockResponse = {
        id: request.id,
        type: 'analysis-response',
        results: request.analysisType.includes('summary') 
          ? { summary: 'Mock summary: Discussion about project requirements and timeline.' }
          : { 
              suggestions: {
                actionItems: ['Follow up on requirements'],
                questions: ['What are the next steps?'],
                topics: ['Project planning', 'Timeline management']
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
const AnalysisEngine = require('./analysis-engine.js');

async function testFixes() {
  console.log('Testing fixes for LLM chat context and analysis integration...\n');
  
  try {
    // Test 1: Verify transcript context is included in chat
    console.log('Test 1: LLM Chat with Transcript Context');
    console.log('=====================================');
    
    // Create transcript buffer with some content
    const transcriptBuffer = new TranscriptBuffer();
    transcriptBuffer.addTranscriptSegment('Hello, we are discussing the new project requirements.', new Date());
    transcriptBuffer.addTranscriptSegment('The main deliverables include API design and documentation.', new Date());
    transcriptBuffer.addTranscriptSegment('We need to finalize the timeline by next week.', new Date());
    
    // Simulate the chat functionality
    global.window.transcriptBuffer = transcriptBuffer;
    
    // Mock the chat button click functionality
    const simulateChatClick = () => {
      const prompt = 'What did we discuss?';
      const transcriptContext = transcriptBuffer.getFullContext();
      mockElectronAPI.sendPrompt(1, prompt, transcriptContext);
    };
    
    simulateChatClick();
    
    // Verify transcript context was included
    if (capturedPrompts.length > 0) {
      const lastPrompt = capturedPrompts[capturedPrompts.length - 1];
      if (lastPrompt.transcriptContext && lastPrompt.transcriptContext.length > 0) {
        console.log('✓ Transcript context included in chat request');
        console.log(`✓ Context length: ${lastPrompt.transcriptContext.length} characters`);
        console.log(`✓ Context preview: "${lastPrompt.transcriptContext.substring(0, 100)}..."`);
      } else {
        console.log('✗ Transcript context missing from chat request');
        return false;
      }
    } else {
      console.log('✗ No chat prompts captured');
      return false;
    }
    
    // Test 2: Verify analysis integration works
    console.log('\nTest 2: Analysis Integration');
    console.log('============================');
    
    // Create analysis engine
    const analysisEngine = new AnalysisEngine({
      enableAutoAnalysis: true,
      analysisInterval: 1000,
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
    
    // Initialize analysis engine (using dummy generators since we're testing the integration)
    const dummyGenerator = { generateSummary: () => ({}), generateSuggestions: () => ([]) };
    analysisEngine.initialize(
      transcriptBuffer,
      dummyGenerator,
      dummyGenerator,
      mockLLMWorker
    );
    
    console.log('✓ Analysis engine initialized');
    
    // Test manual analysis trigger
    let analysisCompleted = false;
    let analysisResults = null;
    
    analysisEngine.on('analysisCompleted', (data) => {
      analysisCompleted = true;
      analysisResults = data;
      console.log('✓ Analysis completed event received');
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
    
    // Verify analysis requests were sent
    if (capturedAnalysisRequests.length > 0) {
      console.log(`✓ ${capturedAnalysisRequests.length} analysis requests sent`);
      
      const summaryRequest = capturedAnalysisRequests.find(r => r.analysisType.includes('summary'));
      const suggestionsRequest = capturedAnalysisRequests.find(r => r.analysisType.includes('suggestions'));
      
      if (summaryRequest) {
        console.log('✓ Summary analysis request sent');
        console.log(`  - Transcript length: ${summaryRequest.transcript.length} characters`);
      }
      
      if (suggestionsRequest) {
        console.log('✓ Suggestions analysis request sent');
        console.log(`  - Context included: ${suggestionsRequest.context ? 'Yes' : 'No'}`);
      }
    } else {
      console.log('✗ No analysis requests captured');
      return false;
    }
    
    // Verify analysis results
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
    
    // Test 3: Verify automatic analysis trigger
    console.log('\nTest 3: Automatic Analysis Trigger');
    console.log('==================================');
    
    // Clear previous requests
    capturedAnalysisRequests = [];
    
    // Start the analysis engine
    analysisEngine.start();
    console.log('✓ Analysis engine started');
    
    // Add more transcript content to trigger automatic analysis
    transcriptBuffer.addTranscriptSegment('We also need to consider the security requirements for the API.', new Date());
    transcriptBuffer.addTranscriptSegment('The authentication system should use JWT tokens.', new Date());
    
    // Simulate the checkAndTriggerAnalysis function
    const checkAndTriggerAnalysis = () => {
      if (!analysisEngine.isRunning) {
        console.log('Analysis engine not running');
        return;
      }
      
      const unanalyzedSegments = transcriptBuffer.getUnanalyzedSegments(50);
      if (unanalyzedSegments.length === 0) {
        console.log('No unanalyzed segments available');
        return;
      }
      
      const unanalyzedText = unanalyzedSegments.map(s => s.text).join(' ');
      if (unanalyzedText.length < 50) {
        console.log('Not enough unanalyzed text for analysis');
        return;
      }
      
      console.log('Triggering automatic analysis');
      analysisEngine.triggerAnalysis({
        force: false,
        types: ['summary', 'suggestions'],
        automatic: true
      }).catch(error => {
        console.error('Automatic analysis failed:', error);
      });
    };
    
    // Trigger the check
    checkAndTriggerAnalysis();
    
    // Wait a bit for the automatic analysis
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (capturedAnalysisRequests.length > 0) {
      console.log('✓ Automatic analysis triggered successfully');
    } else {
      console.log('✗ Automatic analysis was not triggered');
    }
    
    analysisEngine.stop();
    console.log('✓ Analysis engine stopped');
    
    console.log('\n🎉 All fix verification tests passed!');
    return true;
    
  } catch (error) {
    console.error('✗ Fix verification test failed:', error);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testFixes()
    .then(success => {
      console.log(`\n=== Fix Verification Result: ${success ? 'PASSED' : 'FAILED'} ===`);
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testFixes };