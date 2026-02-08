/**
 * SuggestionGenerator - Generates contextual suggestions from transcript segments
 * 
 * This class provides structured prompt generation for suggestion analysis and
 * manages categorized suggestion generation with prioritization and relevance scoring.
 */
class SuggestionGenerator {
  constructor(options = {}) {
    this.options = {
      maxSuggestionsPerCategory: options.maxSuggestionsPerCategory || 3,
      minTranscriptLength: options.minTranscriptLength || 50,
      contextWindow: options.contextWindow || 3, // Number of previous suggestions to include
      enabledCategories: options.enabledCategories || ['action-item', 'question', 'topic', 'resource'],
      priorityThreshold: options.priorityThreshold || 0.5, // Minimum relevance score
      ...options
    };
    
    this.suggestionHistory = [];
    this.categoryTracker = new Map(); // Track category frequency and effectiveness
    this.contextTracker = new Map(); // Track context patterns for better suggestions
  }

  /**
   * Generates suggestions for the given transcript segment
   * @param {string} transcript - The transcript text to analyze
   * @param {Object} timeRange - Object with start and end Date objects
   * @param {Array} previousSuggestions - Array of previous Suggestion objects for context
   * @param {string} conversationContext - Additional context from summaries or previous analysis
   * @returns {Array} - Array of Suggestion objects
   */
  async generateSuggestions(transcript, timeRange, previousSuggestions = [], conversationContext = '') {
    // Validate input
    if (!transcript || typeof transcript !== 'string') {
      throw new Error('Transcript must be a non-empty string');
    }

    if (transcript.trim().length < this.options.minTranscriptLength) {
      return [];
    }

    if (!timeRange || !timeRange.start || !timeRange.end) {
      throw new Error('Valid timeRange with start and end dates is required');
    }

    // Build context from previous suggestions and conversation
    const context = this._buildContext(previousSuggestions, conversationContext);
    
    // Generate suggestions for each enabled category
    const suggestions = [];
    
    for (const category of this.options.enabledCategories) {
      const categorySuggestions = await this._generateCategorySuggestions(
        transcript, 
        category, 
        context, 
        timeRange
      );
      suggestions.push(...categorySuggestions);
    }

    // Filter and prioritize suggestions
    const filteredSuggestions = this._filterAndPrioritizeSuggestions(suggestions, previousSuggestions);
    
    // Update tracking
    this._updateCategoryTracking(filteredSuggestions);
    this._updateContextTracking(transcript, filteredSuggestions);
    
    // Add to history
    this.suggestionHistory.push(...filteredSuggestions);
    
    // Maintain history size
    if (this.suggestionHistory.length > this.options.contextWindow * 10) {
      this.suggestionHistory = this.suggestionHistory.slice(-this.options.contextWindow * 10);
    }

    return filteredSuggestions;
  }

  /**
   * Generates suggestions for a specific category
   * @param {string} transcript - The transcript text
   * @param {string} category - The suggestion category
   * @param {string} context - Context from previous suggestions
   * @param {Object} timeRange - Time range for the transcript
   * @returns {Array} - Array of suggestions for the category
   */
  async _generateCategorySuggestions(transcript, category, context, timeRange) {
    const prompt = this._generateCategoryPrompt(transcript, category, context);
    
    // Create base suggestions (content will be filled by LLM response)
    const suggestions = [];
    
    // Generate category-specific suggestions based on patterns
    const categoryPatterns = this._getCategoryPatterns(category);
    const matches = this._findPatternMatches(transcript, categoryPatterns);
    
    matches.forEach((match, index) => {
      if (index < this.options.maxSuggestionsPerCategory) {
        const suggestion = {
          id: this._generateId(),
          type: category,
          content: '', // To be filled by LLM response or pattern matching
          priority: this._calculateInitialPriority(match, category),
          context: match.context || transcript.substring(Math.max(0, match.index - 50), match.index + match.length + 50),
          timestamp: new Date(),
          dismissed: false,
          relevanceScore: match.score || 0.5,
          prompt // Include prompt for testing/debugging
        };
        
        // Set content based on pattern or prepare for LLM
        if (match.suggestedContent) {
          suggestion.content = match.suggestedContent;
        }
        
        suggestions.push(suggestion);
      }
    });

    return suggestions;
  }

