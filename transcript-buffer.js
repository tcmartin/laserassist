/**
 * TranscriptBuffer - Manages transcript segments with timestamps and analysis tracking
 * 
 * This class provides storage and retrieval of transcript segments for real-time AI analysis.
 * It maintains a rolling buffer of transcript content with timing information and tracks
 * which segments have been analyzed.
 */
class TranscriptBuffer {
  constructor() {
    this.segments = [];
    this.sessionStart = new Date();
    this.lastAnalysisTime = null;
  }

  /**
   * Adds a new transcript segment to the buffer
   * @param {string} text - The transcript text content
   * @param {Date} timestamp - When this segment was created
   * @param {number} confidence - Confidence score from Whisper (optional)
   * @returns {string} - The ID of the created segment
   */
  addTranscriptSegment(text, timestamp = new Date(), confidence = 1.0) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    const segment = {
      id: this._generateId(),
      text: text.trim(),
      timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
      duration: 0, // Will be calculated when next segment is added
      analyzed: false,
      confidence: Math.max(0, Math.min(1, confidence))
    };

    // Update duration of previous segment
    if (this.segments.length > 0) {
      const previousSegment = this.segments[this.segments.length - 1];
      previousSegment.duration = segment.timestamp.getTime() - previousSegment.timestamp.getTime();
    }

    this.segments.push(segment);
    return segment.id;
  }

  /**
   * Retrieves transcript segments since a given timestamp
   * @param {Date} timestamp - Get segments after this time
   * @param {boolean} unanalyzedOnly - Only return segments that haven't been analyzed
   * @returns {Array} - Array of transcript segments
   */
  getSegmentsSince(timestamp, unanalyzedOnly = false) {
    if (!timestamp) {
      timestamp = this.sessionStart;
    }

    const targetTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
    
    return this.segments.filter(segment => {
      const afterTimestamp = segment.timestamp >= targetTime;
      const analysisFilter = unanalyzedOnly ? !segment.analyzed : true;
      return afterTimestamp && analysisFilter;
    });
  }

  /**
   * Returns the complete session transcript as a single string
   * @param {Date} fromTime - Optional start time filter
   * @param {Date} toTime - Optional end time filter
   * @returns {string} - Combined transcript text
   */
  getFullContext(fromTime = null, toTime = null) {
    let filteredSegments = this.segments;

    if (fromTime) {
      const startTime = fromTime instanceof Date ? fromTime : new Date(fromTime);
      filteredSegments = filteredSegments.filter(segment => segment.timestamp >= startTime);
    }

    if (toTime) {
      const endTime = toTime instanceof Date ? toTime : new Date(toTime);
      filteredSegments = filteredSegments.filter(segment => segment.timestamp <= endTime);
    }

    return filteredSegments
      .map(segment => segment.text)
      .join(' ')
      .trim();
  }

  /**
   * Marks segments as analyzed
   * @param {Array|string} segmentIds - Single ID or array of segment IDs to mark as analyzed
   */
  markSegmentsAnalyzed(segmentIds) {
    const ids = Array.isArray(segmentIds) ? segmentIds : [segmentIds];
    
    this.segments.forEach(segment => {
      if (ids.includes(segment.id)) {
        segment.analyzed = true;
      }
    });

    this.lastAnalysisTime = new Date();
  }

  /**
   * Gets segments that haven't been analyzed yet
   * @param {number} minLength - Minimum total character length before returning segments
   * @returns {Array} - Array of unanalyzed segments
   */
  getUnanalyzedSegments(minLength = 100) {
    const unanalyzed = this.segments.filter(segment => !segment.analyzed);
    
    // Check if we have enough content for analysis
    const totalLength = unanalyzed.reduce((sum, segment) => sum + segment.text.length, 0);
    
    if (totalLength < minLength) {
      return [];
    }

    return unanalyzed;
  }

  /**
   * Gets the time range for a set of segments
   * @param {Array} segments - Array of segment objects
   * @returns {Object} - Object with start and end Date objects
   */
  getTimeRange(segments = null) {
    const targetSegments = segments || this.segments;
    
    if (targetSegments.length === 0) {
      return { start: this.sessionStart, end: this.sessionStart };
    }

    const timestamps = targetSegments.map(segment => segment.timestamp);
    return {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    };
  }

  /**
   * Gets the most recent segments
   * @param {number} count - Number of recent segments to return
   * @returns {Array} - Array of recent segment objects
   */
  getRecentSegments(count = 5) {
    if (count <= 0) {
      return [];
    }
    
    return this.segments.slice(-count);
  }

  /**
   * Returns the total number of segments
   * @returns {number}
   */
  getSegmentCount() {
    return this.segments.length;
  }

  /**
   * Clears the buffer and resets session data
   */
  clearBuffer() {
    this.segments = [];
    this.sessionStart = new Date();
    this.lastAnalysisTime = null;
  }

  /**
   * Gets buffer statistics
   * @returns {Object} - Statistics about the current buffer state
   */
  getStats() {
    const totalSegments = this.segments.length;
    const analyzedSegments = this.segments.filter(segment => segment.analyzed).length;
    const totalCharacters = this.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    const averageConfidence = totalSegments > 0 
      ? this.segments.reduce((sum, segment) => sum + segment.confidence, 0) / totalSegments 
      : 0;

    return {
      totalSegments,
      analyzedSegments,
      unanalyzedSegments: totalSegments - analyzedSegments,
      totalCharacters,
      averageConfidence,
      sessionDuration: new Date() - this.sessionStart,
      lastAnalysisTime: this.lastAnalysisTime
    };
  }

  /**
   * Removes old segments to prevent memory issues
   * @param {number} maxSegments - Maximum number of segments to keep
   * @param {number} maxAge - Maximum age in milliseconds
   */
  cleanup(maxSegments = 1000, maxAge = 3600000) { // 1 hour default
    const now = new Date();
    let removed = 0;

    // Remove segments older than maxAge
    this.segments = this.segments.filter(segment => {
      const age = now - segment.timestamp;
      if (age > maxAge) {
        removed++;
        return false;
      }
      return true;
    });

    // Remove oldest segments if we exceed maxSegments
    if (this.segments.length > maxSegments) {
      const toRemove = this.segments.length - maxSegments;
      this.segments.splice(0, toRemove);
      removed += toRemove;
    }

    return removed;
  }

  /**
   * Generates a unique ID for segments
   * @private
   * @returns {string} - Unique segment ID
   */
  _generateId() {
    return `segment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Exports buffer data for persistence
   * @returns {Object} - Serializable buffer data
   */
  export() {
    return {
      segments: this.segments,
      sessionStart: this.sessionStart.toISOString(),
      lastAnalysisTime: this.lastAnalysisTime ? this.lastAnalysisTime.toISOString() : null
    };
  }

  /**
   * Imports buffer data from persistence
   * @param {Object} data - Previously exported buffer data
   */
  import(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }

    this.segments = data.segments || [];
    this.sessionStart = new Date(data.sessionStart || Date.now());
    this.lastAnalysisTime = data.lastAnalysisTime ? new Date(data.lastAnalysisTime) : null;

    // Ensure all segments have proper Date objects
    this.segments.forEach(segment => {
      if (typeof segment.timestamp === 'string') {
        segment.timestamp = new Date(segment.timestamp);
      }
    });
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranscriptBuffer;
} else if (typeof window !== 'undefined') {
  window.TranscriptBuffer = TranscriptBuffer;
}
