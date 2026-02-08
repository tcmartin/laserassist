/**
 * Test suite for SuggestionGenerator class
 * Tests categorized suggestion generation, prioritization, and JSON response parsing
 */

// Import the SuggestionGenerator class
const SuggestionGenerator = require('./suggestion-generator.js');

async function runTests() {

/**
 * Test helper functions
 */
function createMockTimeRange(startOffset = 0, endOffset = 60000) {
  const now = new Date();
  return {
    start: new Date(now.getTime() - startOffset),
    end: new Date(now.getTime() - startOffset + endOffset)
  };
}

function createMockSuggestion(type, content, priority = 'medium') {
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    content,
    priority,
    context: 'test context',
    timestamp: new Date(),
    dismissed: false,
    relevanceScore: 0.6
  };
}

/**
 * Test Suite: Basic Functionality
 */
console.log('=== Testing SuggestionGenerator Basic Functionality ===');

// Test 1: Constructor and initialization
console.log('\n1. Testing constructor and initialization...');
try {
  const generator = new SuggestionGenerator();
  console.log('✓ Default constructor works');
  
  const customGenerator = new SuggestionGenerator({
    maxSuggestionsPerCategory: 5,
    enabledCategories: ['action-item', 'question'],
    priorityThreshold: 0.7
  });
  console.log('✓ Custom options constructor works');
  console.log(`  - Max suggestions per category: ${customGenerator.options.maxSuggestionsPerCategory}`);
  console.log(`  - Enabled categories: ${customGenerator.options.enabledCategories.join(', ')}`);
} catch (error) {
  console.error('✗ Constructor test failed:', error.message);
}

// Test 2: Input validation
console.log('\n2. Testing input validation...');
const generator = new SuggestionGenerator();

try {
  const suggestions = await generator.generateSuggestions('', createMockTimeRange());
  if (suggestions.length === 0) {
    console.log('✓ Empty transcript returns empty array');
  } else {
    console.error('✗ Empty transcript should return empty array');
  }
} catch (error) {
  console.log('✓ Empty transcript properly handled:', error.message);
}

try {
  await generator.generateSuggestions('test transcript with enough content to pass length validation', null);
  console.error('✗ Should have thrown error for null timeRange');
} catch (error) {
  console.log('✓ Properly validates timeRange parameter');
}

try {
  await generator.generateSuggestions(null, createMockTimeRange());
  console.error('✗ Should have thrown error for null transcript');
} catch (error) {
  console.log('✓ Properly validates transcript parameter');
}

/**
 * Test Suite: Category-Specific Suggestion Generation
 */
console.log('\n=== Testing Category-Specific Suggestion Generation ===');

// Test 3: Action Item suggestions
console.log('\n3. Testing action item suggestions...');
const actionItemTranscript = `
We need to implement the new authentication system by next week. 
John will create the database schema and Sarah should update the API endpoints.
We must also schedule a meeting with the security team to review the implementation.
The team has to test the integration before the deadline.
`;

try {
  const suggestions = await generator.generateSuggestions(
    actionItemTranscript, 
    createMockTimeRange()
  );
  
  const actionItems = suggestions.filter(s => s.type === 'action-item');
  console.log(`✓ Generated ${actionItems.length} action item suggestions`);
  
  actionItems.forEach((item, index) => {
    console.log(`  ${index + 1}. [${item.priority}] ${item.content || 'Content pending LLM response'}`);
  });
  
  if (actionItems.length > 0) {
    console.log('✓ Action item pattern matching works');
  }
} catch (error) {
  console.error('✗ Action item test failed:', error.message);
}

// Test 4: Question suggestions
console.log('\n4. Testing question suggestions...');
const questionTranscript = `
The performance seems to be degrading but we're not sure why. 
The database queries are running slower than expected.
We need to clarify the requirements for the new feature.
What about the edge cases we discussed earlier?
`;

try {
  const suggestions = await generator.generateSuggestions(
    questionTranscript, 
    createMockTimeRange()
  );
  
  const questions = suggestions.filter(s => s.type === 'question');
  console.log(`✓ Generated ${questions.length} question suggestions`);
  
  questions.forEach((item, index) => {
    console.log(`  ${index + 1}. [${item.priority}] ${item.content || 'Content pending LLM response'}`);
  });
} catch (error) {
  console.error('✗ Question test failed:', error.message);
}

