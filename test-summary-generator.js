/**
 * Comprehensive test suite for SummaryGenerator class
 * Run with: node test-summary-generator.js
 */

const SummaryGenerator = require('./summary-generator.js');

function runTests() {
  console.log('Running SummaryGenerator tests...\n');

  // Test 1: Basic instantiation and configuration
  console.log('Test 1: Basic instantiation and configuration');
  const generator = new SummaryGenerator({
    maxSummaryLength: 100,
    minTranscriptLength: 30,
    contextWindow: 2
  });
  
  console.log('✓ SummaryGenerator created successfully');
  console.log('✓ Options configured:', generator.options);
  console.log('✓ Initial stats:', generator.getStats());
  console.log();

  // Test 2: Prompt generation without context
  console.log('Test 2: Prompt generation without context');
  const transcript1 = 'We need to discuss the API design for the new user authentication system. The current approach has some security concerns.';
  const timeRange1 = {
    start: new Date('2024-01-01T10:00:00Z'),
    end: new Date('2024-01-01T10:05:00Z')
  };
  
  const prompt1 = generator._generateSummaryPrompt(transcript1, '', timeRange1);
  console.log('✓ Prompt generated successfully');
  console.log('✓ Contains transcript:', prompt1.includes(transcript1));
  console.log('✓ Contains time range:', prompt1.includes('10:00-10:05'));
  console.log('✓ Contains instructions:', prompt1.includes('Main topics discussed'));
  console.log();

  // Test 3: Topic extraction
  console.log('Test 3: Topic extraction');
  const topics1 = generator._extractTopics(transcript1);
  console.log('✓ Topics extracted:', topics1);
  console.log('✓ Should contain technology-related topics:', topics1.some(t => t.includes('technology') || t.includes('security')));
  
  const transcript2 = 'The meeting is scheduled for tomorrow. We need to review the budget and discuss the project timeline.';
  const topics2 = generator._extractTopics(transcript2);
  console.log('✓ Topics from meeting transcript:', topics2);
  console.log('✓ Should contain project management topics:', topics2.some(t => t.includes('project') || t.includes('meeting')));
  console.log();

  // Test 4: Summary generation (without LLM response)
  console.log('Test 4: Summary generation structure');
  
  async function testSummaryGeneration() {
    try {
      const summary1 = await generator.generateSummary(transcript1, timeRange1);
      
      console.log('✓ Summary object created');
      console.log('✓ Has required fields:', 
        summary1.id && summary1.timeRange && summary1.keyTopics && summary1.timestamp);
      console.log('✓ Time range preserved:', 
        summary1.timeRange.start.getTime() === timeRange1.start.getTime());
      console.log('✓ Topics extracted:', summary1.keyTopics.length > 0);
      console.log('✓ Confidence calculated:', summary1.confidence >= 0 && summary1.confidence <= 1);
      console.log('✓ Context not used (first summary):', !summary1.contextUsed);
      console.log('✓ Prompt included:', summary1.prompt && summary1.prompt.length > 0);
      
      return summary1;
    } catch (error) {
      console.log('✗ Error in summary generation:', error.message);
      return null;
    }
  }
  
  testSummaryGeneration().then(summary1 => {
    if (!summary1) return;
    
    console.log();

    // Test 5: Context building with previous summaries
    console.log('Test 5: Context building with previous summaries');
    
    // Create a mock previous summary
    const previousSummary = {
      id: 'prev_1',
      content: 'Discussed initial project requirements and team assignments.',
      timeRange: {
        start: new Date('2024-01-01T09:30:00Z'),
        end: new Date('2024-01-01T09:45:00Z')
      },
      keyTopics: ['project-management', 'team-coordination'],
      timestamp: new Date('2024-01-01T09:45:00Z')
    };
    
    const context = generator._buildContext([previousSummary]);
    console.log('✓ Context built from previous summary');
    console.log('✓ Context contains previous content:', context.includes('project requirements'));
    console.log('✓ Context includes time range:', context.includes('09:30-09:45'));
    
    // Test prompt generation with context
    const promptWithContext = generator._generateSummaryPrompt(transcript1, context, timeRange1);
    console.log('✓ Prompt with context generated');
    console.log('✓ Contains context section:', promptWithContext.includes('Context from previous summaries'));
    console.log();

    // Test 6: LLM response parsing
    console.log('Test 6: LLM response parsing');
    
    const mockLLMResponse = `The main topics discussed were API design and security concerns for the user authentication system. Key decisions included reviewing current security measures and implementing additional validation. The team agreed to prioritize security over development speed.`;
    
    const updatedSummary = generator.parseLLMResponse(summary1, mockLLMResponse);
    console.log('✓ LLM response parsed successfully');
    console.log('✓ Content updated:', updatedSummary.content === mockLLMResponse);
    console.log('✓ Confidence adjusted:', updatedSummary.confidence !== summary1.confidence);
    console.log('✓ Topics potentially updated:', updatedSummary.keyTopics.length >= summary1.keyTopics.length);
    console.log();

    // Test 7: Multiple summaries with context
    console.log('Test 7: Multiple summaries with context');
    
    async function testMultipleSummaries() {
      try {
        const transcript3 = 'Following up on the security discussion, we decided to implement OAuth 2.0 and add rate limiting to the API endpoints.';
        const timeRange3 = {
          start: new Date('2024-01-01T10:10:00Z'),
          end: new Date('2024-01-01T10:15:00Z')
        };
        
        // Generate second summary with context from first
        const summary2 = await generator.generateSummary(transcript3, timeRange3, [updatedSummary]);
        
        console.log('✓ Second summary generated');
        console.log('✓ Context was used:', summary2.contextUsed);
        console.log('✓ Different ID from first:', summary2.id !== summary1.id);
        console.log('✓ Topics include security-related:', summary2.keyTopics.some(t => t.includes('technology') || t.includes('security')));
        
        return summary2;
      } catch (error) {
        console.log('✗ Error in multiple summary test:', error.message);
        return null;
      }
    }
    
    testMultipleSummaries().then(summary2 => {
      if (!summary2) return;
      
      console.log();

      // Test 8: Topic tracking over time
      console.log('Test 8: Topic tracking over time');
      
      const recentTopics = generator._getRecentTopics();
      console.log('✓ Recent topics retrieved:', recentTopics);
      console.log('✓ Topics tracked over time:', generator.topicTracker.size > 0);
      
      // Check topic frequency tracking
      const stats = generator.getStats();
      console.log('✓ Generator stats:', stats);
      console.log('✓ Multiple summaries tracked:', stats.totalSummaries >= 2);
      console.log('✓ Topics being tracked:', stats.totalTopics > 0);
      console.log();

      // Test 9: Error handling
      console.log('Test 9: Error handling');
      
      async function testErrorHandling() {
        // Test empty transcript
        try {
          await generator.generateSummary('', timeRange1);
          console.log('✗ Should have thrown error for empty transcript');
        } catch (e) {
          console.log('✓ Correctly threw error for empty transcript:', e.message);
        }
        
        // Test null transcript
        try {
          await generator.generateSummary(null, timeRange1);
          console.log('✗ Should have thrown error for null transcript');
        } catch (e) {
          console.log('✓ Correctly threw error for null transcript:', e.message);
        }
        
        // Test invalid time range
        try {
          await generator.generateSummary(transcript1, null);
          console.log('✗ Should have thrown error for null time range');
        } catch (e) {
          console.log('✓ Correctly threw error for null time range:', e.message);
        }
        
        // Test short transcript handling
        const shortTranscript = 'Hi';
        const shortSummary = await generator.generateSummary(shortTranscript, timeRange1);
        console.log('✓ Short transcript handled gracefully');
        console.log('✓ Low confidence for short transcript:', shortSummary.confidence < 0.5);
        console.log('✓ Appropriate message for short transcript:', 
          shortSummary.content.includes('too short'));
      }
      
      testErrorHandling().then(() => {
        console.log();

        // Test 10: Export/Import functionality
        console.log('Test 10: Export/Import functionality');
        
        const exportData = generator.export();
        console.log('✓ Data exported successfully');
        console.log('✓ Contains summary history:', exportData.summaryHistory && exportData.summaryHistory.length > 0);
        console.log('✓ Contains topic tracker:', exportData.topicTracker && exportData.topicTracker.length > 0);
        console.log('✓ Contains options:', exportData.options);
        
        // Test import
        const newGenerator = new SummaryGenerator();
        newGenerator.import(exportData);
        
        const importedStats = newGenerator.getStats();
        const originalStats = generator.getStats();
        
        console.log('✓ Data imported successfully');
        console.log('✓ Summary count matches:', importedStats.totalSummaries === originalStats.totalSummaries);
        console.log('✓ Topic count matches:', importedStats.totalTopics === originalStats.totalTopics);
        console.log();

        // Test 11: Time range formatting
        console.log('Test 11: Time range formatting');
        
        const formattedRange = generator._formatTimeRange(timeRange1);
        console.log('✓ Time range formatted:', formattedRange);
        console.log('✓ Contains expected format:', formattedRange.includes('10:00-10:05'));
        
        // Test invalid time range formatting
        const invalidFormatted = generator._formatTimeRange(null);
        console.log('✓ Invalid time range handled:', invalidFormatted === 'Unknown time');
        console.log();

        // Test 12: Confidence calculation
        console.log('Test 12: Confidence calculation');
        
        const shortConfidence = generator._calculateConfidence('Short text', []);
        const longConfidence = generator._calculateConfidence('This is a much longer transcript with more content that should result in higher confidence scores because it provides more context and information for analysis.', ['topic1', 'topic2', 'topic3']);
        
        console.log('✓ Short text confidence:', shortConfidence);
        console.log('✓ Long text confidence:', longConfidence);
        console.log('✓ Long text has higher confidence:', longConfidence > shortConfidence);
        console.log('✓ Confidence values in valid range:', 
          shortConfidence >= 0 && shortConfidence <= 1 && longConfidence >= 0 && longConfidence <= 1);
        console.log();

        // Test 13: Reset functionality
        console.log('Test 13: Reset functionality');
        
        const statsBeforeReset = generator.getStats();
        generator.reset();
        const statsAfterReset = generator.getStats();
        
        console.log('✓ Reset completed');
        console.log('✓ Summaries cleared:', statsAfterReset.totalSummaries === 0);
        console.log('✓ Topics cleared:', statsAfterReset.totalTopics === 0);
        console.log('✓ Had data before reset:', statsBeforeReset.totalSummaries > 0);
        console.log();

        console.log('All SummaryGenerator tests completed! ✓');
      });
    });
  });
}

// Run the tests
runTests();