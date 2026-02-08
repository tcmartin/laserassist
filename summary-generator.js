/**
 * SummaryGenerator - Generates contextual summaries from transcript segments
 * 
 * This class provides structured prompt generation for transcript analysis and
 * manages context-aware summary generation using previous summaries and topic tracking.
 */
class SummaryGenerator {
  constructor(options = {}) {
    this.options = {
      maxSummaryLength: options.maxSummaryLength || 150,
      minTranscriptLength: options.minTranscriptLength || 50,
      contextWindow: options.contextWindow || 3, // Number of previous summaries to include
      topicChangeThreshold: options.topicChangeThreshold || 0.3,
      ...options
    };
    
    this.summaryHistory = [];
    this.topicTracker = new Map(); // Track topic frequency and recency
  }

  /**
   * Generates a summary for the given transcript segment
   * @param {string} transcript - The transcript text to summarize
   * @param {Object} timeRange - Object with start and end Date objects
   * @param {Array} previousSummaries - Array of previous Summary objects for context
   * @returns {Object} - Summary object with content, topics, and metadata
   */
  async generateSummary(transcript, timeRange, previousSummaries = []) {
    // Validate input
    if (!transcript || typeof transcript !== 'string') {
      throw new Error('Transcript must be a non-empty string');
    }

    if (transcript.trim().length < this.options.minTranscriptLength) {
      return {
        id: this._generateId(),
        content: 'Transcript too short for meaningful analysis',
        timeRange,
        keyTopics: [],
        timestamp: new Date(),
        transcriptSegments: [],
        confidence: 0,
        contextUsed: false
      };
    }

    if (!timeRange || !timeRange.start || !timeRange.end) {
      throw new Error('Valid timeRange with start and end dates is required');
    }

    // Build context from previous summaries
    const context = this._buildContext(previousSummaries);
    
    // Generate the summary prompt
    const prompt = this._generateSummaryPrompt(transcript, context, timeRange);
    
    // Extract key topics from transcript
    const keyTopics = this._extractTopics(transcript);
    
    // Update topic tracking
    this._updateTopicTracking(keyTopics, timeRange.end);
    
    // Create summary object (content will be filled by LLM response)
    const summary = {
      id: this._generateId(),
      content: '', // To be filled by LLM response
      timeRange: {
        start: new Date(timeRange.start),
        end: new Date(timeRange.end)
      },
      keyTopics,
      timestamp: new Date(),
      transcriptSegments: [], // To be filled by caller
      confidence: this._calculateConfidence(transcript, keyTopics),
      contextUsed: context.length > 0,
      prompt // Include prompt for testing/debugging
    };

    // Add to history for future context
    this.summaryHistory.push(summary);
    
    // Maintain history size
    if (this.summaryHistory.length > this.options.contextWindow * 2) {
      this.summaryHistory.shift();
    }

    return summary;
  }

  /**
   * Generates a structured prompt for summary generation
   * @param {string} transcript - The transcript to summarize
   * @param {string} context - Context from previous summaries
   * @param {Object} timeRange - Time range for the transcript
   * @returns {string} - Formatted prompt for LLM
   */
  _generateSummaryPrompt(transcript, context, timeRange) {
    const timeRangeStr = this._formatTimeRange(timeRange);
    
    let prompt = `Analyze the following conversation transcript and provide a concise summary of key points discussed:\n\n`;
    
    // Add context if available
    if (context && context.length > 0) {
      prompt += `Context from previous summaries:\n${context}\n\n`;
    }
    
    prompt += `Current transcript segment (${timeRangeStr}):\n${transcript}\n\n`;
    
    prompt += `Please provide:\n`;
    prompt += `1. Main topics discussed\n`;
    prompt += `2. Key decisions or conclusions\n`;
    prompt += `3. Important information shared\n`;
    prompt += `4. Any notable changes in conversation direction\n\n`;
    
    prompt += `Keep the summary under ${this.options.maxSummaryLength} words and focus on actionable insights.`;
    
    // Add topic continuity guidance if we have previous topics
    const recentTopics = this._getRecentTopics();
    if (recentTopics.length > 0) {
      prompt += `\n\nRecent conversation topics: ${recentTopics.join(', ')}`;
      prompt += `\nNote any topic changes or continuations.`;
    }

    return prompt;
  }

  /**
   * Builds context string from previous summaries
   * @param {Array} previousSummaries - Array of previous Summary objects
   * @returns {string} - Formatted context string
   */
  _buildContext(previousSummaries) {
    if (!previousSummaries || previousSummaries.length === 0) {
      return '';
    }

    // Use only the most recent summaries within context window
    const recentSummaries = previousSummaries
      .slice(-this.options.contextWindow)
      .filter(summary => summary && summary.content);

    if (recentSummaries.length === 0) {
      return '';
    }

    return recentSummaries
      .map(summary => {
        const timeStr = this._formatTimeRange(summary.timeRange);
        return `[${timeStr}] ${summary.content}`;
      })
      .join('\n');
  }

