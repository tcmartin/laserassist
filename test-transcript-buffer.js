/**
 * Simple test suite for TranscriptBuffer class
 * Run with: node test-transcript-buffer.js
 */

const TranscriptBuffer = require('./transcript-buffer.js');

function runTests() {
  console.log('Running TranscriptBuffer tests...\n');

  // Test 1: Basic instantiation
  console.log('Test 1: Basic instantiation');
  const buffer = new TranscriptBuffer();
  console.log('✓ TranscriptBuffer created successfully');
  console.log('✓ Initial stats:', buffer.getStats());
  console.log();

  // Test 2: Adding segments
  console.log('Test 2: Adding segments');
  const id1 = buffer.addTranscriptSegment('Hello world', new Date());
  const id2 = buffer.addTranscriptSegment('This is a test', new Date(Date.now() + 1000));
  const id3 = buffer.addTranscriptSegment('More transcript content', new Date(Date.now() + 2000));
  
  console.log('✓ Added 3 segments');
  console.log('✓ Segment IDs:', [id1, id2, id3]);
  console.log('✓ Stats after adding:', buffer.getStats());
  console.log();

  // Test 3: Getting full context
  console.log('Test 3: Getting full context');
  const fullText = buffer.getFullContext();
  console.log('✓ Full context:', fullText);
  console.log('✓ Expected: "Hello world This is a test More transcript content"');
  console.log();

  // Test 4: Getting unanalyzed segments
  console.log('Test 4: Getting unanalyzed segments');
  const unanalyzed = buffer.getUnanalyzedSegments(10);
  console.log('✓ Unanalyzed segments count:', unanalyzed.length);
  console.log('✓ Should be 3:', unanalyzed.length === 3);
  console.log();

  // Test 5: Marking segments as analyzed
  console.log('Test 5: Marking segments as analyzed');
  buffer.markSegmentsAnalyzed([id1, id2]);
  const stillUnanalyzed = buffer.getUnanalyzedSegments(10);
  console.log('✓ Marked 2 segments as analyzed');
  console.log('✓ Remaining unanalyzed:', stillUnanalyzed.length);
  console.log('✓ Should be 1:', stillUnanalyzed.length === 1);
  console.log();

  // Test 6: Getting segments since timestamp
  console.log('Test 6: Getting segments since timestamp');
  const recentTime = new Date(Date.now() + 500);
  const recentSegments = buffer.getSegmentsSince(recentTime);
  console.log('✓ Segments since recent time:', recentSegments.length);
  console.log('✓ Should be 2:', recentSegments.length === 2);
  console.log();

  // Test 7: Time range calculation
  console.log('Test 7: Time range calculation');
  const timeRange = buffer.getTimeRange();
  console.log('✓ Time range calculated');
  console.log('✓ Start time:', timeRange.start);
  console.log('✓ End time:', timeRange.end);
  console.log();

  // Test 8: Export/Import functionality
  console.log('Test 8: Export/Import functionality');
  const exportData = buffer.export();
  const newBuffer = new TranscriptBuffer();
  newBuffer.import(exportData);
  
  const importedStats = newBuffer.getStats();
  const originalStats = buffer.getStats();
  
  console.log('✓ Export/import completed');
  console.log('✓ Original segments:', originalStats.totalSegments);
  console.log('✓ Imported segments:', importedStats.totalSegments);
  console.log('✓ Segments match:', originalStats.totalSegments === importedStats.totalSegments);
  console.log();

  // Test 9: Cleanup functionality
  console.log('Test 9: Cleanup functionality');
  // Add many segments to test cleanup
  for (let i = 0; i < 10; i++) {
    buffer.addTranscriptSegment(`Segment ${i}`, new Date(Date.now() + i * 100));
  }
  
  const beforeCleanup = buffer.getStats().totalSegments;
  const removed = buffer.cleanup(5, 3600000); // Keep only 5 segments
  const afterCleanup = buffer.getStats().totalSegments;
  
  console.log('✓ Before cleanup:', beforeCleanup);
  console.log('✓ After cleanup:', afterCleanup);
  console.log('✓ Removed segments:', removed);
  console.log('✓ Should be 5 segments remaining:', afterCleanup === 5);
  console.log();

  // Test 10: Error handling
  console.log('Test 10: Error handling');
  try {
    buffer.addTranscriptSegment(''); // Empty string should be handled
    console.log('✗ Should have thrown error for empty string');
  } catch (e) {
    console.log('✓ Correctly threw error for empty string:', e.message);
  }

  try {
    buffer.addTranscriptSegment(null); // Null should throw error
    console.log('✗ Should have thrown error for null');
  } catch (e) {
    console.log('✓ Correctly threw error for null:', e.message);
  }
  console.log();

  console.log('All tests completed! ✓');
}

// Run the tests
runTests();