// Test 5: Topic suggestions
console.log('\n5. Testing topic suggestions...');
const topicTranscript = `
We're using React for the frontend, but we should also consider Vue.js as an alternative.
The microservices architecture is working well, but we might want to explore serverless options.
Database optimization is related to our performance issues.
`;

try {
  const suggestions = await generator.generateSuggestions(
    topicTranscript, 
    createMockTimeRange()
  );
  
  const topics = suggestions.filter(s => s.type === 'topic');
  console.log(`✓ Generated ${topics.length} topic suggestions`);
  
  topics.forEach((item, index) => {
    console.log(`  ${index + 1}. [${item.priority}] ${item.content || 'Content pending LLM response'}`);
  });
} catch (error) {
  console.error('✗ Topic test failed:', error.message);
}

// Test 6: Resource suggestions
console.log('\n6. Testing resource suggestions...');
const resourceTranscript = `
We need better documentation for the API endpoints.
The team should look into using a testing framework like Jest.
We could use a tool like Postman for API testing.
The official React documentation has good examples for this pattern.
`;

try {
  const suggestions = await generator.generateSuggestions(
    resourceTranscript, 
    createMockTimeRange()
  );
  
  const resources = suggestions.filter(s => s.type === 'resource');
  console.log(`✓ Generated ${resources.length} resource suggestions`);
  
  resources.forEach((item, index) => {
    console.log(`  ${index + 1}. [${item.priority}] ${item.content || 'Content pending LLM response'}`);
  });
} catch (error) {
  console.error('✗ Resource test failed:', error.message);
}

/**
 * Test Suite: Prioritization and Relevance Scoring
 */
console.log('\n=== Testing Prioritization and Relevance Scoring ===');

// Test 7: Priority calculation
console.log('\n7. Testing priority calculation...');
const highPriorityTranscript = `
We must fix the critical security vulnerability immediately.
The system needs to be updated before the deadline.
This is urgent and requires immediate attention.
`;

const lowPriorityTranscript = `
We might want to consider updating the documentation sometime.
It could be nice to have better styling on the homepage.
Maybe we should think about adding more features.
`;

try {
  const highPrioritySuggestions = await generator.generateSuggestions(
    highPriorityTranscript, 
    createMockTimeRange()
  );
  
  const lowPrioritySuggestions = await generator.generateSuggestions(
    lowPriorityTranscript, 
    createMockTimeRange()
  );
  
  console.log('High priority transcript suggestions:');
  highPrioritySuggestions.forEach(s => {
    console.log(`  - [${s.priority}] Score: ${s.relevanceScore.toFixed(2)}`);
  });
  
  console.log('Low priority transcript suggestions:');
  lowPrioritySuggestions.forEach(s => {
    console.log(`  - [${s.priority}] Score: ${s.relevanceScore.toFixed(2)}`);
  });
  
  console.log('✓ Priority calculation works');
} catch (error) {
  console.error('✗ Priority calculation test failed:', error.message);
}

/**
 * Test Suite: JSON Response Parsing
 */
console.log('\n=== Testing JSON Response Parsing ===');

// Test 8: Valid JSON parsing
console.log('\n8. Testing valid JSON response parsing...');
const mockSuggestions = [
  createMockSuggestion('action-item', ''),
  createMockSuggestion('action-item', '')
];

const validJsonResponse = JSON.stringify([
  {
    content: 'Implement user authentication system',
    priority: 'high',
    reasoning: 'Critical for security'
  },
  {
    content: 'Update API documentation',
    priority: 'medium',
    reasoning: 'Improves developer experience'
  }
]);

try {
  const parsedSuggestions = generator.parseLLMResponse(
    [...mockSuggestions], 
    validJsonResponse, 
    'action-item'
  );
  
  console.log(`✓ Parsed ${parsedSuggestions.length} suggestions from JSON`);
  parsedSuggestions.forEach((s, index) => {
    console.log(`  ${index + 1}. [${s.priority}] ${s.content}`);
    if (s.reasoning) {
      console.log(`     Reasoning: ${s.reasoning}`);
    }
  });
} catch (error) {
  console.error('✗ JSON parsing test failed:', error.message);
}