  /**
   * Extracts key topics from transcript text
   * @param {string} transcript - The transcript text
   * @returns {Array} - Array of identified topics
   */
  _extractTopics(transcript) {
    if (!transcript || transcript.length === 0) {
      return [];
    }

    // Simple topic extraction based on keywords and phrases
    const topics = [];
    const text = transcript.toLowerCase();
    
    // Common topic indicators
    const topicPatterns = [
      // Technology topics
      { pattern: /\b(api|database|server|cloud|security|authentication)\b/g, topic: 'technology' },
      { pattern: /\b(meeting|schedule|deadline|project|task)\b/g, topic: 'project-management' },
      { pattern: /\b(budget|cost|price|payment|invoice)\b/g, topic: 'finance' },
      { pattern: /\b(user|customer|client|feedback|experience)\b/g, topic: 'user-experience' },
      { pattern: /\b(design|interface|ui|ux|layout)\b/g, topic: 'design' },
      { pattern: /\b(test|testing|bug|issue|fix)\b/g, topic: 'quality-assurance' },
      { pattern: /\b(deploy|deployment|release|launch)\b/g, topic: 'deployment' },
      { pattern: /\b(team|collaboration|communication|discussion)\b/g, topic: 'team-coordination' }
    ];

    // Extract topics based on patterns
    topicPatterns.forEach(({ pattern, topic }) => {
      if (pattern.test(text)) {
        topics.push(topic);
      }
    });

    // Extract potential custom topics from capitalized words/phrases
    const customTopics = transcript.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g) || [];
    customTopics.forEach(topic => {
      if (topic.length > 2 && topic.length < 30) {
        topics.push(topic.toLowerCase().replace(/\s+/g, '-'));
      }
    });