  /**
   * Generates a structured prompt for suggestion generation
   * @param {string} transcript - The transcript to analyze
   * @param {string} category - The suggestion category
   * @param {string} context - Context from previous suggestions
   * @returns {string} - Formatted prompt for LLM
   */
  _generateCategoryPrompt(transcript, category, context) {
    let prompt = `Based on this conversation transcript, provide relevant ${category} suggestions:\n\n`;
    
    // Add context if available
    if (context && context.length > 0) {
      prompt += `Previous context:\n${context}\n\n`;
    }
    
    prompt += `Current transcript:\n${transcript}\n\n`;
    
    // Category-specific instructions
    switch (category) {
      case 'action-item':
        prompt += `Generate specific, actionable tasks or follow-ups mentioned or implied in the conversation. Focus on:\n`;
        prompt += `- Tasks that need to be completed\n`;
        prompt += `- Follow-up actions mentioned\n`;
        prompt += `- Decisions that require implementation\n`;
        prompt += `- Commitments made by participants\n`;
        break;
        
      case 'question':
        prompt += `Generate clarifying questions that would help deepen the conversation. Focus on:\n`;
        prompt += `- Areas that need more detail or explanation\n`;
        prompt += `- Potential concerns or edge cases\n`;
        prompt += `- Follow-up questions to explore topics further\n`;
        prompt += `- Questions to validate understanding\n`;
        break;
        
      case 'topic':
        prompt += `Identify related subjects that might be worth exploring. Focus on:\n`;
        prompt += `- Related technologies, concepts, or approaches\n`;
        prompt += `- Adjacent topics that could provide value\n`;
        prompt += `- Areas for deeper exploration\n`;
        prompt += `- Connections to broader themes\n`;
        break;
        
      case 'resource':
        prompt += `Suggest helpful tools, documents, or references. Focus on:\n`;
        prompt += `- Tools that could solve mentioned problems\n`;
        prompt += `- Documentation or guides that would be helpful\n`;
        prompt += `- Best practices or standards to consider\n`;
        prompt += `- Examples or case studies that apply\n`;
        break;
    }
    
    prompt += `\nFormat as JSON array with objects containing 'content', 'priority' (high/medium/low), and 'reasoning'.`;
    prompt += `\nLimit to ${this.options.maxSuggestionsPerCategory} most relevant suggestions.`;
    prompt += `\nIf no meaningful suggestions can be derived, return an empty array.`;

    return prompt;
  }

  /**
   * Gets pattern matching rules for each category
   * @param {string} category - The suggestion category
   * @returns {Array} - Array of pattern objects
   */
  _getCategoryPatterns(category) {
    const patterns = {
      'action-item': [
        {
          pattern: /\b(need to|should|must|have to|will|going to)\s+([^.!?]+)/gi,
          priority: 'high',
          scoreBoost: 0.3
        },
        {
          pattern: /\b(todo|task|action|follow[- ]?up|next step)\b/gi,
          priority: 'medium',
          scoreBoost: 0.2
        },
        {
          pattern: /\b(implement|create|build|develop|design|fix|update)\s+([^.!?]+)/gi,
          priority: 'medium',
          scoreBoost: 0.2
        },
        {
          pattern: /\b(schedule|plan|organize|coordinate)\s+([^.!?]+)/gi,
          priority: 'medium',
          scoreBoost: 0.15
        }
      ],
      
      'question': [
        {
          pattern: /\b(how|what|why|when|where|which|who)\b.*\?/gi,
          priority: 'high',
          scoreBoost: 0.3
        },
        {
          pattern: /\b(unclear|confusing|not sure|uncertain|question)\b/gi,
          priority: 'medium',
          scoreBoost: 0.2
        },
        {
          pattern: /\b(more detail|elaborate|explain|clarify)\b/gi,
          priority: 'medium',
          scoreBoost: 0.2
        },
        {
          pattern: /\b(edge case|what if|consider|think about)\b/gi,
          priority: 'medium',
          scoreBoost: 0.15
        }
      ],
      
      'topic': [
        {
          pattern: /\b(related|similar|also|additionally|furthermore)\b/gi,
          priority: 'medium',
          scoreBoost: 0.2
        },
        {
          pattern: /\b(technology|approach|method|strategy|solution)\b/gi,
          priority: 'medium',
          scoreBoost: 0.15
        },
        {
          pattern: /\b(alternative|option|possibility|consider)\b/gi,
          priority: 'medium',
          scoreBoost: 0.15
        }
      ],
      
      'resource': [
        {
          pattern: /\b(tool|library|framework|documentation|guide)\b/gi,
          priority: 'high',
          scoreBoost: 0.3
        },
        {
          pattern: /\b(example|tutorial|reference|best practice)\b/gi,
          priority: 'medium',
          scoreBoost: 0.2
        },
        {
          pattern: /\b(standard|specification|protocol|api)\b/gi,
          priority: 'medium',
          scoreBoost: 0.2
        }
      ]
    };

    return patterns[category] || [];
  }

