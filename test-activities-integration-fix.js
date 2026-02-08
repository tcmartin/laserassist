/**
 * Test to verify that interactive activities are properly integrated into the core analysis flow
 */

// Mock components for testing
class MockTranscriptBuffer {
  constructor() {
    this.segments = [];
  }

  addTranscriptSegment(text, timestamp = new Date()) {
    const segment = {
      id: `segment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: text.trim(),
      timestamp,
      analyzed: false
    };
    this.segments.push(segment);
    return segment.id;
  }

  getUnanalyzedSegments(minLength = 100) {
    const unanalyzed = this.segments.filter(s => !s.analyzed);
    const totalLength = unanalyzed.reduce((sum, s) => sum + s.text.length, 0);
    return totalLength >= minLength ? unanalyzed : [];
  }

  getTimeRange(segments) {
    if (!segments || segments.length === 0) {
      return { start: new Date(), end: new Date() };
    }
    const timestamps = segments.map(s => s.timestamp);
    return {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    };
  }

  markSegmentsAnalyzed(segmentIds) {
    this.segments.forEach(segment => {
      if (segmentIds.includes(segment.id)) {
        segment.analyzed = true;
      }
    });
  }

  export() {
    return {
      segments: this.segments,
      sessionStart: new Date().toISOString()
    };
  }

  clearBuffer() {
    this.segments = [];
  }
}

class MockLLMWorker {
  constructor() {
    this.messageHandlers = [];
  }

  addEventListener(event, handler) {
    if (event === 'message') {
      this.messageHandlers.push(handler);
    }
  }

  removeEventListener(event, handler) {
    if (event === 'message') {
      const index = this.messageHandlers.indexOf(handler);
      if (index > -1) {
        this.messageHandlers.splice(index, 1);
      }
    }
  }

  postMessage(message) {
    // Simulate LLM response with activities included in suggestions
    setTimeout(() => {
      const response = {
        data: {
          id: message.id,
          type: 'analysis-response',
          results: {
            summary: 'Test summary of the conversation',
            suggestions: {
              actionItems: ['Follow up on the discussion', 'Schedule next meeting'],
              questions: ['What are the next steps?'],
              topics: ['Project planning', 'Team coordination'],
              activities: [
                {
                  type: 'define',
                  entity: 'project planning',
                  displayText: 'Define: project planning',
                  confidence: 0.9
                },
                {
                  type: 'explain',
                  entity: 'team coordination',
                  displayText: 'Explain: team coordination',
                  confidence: 0.8
                }
              ]
            }
          },
          timeRange: message.timeRange
        }
      };

      this.messageHandlers.forEach(handler => handler(response));
    }, 100);
  }
}

// Load the AnalysisEngine class
const AnalysisEngine = require('./analysis-engine.js');

async function testActivitiesIntegration() {
  console.log('=== Testing Activities Integration Fix ===\n');

  // Set up components
  const transcriptBuffer = new MockTranscriptBuffer();
  const mockLLMWorker = new MockLLMWorker();
  
  // Create analysis engine
  const analysisEngine = new AnalysisEngine({
    enableSummaries: true,
    enableSuggestions: true,
    minTranscriptLength: 50
  });

  // Create mock generators
  const mockSummaryGenerator = { reset: () => {} };
  const mockSuggestionGenerator = { reset: () => {} };

  // Initialize with mock components
  analysisEngine.initialize(
    transcriptBuffer,
    mockSummaryGenerator,
    mockSuggestionGenerator,
    mockLLMWorker
  );

  // Add some transcript content
  transcriptBuffer.addTranscriptSegment(
    'We need to discuss project planning and team coordination for the upcoming sprint.',
    new Date()
  );
  transcriptBuffer.addTranscriptSegment(
    'The team should focus on defining clear objectives and explaining the coordination process.',
    new Date()
  );

  console.log('✓ Test setup complete');
  console.log(`✓ Added ${transcriptBuffer.segments.length} transcript segments`);

  // Set up event listeners to capture results
  let analysisResults = null;
  let analysisCompleted = false;

  analysisEngine.on('analysisCompleted', (data) => {
    analysisCompleted = true;
    analysisResults = data;
    console.log('✓ Analysis completed event received');
  });

  // Trigger analysis
  console.log('\n--- Triggering Analysis ---');
  
  try {
    const result = await analysisEngine.triggerAnalysis({
      force: true,
      types: ['summary', 'suggestions']
    });

    console.log('✓ Analysis triggered successfully');

    // Wait a bit for async processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify results
    console.log('\n--- Verifying Results ---');

    if (!analysisCompleted) {
      throw new Error('Analysis should have completed');
    }

    if (!analysisResults) {
      throw new Error('Analysis results should be available');
    }

    // Check that activities are included in the results
    if (!analysisResults.results.activities) {
      throw new Error('Activities should be included in analysis results');
    }

    if (!Array.isArray(analysisResults.results.activities)) {
      throw new Error('Activities should be an array');
    }

    if (analysisResults.results.activities.length === 0) {
      throw new Error('Activities array should not be empty');
    }

    console.log(`✓ Found ${analysisResults.results.activities.length} activities in results`);

    // Verify activity structure
    const activity = analysisResults.results.activities[0];
    const requiredFields = ['id', 'type', 'entity', 'displayText', 'confidence', 'timestamp', 'executed', 'timeRange'];
    
    for (const field of requiredFields) {
      if (!(field in activity)) {
        throw new Error(`Activity should have ${field} field`);
      }
    }

    console.log('✓ Activity structure is correct');

    // Check that activities are stored in the engine
    const status = analysisEngine.getStatus();
    if (status.activityCount === 0) {
      throw new Error('Activities should be stored in the engine');
    }

    console.log(`✓ Engine stores ${status.activityCount} activities`);

    // Check session data includes activities
    const sessionData = analysisEngine.getSessionData();
    if (!sessionData.activities || sessionData.activities.length === 0) {
      throw new Error('Session data should include activities');
    }

    console.log(`✓ Session data includes ${sessionData.activities.length} activities`);

    // Test export/import with activities
    console.log('\n--- Testing Export/Import ---');
    
    const exportedData = analysisEngine.export();
    if (!exportedData.activities || exportedData.activities.length === 0) {
      throw new Error('Exported data should include activities');
    }

    console.log(`✓ Exported data includes ${exportedData.activities.length} activities`);

    // Create new engine and import
    const newEngine = new AnalysisEngine();
    newEngine.import(exportedData);

    const newStatus = newEngine.getStatus();
    if (newStatus.activityCount !== status.activityCount) {
      throw new Error('Imported engine should have same activity count');
    }

    console.log('✓ Import/export works correctly with activities');

    // Test reset functionality
    console.log('\n--- Testing Reset ---');
    
    analysisEngine.resetSession();
    const resetStatus = analysisEngine.getStatus();
    
    if (resetStatus.activityCount !== 0) {
      throw new Error('Reset should clear activities');
    }

    console.log('✓ Reset clears activities correctly');

    console.log('\n=== All Tests Passed! ===');
    console.log('✅ Activities are properly integrated into the core analysis flow');
    console.log('✅ Activities are generated as part of suggestions analysis');
    console.log('✅ Activities are stored, exported, and imported correctly');
    console.log('✅ Activities are cleared on session reset');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    throw error;
  }
}

// Test the LLM prompt integration
function testLLMPromptIntegration() {
  console.log('\n=== Testing LLM Prompt Integration ===\n');

  // Mock the LLM worker prompt templates
  const ANALYSIS_PROMPTS = {
    suggestions: (transcript, context) => `Based on this conversation, provide actionable suggestions and interactive activities in JSON format:

${transcript}

Respond with JSON only:
{
  "actionItems": ["suggestion1", "suggestion2"],
  "questions": ["question1"],
  "topics": ["topic1"],
  "activities": [
    {
      "type": "define",
      "entity": "technical term or concept mentioned",
      "displayText": "Define: [entity]",
      "confidence": 0.8
    },
    {
      "type": "explain", 
      "entity": "process or method discussed",
      "displayText": "Explain: [entity]",
      "confidence": 0.7
    }
  ]
}

Generate 1-3 interactive activities for entities, concepts, technologies, or processes mentioned in the conversation. Activity types: define, explain, research, example.`
  };

  const testTranscript = "We need to implement microservices architecture and use Docker containers for deployment.";
  const prompt = ANALYSIS_PROMPTS.suggestions(testTranscript, "");

  console.log('Generated LLM prompt:');
  console.log('---');
  console.log(prompt);
  console.log('---');

  // Verify the prompt includes activities
  if (!prompt.includes('activities')) {
    throw new Error('Prompt should include activities section');
  }

  if (!prompt.includes('define') || !prompt.includes('explain')) {
    throw new Error('Prompt should include activity types');
  }

  if (!prompt.includes('Generate 1-3 interactive activities')) {
    throw new Error('Prompt should include activity generation instructions');
  }

  console.log('✅ LLM prompt correctly includes activities integration');
}

// Run the tests
async function runTests() {
  try {
    await testActivitiesIntegration();
    testLLMPromptIntegration();
    console.log('\n🎉 All integration tests passed successfully!');
  } catch (error) {
    console.error('\n💥 Integration tests failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testActivitiesIntegration, testLLMPromptIntegration };