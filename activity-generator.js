/**
 * ActivityGenerator - Generates clickable interactive activities from transcript content
 * 
 * This class analyzes transcript content to identify entities (people, concepts, technologies)
 * and generates clickable buttons that send tailored prompts to the LLM for immediate help.
 */
class ActivityGenerator {
  constructor(options = {}) {
    this.options = {
      maxActivitiesPerType: options.maxActivitiesPerType || 3,
      minTranscriptLength: options.minTranscriptLength || 30,
      contextWindow: options.contextWindow || 100, // Characters around detected entities
      enabledTypes: options.enabledTypes || ['define', 'explain', 'research', 'example'],
      confidenceThreshold: options.confidenceThreshold || 0.6,
      cooldownPeriod: options.cooldownPeriod || 5000, // 5 seconds between similar activities
      ...options
    };
    
    this.activityHistory = [];
    this.recentActivities = new Map(); // Track recent activities to avoid duplicates
    this.entityPatterns = this._initializeEntityPatterns();
    this.contextPatterns = this._initializeContextPatterns();
  }

  /**
   * Generates interactive activities for the given transcript segment
   * @param {string} transcript - The transcript text to analyze
   * @param {Object} timeRange - Object with start and end Date objects
   * @param {Array} previousActivities - Array of previous Activity objects for context
   * @returns {Array} - Array of Activity objects
   */
  async generateActivities(transcript, timeRange, previousActivities = []) {
    if (!transcript || typeof transcript !== 'string') {
      throw new Error('Transcript must be a non-empty string');
    }

    if (transcript.trim().length < this.options.minTranscriptLength) {
      return [];
    }

    if (!timeRange || typeof timeRange !== 'object' || !timeRange.start || !timeRange.end) {
      throw new Error('Valid timeRange with start and end dates is required');
    }

    const activities = [];
    
    // Generate activities for each enabled type
    for (const activityType of this.options.enabledTypes) {
      const typeActivities = await this._generateTypeActivities(
        transcript, 
        activityType, 
        timeRange,
        previousActivities
      );
      activities.push(...typeActivities);
    }

    // Filter out duplicates and low-confidence activities
    const filteredActivities = this._filterAndPrioritizeActivities(activities, previousActivities);
    
    // Update tracking
    this._updateActivityTracking(filteredActivities);
    
    // Add to history
    this.activityHistory.push(...filteredActivities);
    
    // Maintain history size
    if (this.activityHistory.length > 100) {
      this.activityHistory = this.activityHistory.slice(-100);
    }

    return filteredActivities;
  }

  /**
   * Generates activities for a specific type
   * @param {string} transcript - The transcript text
   * @param {string} activityType - The activity type to generate
   * @param {Object} timeRange - Time range for the transcript
   * @param {Array} previousActivities - Previous activities for context
   * @returns {Array} - Array of activities for the type
   */
  async _generateTypeActivities(transcript, activityType, timeRange, previousActivities) {
    const activities = [];
    const patterns = this.entityPatterns[activityType] || [];
    
    for (const pattern of patterns) {
      const matches = this._findEntityMatches(transcript, pattern);
      
      matches.forEach((match, index) => {
        if (index < this.options.maxActivitiesPerType) {
          const activity = this._createActivity(match, activityType, transcript, timeRange);
          if (activity && activity.confidence >= this.options.confidenceThreshold) {
            activities.push(activity);
          }
        }
      });
    }

    return activities;
  }

  /**
   * Creates an activity object from a pattern match
   * @param {Object} match - Pattern match object
   * @param {string} activityType - Type of activity
   * @param {string} transcript - Full transcript text
   * @param {Object} timeRange - Time range object
   * @returns {Object} - Activity object
   */
  _createActivity(match, activityType, transcript, timeRange) {
    const context = this._extractContext(transcript, match.index, match.length);
    const entity = match.entity || match.text;
    
    const activity = {
      id: this._generateId(),
      type: activityType,
      entity: entity,
      displayText: this._generateDisplayText(activityType, entity),
      prompt: this._generatePrompt(activityType, entity, context),
      context: context,
      confidence: match.confidence || 0.7,
      timestamp: new Date(),
      timeRange: timeRange,
      executed: false,
      result: null
    };

    return activity;
  }

  /**
   * Generates display text for an activity button
   * @param {string} activityType - Type of activity
   * @param {string} entity - The entity/concept to act on
   * @returns {string} - Display text for the button
   */
  _generateDisplayText(activityType, entity) {
    const templates = {
      define: `Define "${entity}"`,
      explain: `Explain ${entity}`,
      research: `Research ${entity}`,
      example: `Examples of ${entity}`,
      compare: `Compare ${entity}`,
      history: `History of ${entity}`,
      context: `Context for ${entity}`
    };

    return templates[activityType] || `Learn about ${entity}`;
  }