  /**
   * Finds pattern matches in transcript
   * @param {string} transcript - The transcript text
   * @param {Array} patterns - Array of pattern objects
   * @returns {Array} - Array of match objects
   */
  _findPatternMatches(transcript, patterns) {
    const matches = [];
    
    patterns.forEach(patternObj => {
      const regex = new RegExp(patternObj.pattern.source, patternObj.pattern.flags);
      let match;
      
      while ((match = regex.exec(transcript)) !== null) {
        const matchObj = {
          index: match.index,
          length: match[0].length,
          text: match[0],
          captured: match[1] || match[0],
          score: 0.5 + (patternObj.scoreBoost || 0),
          priority: patternObj.priority || 'medium',
          context: transcript.substring(
            Math.max(0, match.index - 30), 
            Math.min(transcript.length, match.index + match[0].length + 30)
          )
        };
        
        matches.push(matchObj);
      }
    });

    // Remove duplicates and sort by score
    const uniqueMatches = matches.filter((match, index, arr) => 
      arr.findIndex(m => Math.abs(m.index - match.index) < 10) === index
    );
    
    return uniqueMatches.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculates initial priority for a suggestion
   * @param {Object} match - Pattern match object
   * @param {string} category - Suggestion category
   * @returns {string} - Priority level
   */
  _calculateInitialPriority(match, category) {
    let score = match.score || 0.5;
    
    // Boost score based on category importance
    const categoryBoosts = {
      'action-item': 0.2,
      'question': 0.1,
      'topic': 0.05,
      'resource': 0.1
    };
    
    score += categoryBoosts[category] || 0;
    
    // Convert score to priority
    if (score >= 0.8) return 'high';
    if (score >= 0.6) return 'medium';
    return 'low';
  }

  /**
   * Filters and prioritizes suggestions based on relevance and previous suggestions
   * @param {Array} suggestions - Array of generated suggestions
   * @param {Array} previousSuggestions - Array of previous suggestions for deduplication
   * @returns {Array} - Filtered and prioritized suggestions
   */
  _filterAndPrioritizeSuggestions(suggestions, previousSuggestions) {
    // Remove duplicates based on content similarity
    const filtered = suggestions.filter(suggestion => {
      return !this._isDuplicateSuggestion(suggestion, previousSuggestions);
    });
    
    // Calculate final relevance scores
    filtered.forEach(suggestion => {
      suggestion.relevanceScore = this._calculateRelevanceScore(suggestion);
    });
    
    // Filter by minimum threshold
    const thresholdFiltered = filtered.filter(
      suggestion => suggestion.relevanceScore >= this.options.priorityThreshold
    );
    
    // Sort by relevance score and priority
    return thresholdFiltered.sort((a, b) => {
      const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      
      if (priorityDiff !== 0) return priorityDiff;
      return b.relevanceScore - a.relevanceScore;
    });
  }

  /**
   * Checks if a suggestion is a duplicate of previous suggestions
   * @param {Object} suggestion - Suggestion to check
   * @param {Array} previousSuggestions - Array of previous suggestions
   * @returns {boolean} - True if duplicate
   */
  _isDuplicateSuggestion(suggestion, previousSuggestions) {
    const recentSuggestions = previousSuggestions.slice(-20); // Check last 20 suggestions
    
    return recentSuggestions.some(prev => {
      // Same type and similar content
      if (prev.type === suggestion.type) {
        const similarity = this._calculateTextSimilarity(
          suggestion.content.toLowerCase(), 
          prev.content.toLowerCase()
        );
        return similarity > 0.7; // 70% similarity threshold
      }
      return false;
    });
  }

  /**
   * Calculates text similarity between two strings
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} - Similarity score between 0 and 1
   */
  _calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const words1 = new Set(text1.split(/\s+/));
    const words2 = new Set(text2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Calculates final relevance score for a suggestion
   * @param {Object} suggestion - Suggestion object
   * @returns {number} - Relevance score between 0 and 1
   */
  _calculateRelevanceScore(suggestion) {
    let score = suggestion.relevanceScore || 0.5;
    
    // Boost based on priority
    const priorityBoosts = { 'high': 0.3, 'medium': 0.1, 'low': 0 };
    score += priorityBoosts[suggestion.priority] || 0;
    
    // Boost based on category effectiveness (from tracking)
    const categoryStats = this.categoryTracker.get(suggestion.type);
    if (categoryStats && categoryStats.effectiveness > 0.6) {
      score += 0.1;
    }
    
    // Boost based on context length (more context = more relevant)
    if (suggestion.context && suggestion.context.length > 100) {
      score += 0.05;
    }
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Builds context string from previous suggestions and conversation
   * @param {Array} previousSuggestions - Array of previous suggestions
   * @param {string} conversationContext - Additional conversation context
   * @returns {string} - Formatted context string
   */
  _buildContext(previousSuggestions, conversationContext) {
    let context = '';
    
    // Add conversation context
    if (conversationContext && conversationContext.length > 0) {
      context += `Conversation context:\n${conversationContext}\n\n`;
    }
    
    // Add recent suggestions for context
    if (previousSuggestions && previousSuggestions.length > 0) {
      const recentSuggestions = previousSuggestions
        .slice(-this.options.contextWindow)
        .filter(suggestion => suggestion && suggestion.content);

      if (recentSuggestions.length > 0) {
        context += `Recent suggestions:\n`;
        recentSuggestions.forEach(suggestion => {
          context += `- [${suggestion.type}] ${suggestion.content}\n`;
        });
        context += '\n';
      }
    }
    
    return context;
  }

  /**
   * Updates category tracking with effectiveness metrics
   * @param {Array} suggestions - Array of generated suggestions
   */
  _updateCategoryTracking(suggestions) {
    suggestions.forEach(suggestion => {
      const category = suggestion.type;
      
      if (this.categoryTracker.has(category)) {
        const existing = this.categoryTracker.get(category);
        this.categoryTracker.set(category, {
          count: existing.count + 1,
          totalScore: existing.totalScore + suggestion.relevanceScore,
          effectiveness: (existing.totalScore + suggestion.relevanceScore) / (existing.count + 1),
          lastGenerated: new Date()
        });
      } else {
        this.categoryTracker.set(category, {
          count: 1,
          totalScore: suggestion.relevanceScore,
          effectiveness: suggestion.relevanceScore,
          lastGenerated: new Date()
        });
      }
    });
  }

  /**
   * Updates context tracking for pattern learning
   * @param {string} transcript - Original transcript
   * @param {Array} suggestions - Generated suggestions
   */
  _updateContextTracking(transcript, suggestions) {
    // Extract key phrases from successful suggestions
    suggestions.forEach(suggestion => {
      if (suggestion.relevanceScore > 0.7) {
        const contextKey = `${suggestion.type}_${transcript.substring(0, 50)}`;
        
        if (this.contextTracker.has(contextKey)) {
          const existing = this.contextTracker.get(contextKey);
          this.contextTracker.set(contextKey, {
            frequency: existing.frequency + 1,
            avgScore: (existing.avgScore + suggestion.relevanceScore) / 2,
            lastSeen: new Date()
          });
        } else {
          this.contextTracker.set(contextKey, {
            frequency: 1,
            avgScore: suggestion.relevanceScore,
            lastSeen: new Date()
          });
        }
      }
    });
  }

  /**
   * Parses LLM response and updates suggestion content
   * @param {Array} suggestions - Array of suggestion objects to update
   * @param {string} llmResponse - Response from LLM
   * @param {string} category - The category these suggestions belong to
   * @returns {Array} - Updated suggestions array
   */
  parseLLMResponse(suggestions, llmResponse, category) {
    if (!suggestions || !llmResponse) {
      throw new Error('Suggestions array and LLM response are required');
    }

    try {
      // Try to parse as JSON first
      const parsedResponse = JSON.parse(llmResponse);
      
      if (Array.isArray(parsedResponse)) {
        // Update existing suggestions or create new ones
        parsedResponse.forEach((item, index) => {
          if (index < suggestions.length) {
            suggestions[index].content = item.content || item;
            if (item.priority) {
              suggestions[index].priority = item.priority;
            }
            if (item.reasoning) {
              suggestions[index].reasoning = item.reasoning;
            }
          } else if (index < this.options.maxSuggestionsPerCategory) {
            // Create new suggestion if we have fewer than expected
            suggestions.push({
              id: this._generateId(),
              type: category,
              content: item.content || item,
              priority: item.priority || 'medium',
              context: '',
              timestamp: new Date(),
              dismissed: false,
              relevanceScore: 0.6,
              reasoning: item.reasoning
            });
          }
        });
      }
    } catch (error) {
      // Fallback to text parsing if JSON parsing fails
      const lines = llmResponse.split('\n').filter(line => line.trim().length > 0);
      
      lines.forEach((line, index) => {
        if (index < suggestions.length) {
          // Clean up the line (remove bullets, numbers, etc.)
          const cleanedContent = line.replace(/^[-*•\d.)\s]+/, '').trim();
          if (cleanedContent.length > 0) {
            suggestions[index].content = cleanedContent;
          }
        }
      });
    }

    // Filter out suggestions without content
    return suggestions.filter(suggestion => suggestion.content && suggestion.content.trim().length > 0);
  }

  /**
   * Generates a unique ID for suggestions
   * @private
   * @returns {string} - Unique suggestion ID
   */
  _generateId() {
    return `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets suggestion statistics
   * @returns {Object} - Statistics about generated suggestions
   */
  getStats() {
    const categoryStats = {};
    this.categoryTracker.forEach((stats, category) => {
      categoryStats[category] = {
        count: stats.count,
        effectiveness: stats.effectiveness,
        lastGenerated: stats.lastGenerated
      };
    });

    return {
      totalSuggestions: this.suggestionHistory.length,
      categoryBreakdown: categoryStats,
      averageRelevanceScore: this.suggestionHistory.length > 0 
        ? this.suggestionHistory.reduce((sum, s) => sum + s.relevanceScore, 0) / this.suggestionHistory.length 
        : 0,
      enabledCategories: this.options.enabledCategories,
      contextPatterns: this.contextTracker.size
    };
  }

  /**
   * Clears suggestion history and tracking data
   */
  reset() {
    this.suggestionHistory = [];
    this.categoryTracker.clear();
    this.contextTracker.clear();
  }

  /**
   * Updates configuration options
   * @param {Object} newOptions - New configuration options
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
  }

  /**
   * Exports suggestion data for persistence
   * @returns {Object} - Serializable suggestion data
   */
  export() {
    return {
      suggestionHistory: this.suggestionHistory.map(suggestion => ({
        ...suggestion,
        timestamp: suggestion.timestamp.toISOString()
      })),
      categoryTracker: Array.from(this.categoryTracker.entries()).map(([category, data]) => [
        category,
        {
          ...data,
          lastGenerated: data.lastGenerated.toISOString()
        }
      ]),
      contextTracker: Array.from(this.contextTracker.entries()).map(([key, data]) => [
        key,
        {
          ...data,
          lastSeen: data.lastSeen.toISOString()
        }
      ]),
      options: this.options
    };
  }

  /**
   * Imports suggestion data from persistence
   * @param {Object} data - Previously exported suggestion data
   */
  import(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }

    // Import suggestion history
    if (data.suggestionHistory) {
      this.suggestionHistory = data.suggestionHistory.map(suggestion => ({
        ...suggestion,
        timestamp: new Date(suggestion.timestamp)
      }));
    }

    // Import category tracker
    if (data.categoryTracker) {
      this.categoryTracker = new Map(
        data.categoryTracker.map(([category, data]) => [
          category,
          {
            ...data,
            lastGenerated: new Date(data.lastGenerated)
          }
        ])
      );
    }

    // Import context tracker
    if (data.contextTracker) {
      this.contextTracker = new Map(
        data.contextTracker.map(([key, data]) => [
          key,
          {
            ...data,
            lastSeen: new Date(data.lastSeen)
          }
        ])
      );
    }

    // Import options
    if (data.options) {
      this.options = { ...this.options, ...data.options };
    }
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SuggestionGenerator;
} else if (typeof window !== 'undefined') {
  window.SuggestionGenerator = SuggestionGenerator;
}