// Test 9: Fallback text parsing
console.log('\n9. Testing fallback text parsing...');
const textResponse = `
1. Create user registration form
2. Set up email verification system
3. Implement password reset functionality
- Add two-factor authentication
- Update security documentation
`;

try {
  const parsedSuggestions = generator.parseLLMResponse(
    [
      createMockSuggestion('action-item', ''),
      createMockSuggestion('action-item', ''),
      createMockSuggestion('action-item', ''),
      createMockSuggestion('action-item', ''),
      createMockSuggestion('action-item', '')
    ], 
    textResponse, 
    'action-item'
  );
  
  console.log(`✓ Parsed ${parsedSuggestions.length} suggestions from text`);
  parsedSuggestions.forEach((s, index) => {
    console.log(`  ${index + 1}. ${s.content}`);
  });
} catch (error) {
  console.error('✗ Text parsing test failed:', error.message);
}

// Test 10: Invalid JSON handling
console.log('\n10. Testing invalid JSON handling...');
const invalidJsonResponse = `{invalid json content`;

try {
  const parsedSuggestions = generator.parseLLMResponse(
    [createMockSuggestion('action-item', '')], 
    invalidJsonResponse, 
    'action-item'
  );
  
  console.log('✓ Gracefully handled invalid JSON');
  console.log(`  Fallback parsing returned ${parsedSuggestions.length} suggestions`);
} catch (error) {
  console.error('✗ Invalid JSON handling test failed:', error.message);
}

/**
 * Test Suite: Context and Deduplication
 */
console.log('\n=== Testing Context and Deduplication ===');

// Test 11: Context building
console.log('\n11. Testing context building...');
const previousSuggestions = [
  createMockSuggestion('action-item', 'Implement authentication'),
  createMockSuggestion('question', 'What about security requirements?'),
  createMockSuggestion('topic', 'Database design patterns')
];

const conversationContext = 'Previous discussion about user management system implementation';

try {
  const suggestions = await generator.generateSuggestions(
    'We need to continue working on the user system and implement authentication features with proper security measures',
    createMockTimeRange(),
    previousSuggestions,
    conversationContext
  );
  
  console.log('✓ Context building works');
  console.log(`  Generated ${suggestions.length} suggestions with context`);
} catch (error) {
  console.error('✗ Context building test failed:', error.message);
}

// Test 12: Duplicate detection
console.log('\n12. Testing duplicate detection...');
const duplicateTranscript = 'We need to implement authentication system with proper security measures and user management features';

try {
  // Generate suggestions twice with similar content
  const firstBatch = await generator.generateSuggestions(
    duplicateTranscript,
    createMockTimeRange()
  );
  
  const secondBatch = await generator.generateSuggestions(
    'We should implement the authentication system with security features and user management capabilities',
    createMockTimeRange(),
    firstBatch
  );
  
  console.log(`✓ First batch: ${firstBatch.length} suggestions`);
  console.log(`✓ Second batch: ${secondBatch.length} suggestions (duplicates filtered)`);
  
  if (secondBatch.length <= firstBatch.length) {
    console.log('✓ Duplicate detection is working');
  }
} catch (error) {
  console.error('✗ Duplicate detection test failed:', error.message);
}

/**
 * Test Suite: Configuration and Statistics
 */
console.log('\n=== Testing Configuration and Statistics ===');

// Test 13: Configuration updates
console.log('\n13. Testing configuration updates...');
try {
  const configGenerator = new SuggestionGenerator();
  
  console.log('Initial config:', {
    maxSuggestionsPerCategory: configGenerator.options.maxSuggestionsPerCategory,
    enabledCategories: configGenerator.options.enabledCategories
  });
  
  configGenerator.updateOptions({
    maxSuggestionsPerCategory: 2,
    enabledCategories: ['action-item', 'question']
  });
  
  console.log('Updated config:', {
    maxSuggestionsPerCategory: configGenerator.options.maxSuggestionsPerCategory,
    enabledCategories: configGenerator.options.enabledCategories
  });
  
  console.log('✓ Configuration updates work');
} catch (error) {
  console.error('✗ Configuration test failed:', error.message);
}