  /**
   * Generates a detailed prompt for the LLM when activity is triggered
   * @param {string} activityType - Type of activity
   * @param {string} entity - The entity/concept
   * @param {string} context - Surrounding context
   * @returns {string} - Detailed prompt for LLM
   */
  _generatePrompt(activityType, entity, context) {
    const baseContext = `In the context of this conversation: "${context}"`;
    
    const prompts = {
      define: `${baseContext}\n\nProvide a clear, concise definition of "${entity}". Include:\n- What it is\n- Key characteristics\n- Why it's relevant to the conversation\n- Any important context or nuances\n\nKeep the explanation accessible and focused on what's most relevant to the discussion.`,
      
      explain: `${baseContext}\n\nExplain "${entity}" in detail. Include:\n- How it works or functions\n- Key components or aspects\n- Why it's important or significant\n- How it relates to the current discussion\n- Any practical implications\n\nProvide a thorough but accessible explanation.`,
      
      research: `${baseContext}\n\nProvide research insights about "${entity}". Include:\n- Current state or recent developments\n- Key findings or data points\n- Notable experts or sources\n- Relevant trends or patterns\n- Implications for the topic being discussed\n\nFocus on factual, well-sourced information.`,
      
      example: `${baseContext}\n\nProvide concrete examples of "${entity}". Include:\n- 3-5 specific, relevant examples\n- Brief explanation of each example\n- How each example illustrates the concept\n- Why these examples are particularly relevant to the conversation\n\nMake examples practical and relatable.`,
      
      compare: `${baseContext}\n\nCompare "${entity}" with similar concepts or alternatives. Include:\n- Key similarities and differences\n- Advantages and disadvantages\n- When to use each option\n- How this comparison relates to the discussion\n\nProvide a balanced, informative comparison.`,
      
      history: `${baseContext}\n\nProvide historical context for "${entity}". Include:\n- Origins and development\n- Key milestones or changes\n- Important figures or events\n- How it has evolved over time\n- Relevance to current discussion\n\nFocus on historical context that illuminates the current topic.`,
      
      context: `${baseContext}\n\nProvide additional context about "${entity}" relevant to this conversation. Include:\n- Background information\n- Related concepts or connections\n- Why it matters in this context\n- Potential implications or considerations\n- How it fits into the broader discussion\n\nTailor the context to enhance understanding of the current topic.`
    };

    return prompts[activityType] || `${baseContext}\n\nProvide helpful information about "${entity}" that would be relevant to this conversation.`;
  }

  /**
   * Extracts context around a matched entity
   * @param {string} transcript - Full transcript
   * @param {number} index - Start index of match
   * @param {number} length - Length of match
   * @returns {string} - Context string
   */
  _extractContext(transcript, index, length) {
    const start = Math.max(0, index - this.options.contextWindow);
    const end = Math.min(transcript.length, index + length + this.options.contextWindow);
    return transcript.substring(start, end).trim();
  }

  /**
   * Initializes entity detection patterns for different activity types
   * @returns {Object} - Pattern definitions by activity type
   */
  _initializeEntityPatterns() {
    return {
      define: [
        {
          pattern: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g, // Proper nouns (people, places, concepts)
          confidence: 0.8,
          filter: (match) => this._isDefinableEntity(match)
        },
        {
          pattern: /\b(AI|ML|API|SDK|SaaS|IoT|VR|AR|UX|UI|CEO|CTO|IPO|MVP|ROI|KPI|machine learning|artificial intelligence)\b/gi, // Common acronyms and tech terms
          confidence: 0.9,
          filter: (match) => true
        },
        {
          pattern: /"([^"]+)"/g, // Quoted terms
          confidence: 0.7,
          filter: (match) => match.length > 2 && match.length < 50
        },
        {
          pattern: /\b(Peter Thiel|Elon Musk|Steve Jobs|Bill Gates|Mark Zuckerberg)\b/gi, // Famous people
          confidence: 0.9,
          filter: (match) => true
        }
      ],
      
      explain: [
        {
          pattern: /\b(algorithm|framework|methodology|approach|strategy|process|system|technology|concept|principle)\b/gi,
          confidence: 0.8,
          filter: (match) => true
        },
        {
          pattern: /\bhow\s+([^.!?]+?)(?:\s+works?|\s+functions?|\s+operates?)/gi,
          confidence: 0.9,
          captureGroup: 1,
          filter: (match) => match.length > 3
        }
      ],
      
