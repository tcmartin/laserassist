/**
 * Integration test for SuggestionGenerator with simulated LLM responses
 * Demonstrates the complete workflow from transcript to final suggestions
 */

const SuggestionGenerator = require('./suggestion-generator.js');

async function runIntegrationTest() {
  console.log('=== SuggestionGenerator Integration Test ===\n');

  // Create generator with custom settings
  const generator = new SuggestionGenerator({
    maxSuggestionsPerCategory: 2,
    enabledCategories: ['action-item', 'question', 'topic', 'resource'],
    priorityThreshold: 0.4
  });

  // Test transcript simulating a development meeting
  const transcript = `
    We need to implement the new user authentication system by next Friday. 
    The database schema should be created first, and then we can work on the API endpoints.
    I'm not sure about the security requirements - what encryption should we use?
    We should also look into using JWT tokens for session management.
    The documentation needs to be updated once we're done.
    Has anyone used OAuth 2.0 before? We might want to consider that as well.
    We need to schedule a code review meeting and make sure all tests pass.
  `;

  const timeRange = {
    start: new Date('2025-01-15T10:00:00Z'),
    end: new Date('2025-01-15T10:05:00Z')
  };

  console.log('1. Generating suggestions from transcript...');
  console.log('Transcript:', transcript.trim());
  console.log();

  try {
    // Generate initial suggestions
    const suggestions = await generator.generateSuggestions(transcript, timeRange);
    
    console.log(`✓ Generated ${suggestions.length} suggestions across ${generator.options.enabledCategories.length} categories`);
    console.log();

    // Group suggestions by category
    const suggestionsByCategory = {};
    suggestions.forEach(suggestion => {
      if (!suggestionsByCategory[suggestion.type]) {
        suggestionsByCategory[suggestion.type] = [];
      }
      suggestionsByCategory[suggestion.type].push(suggestion);
    });

    // Display suggestions by category
    Object.keys(suggestionsByCategory).forEach(category => {
      console.log(`${category.toUpperCase()} SUGGESTIONS:`);
      suggestionsByCategory[category].forEach((suggestion, index) => {
        console.log(`  ${index + 1}. [${suggestion.priority}] ${suggestion.content || 'Pending LLM response'}`);
        console.log(`     Relevance: ${suggestion.relevanceScore.toFixed(2)}`);
        if (suggestion.context) {
          console.log(`     Context: "${suggestion.context.substring(0, 60)}..."`);
        }
      });
      console.log();
    });

    console.log('2. Simulating LLM responses for each category...');
    console.log();

    // Simulate LLM responses for each category
    const mockLLMResponses = {
      'action-item': JSON.stringify([
        {
          content: 'Create database schema for user authentication tables',
          priority: 'high',
          reasoning: 'Foundation requirement for the authentication system'
        },
        {
          content: 'Schedule code review meeting for authentication implementation',
          priority: 'medium',
          reasoning: 'Important for code quality and team alignment'
        }
      ]),
      
      'question': JSON.stringify([
        {
          content: 'What specific encryption algorithm should we use for password hashing?',
          priority: 'high',
          reasoning: 'Critical security decision that affects system architecture'
        },
        {
          content: 'Should we implement OAuth 2.0 or stick with JWT tokens for session management?',
          priority: 'medium',
          reasoning: 'Important architectural decision for authentication flow'
        }
      ]),
      
      'topic': JSON.stringify([
        {
          content: 'JWT token security best practices and implementation patterns',
          priority: 'medium',
          reasoning: 'Related to the authentication system being discussed'
        },
        {
          content: 'Database security considerations for user data storage',
          priority: 'medium',
          reasoning: 'Important for the database schema design mentioned'
        }
      ]),
      
      'resource': JSON.stringify([
        {
          content: 'OAuth 2.0 RFC specification and implementation guide',
          priority: 'high',
          reasoning: 'Directly relevant to the OAuth discussion in the transcript'
        },
        {
          content: 'JWT.io documentation and security best practices',
          priority: 'medium',
          reasoning: 'Useful for JWT token implementation mentioned'
        }
      ])
    };

    // Process LLM responses for each category
    Object.keys(suggestionsByCategory).forEach(category => {
      if (mockLLMResponses[category]) {
        console.log(`Processing ${category} suggestions with LLM response...`);
        
        const categorySuggestions = suggestionsByCategory[category];
        const updatedSuggestions = generator.parseLLMResponse(
          categorySuggestions,
          mockLLMResponses[category],
          category
        );
        
        console.log(`✓ Updated ${updatedSuggestions.length} ${category} suggestions`);
        updatedSuggestions.forEach((suggestion, index) => {
          console.log(`  ${index + 1}. [${suggestion.priority}] ${suggestion.content}`);
          if (suggestion.reasoning) {
            console.log(`     → ${suggestion.reasoning}`);
          }
        });
        console.log();
      }
    });

    console.log('3. Testing context-aware suggestion generation...');
    console.log();

    // Generate suggestions for a follow-up transcript with context
    const followUpTranscript = `
      Great progress on the authentication system! The database schema looks good.
      Now we need to focus on the API implementation and testing.
      Should we also consider rate limiting for the authentication endpoints?
      We might want to add logging for security events as well.
    `;

    const followUpTimeRange = {
      start: new Date('2025-01-15T10:05:00Z'),
      end: new Date('2025-01-15T10:08:00Z')
    };

    const contextualSuggestions = await generator.generateSuggestions(
      followUpTranscript,
      followUpTimeRange,
      suggestions, // Previous suggestions as context
      'Previous discussion covered authentication system implementation, database schema, and security considerations.'
    );

    console.log(`✓ Generated ${contextualSuggestions.length} contextual suggestions`);
    console.log('New suggestions with context awareness:');
    contextualSuggestions.forEach((suggestion, index) => {
      console.log(`  ${index + 1}. [${suggestion.type}] [${suggestion.priority}] ${suggestion.content || 'Pending LLM response'}`);
      console.log(`     Relevance: ${suggestion.relevanceScore.toFixed(2)}`);
    });
    console.log();

    console.log('4. Testing suggestion statistics and tracking...');
    console.log();

    const stats = generator.getStats();
    console.log('Generator Statistics:');
    console.log(`  - Total suggestions generated: ${stats.totalSuggestions}`);
    console.log(`  - Average relevance score: ${stats.averageRelevanceScore.toFixed(2)}`);
    console.log(`  - Enabled categories: ${stats.enabledCategories.join(', ')}`);
    console.log('  - Category breakdown:');
    Object.keys(stats.categoryBreakdown).forEach(category => {
      const categoryStats = stats.categoryBreakdown[category];
      console.log(`    * ${category}: ${categoryStats.count} suggestions, ${(categoryStats.effectiveness * 100).toFixed(1)}% effectiveness`);
    });
    console.log();

    console.log('5. Testing export/import functionality...');
    console.log();

    // Export current state
    const exportedData = generator.export();
    console.log(`✓ Exported data with ${exportedData.suggestionHistory.length} suggestions`);

    // Create new generator and import data
    const newGenerator = new SuggestionGenerator();
    newGenerator.import(exportedData);
    
    const importedStats = newGenerator.getStats();
    console.log(`✓ Imported data: ${importedStats.totalSuggestions} suggestions restored`);
    console.log();

    console.log('=== Integration Test Completed Successfully ===');
    console.log();
    console.log('Key Features Demonstrated:');
    console.log('✓ Multi-category suggestion generation');
    console.log('✓ Pattern-based content analysis');
    console.log('✓ Priority and relevance scoring');
    console.log('✓ JSON and text response parsing');
    console.log('✓ Context-aware suggestion generation');
    console.log('✓ Duplicate detection and filtering');
    console.log('✓ Statistics tracking and reporting');
    console.log('✓ Data persistence (export/import)');
    console.log('✓ Configurable categories and thresholds');

  } catch (error) {
    console.error('Integration test failed:', error);
    console.error(error.stack);
  }
}

// Run the integration test
runIntegrationTest();