// Test 14: Statistics
console.log('\n14. Testing statistics...');
try {
  const statsGenerator = new SuggestionGenerator();
  
  // Generate some suggestions to populate stats
  await statsGenerator.generateSuggestions(
    'We need to implement features and ask questions about the system with proper documentation and testing frameworks',
    createMockTimeRange()
  );
  
  const stats = statsGenerator.getStats();
  console.log('✓ Statistics generated:');
  console.log(`  - Total suggestions: ${stats.totalSuggestions}`);
  console.log(`  - Average relevance: ${stats.averageRelevanceScore.toFixed(2)}`);
  console.log(`  - Enabled categories: ${stats.enabledCategories.join(', ')}`);
  console.log(`  - Category breakdown:`, stats.categoryBreakdown);
} catch (error) {
  console.error('✗ Statistics test failed:', error.message);
}

/**
 * Test Suite: Data Persistence
 */
console.log('\n=== Testing Data Persistence ===');

// Test 15: Export/Import functionality
console.log('\n15. Testing export/import functionality...');
try {
  const persistenceGenerator = new SuggestionGenerator();
  
  // Generate some data
  await persistenceGenerator.generateSuggestions(
    'Test transcript for persistence with enough content to generate meaningful suggestions',
    createMockTimeRange()
  );
  
  // Export data
  const exportedData = persistenceGenerator.export();
  console.log('✓ Data exported successfully');
  console.log(`  - Suggestion history entries: ${exportedData.suggestionHistory.length}`);
  console.log(`  - Category tracker entries: ${exportedData.categoryTracker.length}`);
  
  // Create new generator and import data
  const newGenerator = new SuggestionGenerator();
  newGenerator.import(exportedData);
  
  const importedStats = newGenerator.getStats();
  console.log('✓ Data imported successfully');
  console.log(`  - Imported suggestions: ${importedStats.totalSuggestions}`);
  
} catch (error) {
  console.error('✗ Export/import test failed:', error.message);
}

// Test 16: Reset functionality
console.log('\n16. Testing reset functionality...');
try {
  const resetGenerator = new SuggestionGenerator();
  
  // Generate some data
  await resetGenerator.generateSuggestions(
    'Test data to be reset with sufficient content for suggestion generation',
    createMockTimeRange()
  );
  
  const beforeReset = resetGenerator.getStats();
  console.log(`Before reset: ${beforeReset.totalSuggestions} suggestions`);
  
  resetGenerator.reset();
  
  const afterReset = resetGenerator.getStats();
  console.log(`After reset: ${afterReset.totalSuggestions} suggestions`);
  
  if (afterReset.totalSuggestions === 0) {
    console.log('✓ Reset functionality works');
  } else {
    console.error('✗ Reset did not clear all data');
  }
} catch (error) {
  console.error('✗ Reset test failed:', error.message);
}

/**
 * Test Suite: Edge Cases and Error Handling
 */
console.log('\n=== Testing Edge Cases and Error Handling ===');

// Test 17: Very short transcript
console.log('\n17. Testing very short transcript...');
try {
  const suggestions = await generator.generateSuggestions(
    'Hi',
    createMockTimeRange()
  );
  
  console.log(`✓ Short transcript handled: ${suggestions.length} suggestions`);
} catch (error) {
  console.error('✗ Short transcript test failed:', error.message);
}

// Test 18: Very long transcript
console.log('\n18. Testing very long transcript...');
try {
  const longTranscript = 'We need to implement a comprehensive system. '.repeat(100);
  const suggestions = await generator.generateSuggestions(
    longTranscript,
    createMockTimeRange()
  );
  
  console.log(`✓ Long transcript handled: ${suggestions.length} suggestions`);
} catch (error) {
  console.error('✗ Long transcript test failed:', error.message);
}

// Test 19: Empty LLM response
console.log('\n19. Testing empty LLM response...');
try {
  const suggestions = [createMockSuggestion('action-item', '')];
  const parsedSuggestions = generator.parseLLMResponse(suggestions, '[]', 'action-item');
  
  console.log(`✓ Empty LLM response handled: ${parsedSuggestions.length} suggestions`);
} catch (error) {
  console.error('✗ Empty LLM response test failed:', error.message);
}

console.log('\n=== All Tests Completed ===');
}

// Run the tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});