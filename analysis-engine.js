/**
 * AnalysisEngine - Coordinates timing and execution of AI analysis tasks
 * 
 * This class manages the scheduling and execution of transcript analysis,
 * coordinating between the TranscriptBuffer, SummaryGenerator, and SuggestionGenerator
 * to provide real-time insights without disrupting core functionality.
 */
class AnalysisEngine {
  constructor(options = {}) {
    this.options = {
      analysisInterval: options.analysisInterval || 60000, // 1 minute default
      enableSummaries: options.enableSummaries !== false, // enabled by default
      enableSuggestions: options.enableSuggestions !== false, // enabled by default
      suggestionTypes: options.suggestionTypes || ['action-item', 'question', 'topic', 'resource'],
      minTranscriptLength: options.minTranscriptLength || 100, // minimum characters before analysis
      maxConcurrentAnalysis: options.maxConcurrentAnalysis || 1, // prevent overwhelming the LLM
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 5000, // 5 seconds
      ...options
    };

    // Core components
    this.transcriptBuffer = null;
    this.summaryGenerator = null;
    this.suggestionGenerator = null;
    this.llmWorker = null;

    // State management
    this.isRunning = false;
    this.isPaused = false;
    this.analysisTimer = null;
    this.currentAnalysis = null;
    this.analysisQueue = [];
    
    // Session data
    this.sessionId = this._generateSessionId();
    this.sessionStart = new Date();
    this.summaries = [];
    this.suggestions = [];
    this.activities = [];
    
    // Performance tracking
    this.stats = {
      totalAnalyses: 0,
      successfulAnalyses: 0,
      failedAnalyses: 0,
      averageAnalysisTime: 0,
      lastAnalysisTime: null,
      lastError: null
    };

    // Event handlers
    this.eventHandlers = new Map();
  }

  /**
   * Initializes the analysis engine with required components
   * @param {TranscriptBuffer} transcriptBuffer - The transcript buffer instance
   * @param {SummaryGenerator} summaryGenerator - The summary generator instance
   * @param {SuggestionGenerator} suggestionGenerator - The suggestion generator instance
   * @param {Object} llmWorker - The LLM worker for analysis requests
   */
  initialize(transcriptBuffer, summaryGenerator, suggestionGenerator, llmWorker) {
    if (!transcriptBuffer || !summaryGenerator || !suggestionGenerator || !llmWorker) {
      throw new Error('All components (transcriptBuffer, summaryGenerator, suggestionGenerator, llmWorker) are required');
    }

    this.transcriptBuffer = transcriptBuffer;
    this.summaryGenerator = summaryGenerator;
    this.suggestionGenerator = suggestionGenerator;
    this.llmWorker = llmWorker;

    this._emit('initialized', { sessionId: this.sessionId });
  }

  /**
   * Starts the analysis engine with interval-based scheduling
   */
  start() {
    if (!this._isInitialized()) {
      throw new Error('Analysis engine must be initialized before starting');
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.sessionStart = new Date();
    
    this._scheduleNextAnalysis();
    this._emit('started', { sessionId: this.sessionId, interval: this.options.analysisInterval });
  }

  /**
   * Stops the analysis engine and clears scheduled analysis
   */
  stop() {
    this.isRunning = false;
    this.isPaused = false;
    
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }

    // Cancel current analysis if running
    if (this.currentAnalysis) {
      this.currentAnalysis.cancelled = true;
    }

    // Clear analysis queue
    this.analysisQueue = [];

    this._emit('stopped', { sessionId: this.sessionId });
  }

  /**
   * Pauses the analysis engine (stops scheduling but allows current analysis to complete)
   */
  pause() {
    if (!this.isRunning) {
      return;
    }

    this.isPaused = true;
    
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }

