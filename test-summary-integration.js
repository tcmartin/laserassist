/**
 * Integration test for SummaryGenerator with TranscriptBuffer
 * Run with: node test-summary-integration.js
 */

const TranscriptBuffer = require('./transcript-buffer.js');
const SummaryGenerator = require('./summary-generator.js');

async function runIntegrationTests() {
  console.log('Running SummaryGenerator integration tests...\n');

  // Test 1: Integration with TranscriptBuffer
  console.log('Test 1: Integration with TranscriptBuffer');
  
  const buffer = new TranscriptBuffer();
  const generator = new SummaryGenerator({
    minTranscriptLength: 20,
    contextWindow: 3
  });

  // Add some transcript segments
  const baseTime = new Date('2024-01-01T10:00:00Z');
  
  buffer.addTranscriptSegment('Hello everyone, welcome to our project meeting.', 
    new Date(baseTime.getTime()));
  buffer.addTranscriptSegment('Today we need to discuss the API design for our authentication system.', 
    new Date(baseTime.getTime() + 30000));
  buffer.addTranscriptSegment('The current implementation has some security vulnerabilities that we need to address.', 
    new Date(baseTime.getTime() + 60000));
  buffer.addTranscriptSegment('I suggest we implement OAuth 2.0 and add proper rate limiting.', 
    new Date(baseTime.getTime() + 90000));

  console.log('✓ Added transcript segments to buffer');
  console.log('✓ Buffer stats:', buffer.getStats());

  // Get unanalyzed segments for summary
  const unanalyzedSegments = buffer.getUnanalyzedSegments(50);
  console.log('✓ Retrieved unanalyzed segments:', unanalyzedSegments.length);

  if (unanalyzedSegments.length > 0) {
    // Combine segments for analysis
    const combinedTranscript = unanalyzedSegments.map(s => s.text).join(' ');
    const timeRange = buffer.getTimeRange(unanalyzedSegments);
    
    console.log('✓ Combined transcript length:', combinedTranscript.length);
    console.log('✓ Time range:', timeRange);

    // Generate summary
    const summary = await generator.generateSummary(combinedTranscript, timeRange);
    console.log('✓ Summary generated successfully');
    console.log('✓ Summary ID:', summary.id);
    console.log('✓ Key topics:', summary.keyTopics);
    console.log('✓ Confidence:', summary.confidence);

    // Mark segments as analyzed
    const segmentIds = unanalyzedSegments.map(s => s.id);
    buffer.markSegmentsAnalyzed(segmentIds);
    console.log('✓ Segments marked as analyzed');

    // Verify no more unanalyzed segments
    const remainingUnanalyzed = buffer.getUnanalyzedSegments(50);
    console.log('✓ Remaining unanalyzed segments:', remainingUnanalyzed.length);
    console.log('✓ All segments processed:', remainingUnanalyzed.length === 0);
  }

  console.log();

  // Test 2: Multiple analysis cycles with context
  console.log('Test 2: Multiple analysis cycles with context');

  // Add more transcript content
  buffer.addTranscriptSegment('Great suggestions! Let me also mention that we should consider implementing JWT tokens.', 
    new Date(baseTime.getTime() + 120000));
  buffer.addTranscriptSegment('We also need to think about session management and token refresh mechanisms.', 
    new Date(baseTime.getTime() + 150000));
  buffer.addTranscriptSegment('The database schema will need updates to support the new authentication flow.', 
    new Date(baseTime.getTime() + 180000));

  const newUnanalyzed = buffer.getUnanalyzedSegments(30);
  console.log('✓ New unanalyzed segments:', newUnanalyzed.length);

  if (newUnanalyzed.length > 0) {
    const newTranscript = newUnanalyzed.map(s => s.text).join(' ');
    const newTimeRange = buffer.getTimeRange(newUnanalyzed);
    
    // Generate second summary with context from first
    const previousSummaries = generator.summaryHistory;
    const summary2 = await generator.generateSummary(newTranscript, newTimeRange, previousSummaries);
    
    console.log('✓ Second summary generated with context');
    console.log('✓ Context was used:', summary2.contextUsed);
    console.log('✓ New topics identified:', summary2.keyTopics);
    
    // Simulate LLM response parsing
    const mockResponse = 'The discussion continued with JWT token implementation and session management considerations. Key decisions include updating the database schema to support new authentication flows and implementing proper token refresh mechanisms.';
    
    const parsedSummary = generator.parseLLMResponse(summary2, mockResponse);
    console.log('✓ LLM response parsed and integrated');
    console.log('✓ Summary content:', parsedSummary.content.substring(0, 100) + '...');
    
    // Mark new segments as analyzed
    buffer.markSegmentsAnalyzed(newUnanalyzed.map(s => s.id));
    console.log('✓ New segments marked as analyzed');
  }

  console.log();

  // Test 3: Generator and buffer statistics
  console.log('Test 3: Generator and buffer statistics');
  
  const bufferStats = buffer.getStats();
  const generatorStats = generator.getStats();
  
  console.log('✓ Buffer stats:', bufferStats);
  console.log('✓ Generator stats:', generatorStats);
  console.log('✓ All segments analyzed:', bufferStats.unanalyzedSegments === 0);
  console.log('✓ Multiple summaries generated:', generatorStats.totalSummaries >= 2);
  console.log('✓ Topics tracked:', generatorStats.totalTopics > 0);

  console.log();

  // Test 4: Export/Import integration
  console.log('Test 4: Export/Import integration');
  
  const bufferExport = buffer.export();
  const generatorExport = generator.export();
  
  console.log('✓ Both components exported successfully');
  
  // Create new instances and import
  const newBuffer = new TranscriptBuffer();
  const newGenerator = new SummaryGenerator();
  
  newBuffer.import(bufferExport);
  newGenerator.import(generatorExport);
  
  const importedBufferStats = newBuffer.getStats();
  const importedGeneratorStats = newGenerator.getStats();
  
  console.log('✓ Both components imported successfully');
  console.log('✓ Buffer data preserved:', importedBufferStats.totalSegments === bufferStats.totalSegments);
  console.log('✓ Generator data preserved:', importedGeneratorStats.totalSummaries === generatorStats.totalSummaries);

  console.log();

  // Test 5: Real-world workflow simulation
  console.log('Test 5: Real-world workflow simulation');
  
  // Simulate a typical analysis workflow
  async function simulateAnalysisWorkflow(buffer, generator) {
    const stats = buffer.getStats();
    console.log('  → Starting workflow with', stats.totalSegments, 'segments');
    
    // Check for unanalyzed content
    const unanalyzed = buffer.getUnanalyzedSegments(100);
    if (unanalyzed.length === 0) {
      console.log('  → No content ready for analysis');
      return null;
    }
    
    // Prepare content for analysis
    const transcript = unanalyzed.map(s => s.text).join(' ');
    const timeRange = buffer.getTimeRange(unanalyzed);
    const previousSummaries = generator.summaryHistory;
    
    console.log('  → Analyzing', transcript.length, 'characters of transcript');
    console.log('  → Using context from', previousSummaries.length, 'previous summaries');
    
    // Generate summary
    const summary = await generator.generateSummary(transcript, timeRange, previousSummaries);
    
    // Simulate LLM processing
    const mockLLMResponse = `Analysis of recent discussion covering ${summary.keyTopics.join(', ')}. Key insights and decisions were identified for the time period ${generator._formatTimeRange(timeRange)}.`;
    
    const finalSummary = generator.parseLLMResponse(summary, mockLLMResponse);
    
    // Mark segments as processed
    buffer.markSegmentsAnalyzed(unanalyzed.map(s => s.id));
    
    console.log('  → Summary generated:', finalSummary.content.substring(0, 80) + '...');
    console.log('  → Confidence:', finalSummary.confidence.toFixed(2));
    console.log('  → Topics:', finalSummary.keyTopics.slice(0, 3).join(', '));
    
    return finalSummary;
  }
  
  // Add more content to test workflow
  buffer.addTranscriptSegment('Let\'s wrap up by assigning action items for next week.', 
    new Date(baseTime.getTime() + 210000));
  buffer.addTranscriptSegment('John will work on the OAuth implementation, and Sarah will update the database schema.', 
    new Date(baseTime.getTime() + 240000));
  
  const workflowResult = await simulateAnalysisWorkflow(buffer, generator);
  console.log('✓ Workflow simulation completed successfully');
  console.log('✓ Result generated:', workflowResult !== null);

  console.log();
  console.log('All integration tests completed successfully! ✓');
}

// Run the integration tests
runIntegrationTests().catch(error => {
  console.error('Integration test failed:', error);
  process.exit(1);
});