      research: [
        {
          pattern: /\b(study|research|analysis|report|findings|data|statistics|trends|market|industry)\s+(?:on|about|regarding)\s+([^.!?]+)/gi,
          confidence: 0.8,
          captureGroup: 2,
          filter: (match) => match.length > 3
        },
        {
          pattern: /\b(company|organization|startup|business|platform|service)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g,
          confidence: 0.7,
          captureGroup: 2,
          filter: (match) => this._isResearchableEntity(match)
        }
      ],
      
      example: [
        {
          pattern: /\b(?:examples?|instances?|cases?|samples?)\s+of\s+([^.!?]+)/gi,
          confidence: 0.9,
          captureGroup: 1,
          filter: (match) => match.length > 2
        },
        {
          pattern: /\blike\s+([^.!?,]+)/gi,
          confidence: 0.6,
          captureGroup: 1,
          filter: (match) => match.length > 2 && match.length < 30
        }
      ]
    };
  }

  /**
   * Initializes context patterns that boost confidence for certain contexts
   * @returns {Array} - Context pattern definitions
   */
  _initializeContextPatterns() {
    return [
      {
        pattern: /\b(?:what|who)\s+is\s+([^.!?]+)/gi,
        boost: 0.3,
        activityTypes: ['define', 'explain']
      },
      {
        pattern: /\b(?:tell me about|explain|describe)\s+([^.!?]+)/gi,
        boost: 0.2,
        activityTypes: ['explain', 'research']
      },
      {
        pattern: /\b(?:never heard of|unfamiliar with|don't know)\s+([^.!?]+)/gi,
        boost: 0.4,
        activityTypes: ['define', 'explain']
      },
      {
        pattern: /\b(?:for example|such as|like)\s+([^.!?,]+)/gi,
        boost: 0.3,
        activityTypes: ['example']
      }
    ];
  }

  /**
   * Finds entity matches in transcript using patterns
   * @param {string} transcript - Text to search
   * @param {Object} patternObj - Pattern object with regex and options
   * @returns {Array} - Array of match objects
   */
  _findEntityMatches(transcript, patternObj) {
    const matches = [];
    const regex = new RegExp(patternObj.pattern.source, patternObj.pattern.flags);
    let match;

    while ((match = regex.exec(transcript)) !== null) {
      const captureGroup = patternObj.captureGroup || 0;
      const entity = match[captureGroup].trim();
      
      if (patternObj.filter && !patternObj.filter(entity)) {
        continue;
      }

      const matchObj = {
        index: match.index,
        length: match[0].length,
        text: match[0],
        entity: entity,
        confidence: patternObj.confidence || 0.7
      };

      // Apply context boosts
      matchObj.confidence = this._applyContextBoosts(matchObj, transcript);
      
      matches.push(matchObj);
    }

    // Remove duplicates and sort by confidence
    const uniqueMatches = this._removeDuplicateMatches(matches);
    return uniqueMatches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Applies context-based confidence boosts
   * @param {Object} match - Match object
   * @param {string} transcript - Full transcript
   * @returns {number} - Adjusted confidence score
   */
  _applyContextBoosts(match, transcript) {
    let confidence = match.confidence;
    const context = this._extractContext(transcript, match.index, match.length);

    for (const contextPattern of this.contextPatterns) {
      if (contextPattern.pattern.test(context)) {
        confidence = Math.min(1.0, confidence + contextPattern.boost);
      }
    }

    return confidence;
  }

  /**
   * Removes duplicate matches based on entity similarity
   * @param {Array} matches - Array of match objects
   * @returns {Array} - Deduplicated matches
   */
  _removeDuplicateMatches(matches) {
    const seen = new Set();
    return matches.filter(match => {
      const key = match.entity.toLowerCase().trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Filters activities and removes duplicates
   * @param {Array} activities - Generated activities
   * @param {Array} previousActivities - Previous activities for deduplication
   * @returns {Array} - Filtered activities
   */
  _filterAndPrioritizeActivities(activities, previousActivities) {
    const now = Date.now();
    
    // Filter out recent duplicates
    const filtered = activities.filter(activity => {
      const key = `${activity.type}_${activity.entity.toLowerCase()}`;
      const lastSeen = this.recentActivities.get(key);
      
      if (lastSeen && (now - lastSeen) < this.options.cooldownPeriod) {
        return false;
      }
      
      return !this._isDuplicateActivity(activity, previousActivities);
    });

    // Sort by confidence and limit results
    return filtered
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.options.maxActivitiesPerType * this.options.enabledTypes.length);
  }

  /**
   * Checks if an activity is a duplicate of previous activities
   * @param {Object} activity - Activity to check
   * @param {Array} previousActivities - Previous activities
   * @returns {boolean} - True if duplicate
   */
  _isDuplicateActivity(activity, previousActivities) {
    const recentActivities = previousActivities.slice(-20);
    
    return recentActivities.some(prev => {
      return prev.type === activity.type && 
             prev.entity.toLowerCase() === activity.entity.toLowerCase();
    });
  }

  /**
   * Updates activity tracking for cooldown management
   * @param {Array} activities - Generated activities
   */
  _updateActivityTracking(activities) {
    const now = Date.now();
    
    activities.forEach(activity => {
      const key = `${activity.type}_${activity.entity.toLowerCase()}`;
      this.recentActivities.set(key, now);
    });

    // Clean up old entries
    for (const [key, timestamp] of this.recentActivities.entries()) {
      if (now - timestamp > this.options.cooldownPeriod * 2) {
        this.recentActivities.delete(key);
      }
    }
  }

  /**
   * Checks if an entity is suitable for definition
   * @param {string} entity - Entity to check
   * @returns {boolean} - True if definable
   */
  _isDefinableEntity(entity) {
    // Filter out common words and very short/long entities
    if (entity.length < 3 || entity.length > 50) return false;
    
    const commonWords = new Set([
      'The', 'This', 'That', 'They', 'There', 'Then', 'When', 'Where', 
      'What', 'Who', 'Why', 'How', 'Can', 'Will', 'Would', 'Could', 
      'Should', 'May', 'Might', 'Must', 'Shall', 'Do', 'Does', 'Did',
      'Have', 'Has', 'Had', 'Is', 'Are', 'Was', 'Were', 'Be', 'Been',
      'Being', 'Get', 'Got', 'Give', 'Gave', 'Go', 'Went', 'Come', 'Came'
    ]);
    
    return !commonWords.has(entity);
  }

  /**
   * Checks if an entity is suitable for research
   * @param {string} entity - Entity to check
   * @returns {boolean} - True if researchable
   */
  _isResearchableEntity(entity) {
    // Companies, technologies, concepts are good for research
    return entity.length >= 2 && entity.length <= 40 && 
           !entity.match(/^(a|an|the|and|or|but|in|on|at|to|for|of|with|by)$/i);
  }

  /**
   * Executes an activity by sending the prompt to the LLM
   * @param {Object} activity - Activity to execute
   * @param {Function} llmCallback - Callback function to send prompt to LLM
   * @returns {Promise} - Promise that resolves when activity is complete
   */
  async executeActivity(activity, llmCallback) {
    if (!activity || !llmCallback) {
      throw new Error('Activity and LLM callback are required');
    }

    if (activity.executed) {
      return activity.result;
    }

    try {
      activity.executed = true;
      activity.executedAt = new Date();
      
      const result = await llmCallback(activity.prompt, activity.id);
      activity.result = result;
      
      return result;
    } catch (error) {
      activity.error = error.message;
      throw error;
    }
  }

  /**
   * Generates a unique ID for activities
   * @returns {string} - Unique activity ID
   */
  _generateId() {
    return `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets activity statistics
   * @returns {Object} - Statistics about generated activities
   */
  getStats() {
    const typeBreakdown = {};
    this.activityHistory.forEach(activity => {
      typeBreakdown[activity.type] = (typeBreakdown[activity.type] || 0) + 1;
    });

    const executedCount = this.activityHistory.filter(a => a.executed).length;
    
    return {
      totalActivities: this.activityHistory.length,
      executedActivities: executedCount,
      executionRate: this.activityHistory.length > 0 ? executedCount / this.activityHistory.length : 0,
      typeBreakdown,
      enabledTypes: this.options.enabledTypes,
      averageConfidence: this.activityHistory.length > 0 
        ? this.activityHistory.reduce((sum, a) => sum + a.confidence, 0) / this.activityHistory.length 
        : 0
    };
  }

  /**
   * Clears activity history and tracking data
   */
  reset() {
    this.activityHistory = [];
    this.recentActivities.clear();
  }

  /**
   * Updates configuration options
   * @param {Object} newOptions - New configuration options
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    
    // Reinitialize patterns if types changed
    if (newOptions.enabledTypes) {
      this.entityPatterns = this._initializeEntityPatterns();
      this.contextPatterns = this._initializeContextPatterns();
    }
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActivityGenerator;
} else if (typeof window !== 'undefined') {
  window.ActivityGenerator = ActivityGenerator;
}