    this._emit('paused', { sessionId: this.sessionId });
  }

  /**
   * Resumes the analysis engine from paused state
   */
  resume() {
    if (!this.isRunning || !this.isPaused) {
      return;
    }

    this.isPaused = false;
    this._scheduleNextAnalysis();
    this._emit('resumed', { sessionId: this.sessionId });
  }

  /**
   * Manually triggers an immediate analysis
   * @param {Object} options - Optional analysis options
   * @returns {Promise} - Promise that resolves when analysis is complete
   */
  async triggerAnalysis(options = {}) {
    if (!this._isInitialized()) {
      throw new Error('Analysis engine must be initialized before triggering analysis');
    }

    const analysisOptions = {
      manual: true,
      force: options.force || false, // Force analysis even if conditions aren't met
      types: options.types || (this.options.enableSummaries && this.options.enableSuggestions ? ['summary', 'suggestions'] : 
             this.options.enableSummaries ? ['summary'] : ['suggestions']),
      ...options
    };

    return this._performAnalysis(analysisOptions);
  }

  /**
   * Updates the analysis engine configuration
   * @param {Object} newOptions - New configuration options
   */
  updateSettings(newOptions) {
    const oldInterval = this.options.analysisInterval;
    this.options = { ...this.options, ...newOptions };

    // Update component settings if they support it
    if (this.summaryGenerator && typeof this.summaryGenerator.updateOptions === 'function') {
      this.summaryGenerator.updateOptions(newOptions);
    }
    
    if (this.suggestionGenerator && typeof this.suggestionGenerator.updateOptions === 'function') {
      this.suggestionGenerator.updateOptions(newOptions);
    }

    // Reschedule if interval changed and engine is running
    if (this.isRunning && !this.isPaused && oldInterval !== this.options.analysisInterval) {
      if (this.analysisTimer) {
        clearTimeout(this.analysisTimer);
      }
      this._scheduleNextAnalysis();
    }

    this._emit('settingsUpdated', { 
      sessionId: this.sessionId, 
      newOptions: this.options 
    });
  }

  /**
   * Gets the current analysis engine status
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      sessionId: this.sessionId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isAnalyzing: this.currentAnalysis !== null,
      queueLength: this.analysisQueue.length,
      sessionStart: this.sessionStart,
      summaryCount: this.summaries.length,
      suggestionCount: this.suggestions.length,
      activityCount: this.activities.length,
      stats: { ...this.stats },
      options: { ...this.options }
    };
  }

  /**
   * Gets the current session data
   * @returns {Object} - Session data with summaries and suggestions
   */
  getSessionData() {
    return {
      sessionId: this.sessionId,
      startTime: this.sessionStart,
      summaries: [...this.summaries],
      suggestions: [...this.suggestions],
      activities: [...this.activities],
      settings: { ...this.options },
      transcriptBuffer: this.transcriptBuffer ? this.transcriptBuffer.export() : null
    };
  }

  /**
   * Resets the current session and starts fresh
   */
  resetSession() {
    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }

    // Reset session data
    this.sessionId = this._generateSessionId();
    this.sessionStart = new Date();
    this.summaries = [];
    this.suggestions = [];
    this.activities = [];
    
    // Reset component state
    if (this.transcriptBuffer) {
      this.transcriptBuffer.clearBuffer();
    }
    if (this.summaryGenerator && typeof this.summaryGenerator.reset === 'function') {
      this.summaryGenerator.reset();
    }
    if (this.suggestionGenerator && typeof this.suggestionGenerator.reset === 'function') {
      this.suggestionGenerator.reset();
    }

    // Reset stats
    this.stats = {
      totalAnalyses: 0,
      successfulAnalyses: 0,
      failedAnalyses: 0,
      averageAnalysisTime: 0,
      lastAnalysisTime: null,
      lastError: null
    };

    this._emit('sessionReset', { sessionId: this.sessionId });

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Adds an event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Removes an event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function to remove
   */
  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Schedules the next analysis based on the configured interval
   * @private
   */
  _scheduleNextAnalysis() {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.analysisTimer = setTimeout(() => {
      this._performAnalysis({ scheduled: true })
        .catch(error => {
          console.error('Scheduled analysis failed:', error);
          this._emit('error', { error, type: 'scheduled-analysis' });
        })
        .finally(() => {
          // Schedule next analysis regardless of success/failure
          this._scheduleNextAnalysis();
        });
    }, this.options.analysisInterval);
  }

  /**
   * Performs the actual analysis
   * @private
   * @param {Object} options - Analysis options
   * @returns {Promise} - Promise that resolves when analysis is complete
   */
  async _performAnalysis(options = {}) {
    // Check if we're already at max concurrent analyses
    if (this.currentAnalysis && !options.force) {
      return new Promise((resolve, reject) => {
        this.analysisQueue.push({ resolve, reject, options });
      });
    }

    const analysisId = this._generateAnalysisId();
    const startTime = Date.now();
    
    this.currentAnalysis = {
      id: analysisId,
      startTime,
      options,
      cancelled: false
    };

    this._emit('analysisStarted', { 
      analysisId, 
      sessionId: this.sessionId, 
      options 
    });

    try {
      // Get unanalyzed segments
      const unanalyzedSegments = this.transcriptBuffer.getUnanalyzedSegments(
        options.force ? 0 : this.options.minTranscriptLength
      );

      if (unanalyzedSegments.length === 0 && !options.force) {
        this._emit('analysisSkipped', { 
          analysisId, 
          reason: 'insufficient-content',
          availableLength: this.transcriptBuffer.getFullContext().length
        });
        this.currentAnalysis = null;
        return null;
      }

      // Check if analysis was cancelled
      if (this.currentAnalysis.cancelled) {
        throw new Error('Analysis cancelled');
      }

      // Get transcript content and time range
      const transcript = unanalyzedSegments
        .map(segment => segment.text)
        .join(' ')
        .trim();
      
      const timeRange = this.transcriptBuffer.getTimeRange(unanalyzedSegments);
      
      const results = {};

      // Generate summary if enabled
      if (this.options.enableSummaries && 
          (options.types?.includes('summary') || !options.types)) {
        
        try {
          // Send to LLM for analysis
          const llmResponse = await this._sendToLLM({
            type: 'analyze-transcript',
            id: `${analysisId}_summary`,
            transcript: transcript,
            context: this.summaries.slice(-3).map(s => s.content).join('\n'),
            analysisType: ['summary'],
            timeRange: timeRange
          });
          
          // Create summary object from LLM response
          if (llmResponse && llmResponse.summary) {
            const summary = {
              id: `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              content: llmResponse.summary,
              timeRange: timeRange,
              keyTopics: [], // Could be extracted from content if needed
              timestamp: new Date(),
              transcriptSegments: unanalyzedSegments.map(s => s.id),
              confidence: 0.8, // Default confidence
              contextUsed: this.summaries.length > 0
            };
            
            this.summaries.push(summary);
            results.summary = summary;
          }
          
        } catch (error) {
          console.error('Summary generation failed:', error);
          results.summaryError = error.message;
          // Don't throw here, continue with suggestions
        }
      }

      // Generate suggestions if enabled
      if (this.options.enableSuggestions && 
          (options.types?.includes('suggestions') || !options.types)) {
        
        try {
          const conversationContext = this.summaries
            .slice(-3)
            .map(s => s.content)
            .join('\n');

          // Send to LLM for suggestions analysis
          const llmResponse = await this._sendToLLM({
            type: 'analyze-transcript',
            id: `${analysisId}_suggestions`,
            transcript: transcript,
            context: conversationContext,
            analysisType: ['suggestions'],
            timeRange: timeRange
          });
          
          // Create suggestion objects from LLM response
          const generatedSuggestions = [];
          const generatedActivities = [];
          
          console.log('LLM response for suggestions:', llmResponse);
          
          if (llmResponse && llmResponse.suggestions) {
            const suggestionData = llmResponse.suggestions;
            console.log('Processing suggestion data:', suggestionData);
            
            // Process action items
            if (suggestionData.actionItems && Array.isArray(suggestionData.actionItems)) {
              suggestionData.actionItems.forEach(item => {
                generatedSuggestions.push({
                  id: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: 'action-item',
                  content: item,
                  priority: 'medium',
                  timestamp: new Date(),
                  confidence: 0.8
                });
              });
            }
            
            // Process questions
            if (suggestionData.questions && Array.isArray(suggestionData.questions)) {
              suggestionData.questions.forEach(item => {
                generatedSuggestions.push({
                  id: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: 'question',
                  content: item,
                  priority: 'low',
                  timestamp: new Date(),
                  confidence: 0.8
                });
              });
            }
            
            // Process topics
            if (suggestionData.topics && Array.isArray(suggestionData.topics)) {
              suggestionData.topics.forEach(item => {
                generatedSuggestions.push({
                  id: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: 'topic',
                  content: item,
                  priority: 'low',
                  timestamp: new Date(),
                  confidence: 0.8
                });
              });
            }
            
            // Process interactive activities
            if (suggestionData.activities && Array.isArray(suggestionData.activities)) {
              console.log('Processing activities from LLM:', suggestionData.activities);
              suggestionData.activities.forEach(activity => {
                generatedActivities.push({
                  id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: activity.type || 'define',
                  entity: activity.entity || '',
                  displayText: activity.displayText || `${activity.type}: ${activity.entity}`,
                  confidence: activity.confidence || 0.8,
                  timestamp: new Date(),
                  executed: false,
                  timeRange: timeRange
                });
              });
            }
          }
          
          this.suggestions.push(...generatedSuggestions);
          this.activities.push(...generatedActivities);
          results.suggestions = generatedSuggestions;
          results.activities = generatedActivities;
          
          console.log('Generated activities for results:', generatedActivities);
          
        } catch (error) {
          console.error('Suggestion generation failed:', error);
          results.suggestionsError = error.message;
          // Don't throw here, analysis can still be considered successful
        }
      }

      // Mark segments as analyzed
      const segmentIds = unanalyzedSegments.map(segment => segment.id);
      this.transcriptBuffer.markSegmentsAnalyzed(segmentIds);

      // Update stats
      const analysisTime = Date.now() - startTime;
      this.stats.totalAnalyses++;
      this.stats.successfulAnalyses++;
      this.stats.averageAnalysisTime = 
        (this.stats.averageAnalysisTime * (this.stats.totalAnalyses - 1) + analysisTime) / 
        this.stats.totalAnalyses;
      this.stats.lastAnalysisTime = new Date();

      this._emit('analysisCompleted', {
        analysisId,
        sessionId: this.sessionId,
        results,
        analysisTime,
        segmentsAnalyzed: segmentIds.length,
        transcript,
        timeRange
      });

      return results;

    } catch (error) {
      this.stats.totalAnalyses++;
      this.stats.failedAnalyses++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date(),
        analysisId
      };

      this._emit('analysisError', {
        analysisId,
        sessionId: this.sessionId,
        error: error.message,
        options
      });

      throw error;

    } finally {
      this.currentAnalysis = null;
      
      // Process next item in queue
      if (this.analysisQueue.length > 0) {
        const next = this.analysisQueue.shift();
        this._performAnalysis(next.options)
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }

  /**
   * Sends a request to the LLM worker
   * @private
   * @param {Object} request - The analysis request
   * @returns {Promise<string>} - Promise that resolves with LLM response
   */
  async _sendToLLM(request) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('LLM request timeout'));
      }, 30000); // 30 second timeout

      const messageHandler = (event) => {
        if (event.data.id === request.id) {
          clearTimeout(timeout);
          this.llmWorker.removeEventListener('message', messageHandler);
          
          if (event.data.type === 'analysis-response') {
            resolve(event.data.results);
          } else if (event.data.type === 'analysis-error') {
            reject(new Error(event.data.error));
          }
        }
      };

      this.llmWorker.addEventListener('message', messageHandler);
      this.llmWorker.postMessage(request);
    });
  }

  /**
   * Checks if the engine is properly initialized
   * @private
   * @returns {boolean} - True if initialized
   */
  _isInitialized() {
    return this.transcriptBuffer && 
           this.summaryGenerator && 
           this.suggestionGenerator && 
           this.llmWorker;
  }

  /**
   * Emits an event to all registered handlers
   * @private
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  _emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Generates a unique session ID
   * @private
   * @returns {string} - Unique session ID
   */
  _generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique analysis ID
   * @private
   * @returns {string} - Unique analysis ID
   */
  _generateAnalysisId() {
    return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Exports engine data for persistence
   * @returns {Object} - Serializable engine data
   */
  export() {
    return {
      sessionId: this.sessionId,
      sessionStart: this.sessionStart.toISOString(),
      summaries: this.summaries.map(summary => ({
        ...summary,
        timeRange: {
          start: summary.timeRange.start.toISOString(),
          end: summary.timeRange.end.toISOString()
        },
        timestamp: summary.timestamp.toISOString()
      })),
      suggestions: this.suggestions.map(suggestion => ({
        ...suggestion,
        timestamp: suggestion.timestamp.toISOString()
      })),
      activities: this.activities.map(activity => ({
        ...activity,
        timestamp: activity.timestamp.toISOString(),
        timeRange: {
          start: activity.timeRange.start.toISOString(),
          end: activity.timeRange.end.toISOString()
        }
      })),
      options: this.options,
      stats: {
        ...this.stats,
        lastAnalysisTime: this.stats.lastAnalysisTime ? this.stats.lastAnalysisTime.toISOString() : null,
        lastError: this.stats.lastError ? {
          ...this.stats.lastError,
          timestamp: this.stats.lastError.timestamp.toISOString()
        } : null
      }
    };
  }

  /**
   * Imports engine data from persistence
   * @param {Object} data - Previously exported engine data
   */
  import(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }

    // Import session data
    if (data.sessionId) this.sessionId = data.sessionId;
    if (data.sessionStart) this.sessionStart = new Date(data.sessionStart);
    
    // Import summaries
    if (data.summaries) {
      this.summaries = data.summaries.map(summary => ({
        ...summary,
        timeRange: {
          start: new Date(summary.timeRange.start),
          end: new Date(summary.timeRange.end)
        },
        timestamp: new Date(summary.timestamp)
      }));
    }

    // Import suggestions
    if (data.suggestions) {
      this.suggestions = data.suggestions.map(suggestion => ({
        ...suggestion,
        timestamp: new Date(suggestion.timestamp)
      }));
    }

    // Import activities
    if (data.activities) {
      this.activities = data.activities.map(activity => ({
        ...activity,
        timestamp: new Date(activity.timestamp),
        timeRange: {
          start: new Date(activity.timeRange.start),
          end: new Date(activity.timeRange.end)
        }
      }));
    }

    // Import options
    if (data.options) {
      this.options = { ...this.options, ...data.options };
    }

    // Import stats
    if (data.stats) {
      this.stats = {
        ...data.stats,
        lastAnalysisTime: data.stats.lastAnalysisTime ? new Date(data.stats.lastAnalysisTime) : null,
        lastError: data.stats.lastError ? {
          ...data.stats.lastError,
          timestamp: new Date(data.stats.lastError.timestamp)
        } : null
      };
    }
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AnalysisEngine;
} else if (typeof window !== 'undefined') {
  window.AnalysisEngine = AnalysisEngine;
}