    // Remove duplicates and limit to most relevant
    return [...new Set(topics)].slice(0, 5);
  }

  /**
   * Updates topic tracking with frequency and recency
   * @param {Array} topics - Array of topics from current transcript
   * @param {Date} timestamp - When these topics were discussed
   */
  _updateTopicTracking(topics, timestamp) {
    topics.forEach(topic => {
      if (this.topicTracker.has(topic)) {
        const existing = this.topicTracker.get(topic);
        this.topicTracker.set(topic, {
          frequency: existing.frequency + 1,
          lastMentioned: timestamp,
          firstMentioned: existing.firstMentioned
        });
      } else {
        this.topicTracker.set(topic, {
          frequency: 1,
          lastMentioned: timestamp,
          firstMentioned: timestamp
        });
      }
    });
  }

  /**
   * Gets recently discussed topics for context
   * @param {number} maxAge - Maximum age in milliseconds (default: 5 minutes)
   * @returns {Array} - Array of recent topic names
   */
  _getRecentTopics(maxAge = 300000) {
    const cutoff = new Date(Date.now() - maxAge);
    
    return Array.from(this.topicTracker.entries())
      .filter(([_, data]) => data.lastMentioned > cutoff)
      .sort((a, b) => b[1].frequency - a[1].frequency) // Sort by frequency
      .slice(0, 5)
      .map(([topic, _]) => topic);
  }

  /**
   * Calculates confidence score for the summary
   * @param {string} transcript - Original transcript
   * @param {Array} topics - Extracted topics
   * @returns {number} - Confidence score between 0 and 1
   */
  _calculateConfidence(transcript, topics) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on transcript length
    if (transcript.length > 200) confidence += 0.2;
    if (transcript.length > 500) confidence += 0.1;
    
    // Increase confidence based on topic extraction
    if (topics.length > 0) confidence += 0.1;
    if (topics.length > 2) confidence += 0.1;
    
    // Decrease confidence for very short transcripts
    if (transcript.length < 100) confidence -= 0.2;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Formats time range for display
   * @param {Object} timeRange - Object with start and end Date objects
   * @returns {string} - Formatted time range string
   */
  _formatTimeRange(timeRange) {
    if (!timeRange || !timeRange.start || !timeRange.end) {
      return 'Unknown time';
    }

    const start = new Date(timeRange.start);
    const end = new Date(timeRange.end);
    
    // Use UTC to ensure consistent formatting across timezones
    const startTime = start.toISOString().substr(11, 5); // Extract HH:MM from ISO string
    const endTime = end.toISOString().substr(11, 5);
    
    return `${startTime}-${endTime}`;
  }

  /**
   * Generates a unique ID for summaries
   * @private
   * @returns {string} - Unique summary ID
   */
  _generateId() {
    return `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Parses LLM response and updates summary content
   * @param {Object} summary - Summary object to update
   * @param {string} llmResponse - Response from LLM
   * @returns {Object} - Updated summary object
   */
  parseLLMResponse(summary, llmResponse) {
    if (!summary || !llmResponse) {
      throw new Error('Summary object and LLM response are required');
    }

    // Clean up the response
    const cleanedResponse = llmResponse.trim();
    
    // Update the summary content
    summary.content = cleanedResponse;
    
    // Try to extract additional structured information if present
    const structuredInfo = this._extractStructuredInfo(cleanedResponse);
    if (structuredInfo.topics.length > 0) {
      // Merge with existing topics, avoiding duplicates
      summary.keyTopics = [...new Set([...summary.keyTopics, ...structuredInfo.topics])];
    }

    // Update confidence based on response quality
    summary.confidence = this._assessResponseQuality(cleanedResponse, summary.confidence);
    
    return summary;
  }

  /**
   * Extracts structured information from LLM response
   * @param {string} response - LLM response text
   * @returns {Object} - Extracted structured information
   */
  _extractStructuredInfo(response) {
    const info = {
      topics: [],
      decisions: [],
      actionItems: []
    };

    // Extract topics mentioned in the response
    const topicMatches = response.match(/topics?[:\s]+([^.!?]+)/gi);
    if (topicMatches) {
      topicMatches.forEach(match => {
        const topics = match.replace(/topics?[:\s]+/i, '').split(/[,;]/);
        topics.forEach(topic => {
          const cleaned = topic.trim().toLowerCase();
          if (cleaned.length > 2 && cleaned.length < 50) {
            info.topics.push(cleaned);
          }
        });
      });
    }

    return info;
  }

  /**
   * Assesses the quality of LLM response and adjusts confidence
   * @param {string} response - LLM response
   * @param {number} baseConfidence - Original confidence score
   * @returns {number} - Adjusted confidence score
   */
  _assessResponseQuality(response, baseConfidence) {
    let confidence = baseConfidence;
    
    // Check response length
    if (response.length < 20) confidence -= 0.3;
    else if (response.length > 50) confidence += 0.1;
    
    // Check for structured content
    if (response.includes('topics') || response.includes('decisions')) confidence += 0.1;
    if (response.includes('key points') || response.includes('main')) confidence += 0.1;
    
    // Check for generic responses
    if (response.includes('not enough information') || 
        response.includes('unclear') || 
        response.includes('insufficient')) {
      confidence -= 0.2;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Gets summary statistics
   * @returns {Object} - Statistics about generated summaries
   */
  getStats() {
    return {
      totalSummaries: this.summaryHistory.length,
      averageConfidence: this.summaryHistory.length > 0 
        ? this.summaryHistory.reduce((sum, s) => sum + s.confidence, 0) / this.summaryHistory.length 
        : 0,
      totalTopics: this.topicTracker.size,
      recentTopics: this._getRecentTopics(),
      contextWindowSize: this.options.contextWindow,
      summariesWithContext: this.summaryHistory.filter(s => s.contextUsed).length
    };
  }

  /**
   * Clears summary history and topic tracking
   */
  reset() {
    this.summaryHistory = [];
    this.topicTracker.clear();
  }

  /**
   * Exports summary data for persistence
   * @returns {Object} - Serializable summary data
   */
  export() {
    return {
      summaryHistory: this.summaryHistory.map(summary => ({
        ...summary,
        timeRange: {
          start: summary.timeRange.start.toISOString(),
          end: summary.timeRange.end.toISOString()
        },
        timestamp: summary.timestamp.toISOString()
      })),
      topicTracker: Array.from(this.topicTracker.entries()).map(([topic, data]) => [
        topic,
        {
          ...data,
          lastMentioned: data.lastMentioned.toISOString(),
          firstMentioned: data.firstMentioned.toISOString()
        }
      ]),
      options: this.options
    };
  }

  /**
   * Imports summary data from persistence
   * @param {Object} data - Previously exported summary data
   */
  import(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }

    // Import summary history
    if (data.summaryHistory) {
      this.summaryHistory = data.summaryHistory.map(summary => ({
        ...summary,
        timeRange: {
          start: new Date(summary.timeRange.start),
          end: new Date(summary.timeRange.end)
        },
        timestamp: new Date(summary.timestamp)
      }));
    }

    // Import topic tracker
    if (data.topicTracker) {
      this.topicTracker = new Map(
        data.topicTracker.map(([topic, data]) => [
          topic,
          {
            ...data,
            lastMentioned: new Date(data.lastMentioned),
            firstMentioned: new Date(data.firstMentioned)
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
  module.exports = SummaryGenerator;
} else if (typeof window !== 'undefined') {
  window.SummaryGenerator = SummaryGenerator;
}