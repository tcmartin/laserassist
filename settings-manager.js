/**
 * SettingsManager - Manages configuration and persistence for AI insights
 * 
 * This class handles the storage, retrieval, and validation of user settings
 * for the real-time AI insights feature, providing a centralized configuration
 * system with localStorage persistence and real-time updates.
 */
class SettingsManager {
  constructor() {
    this.storageKey = 'ai-insights-settings';
    this.defaultSettings = {
      // Analysis timing
      analysisInterval: 60000, // 1 minute in milliseconds
      minTranscriptLength: 100, // minimum characters before analysis
      
      // Feature toggles
      enableSummaries: true,
      enableSuggestions: true,
      enableAutoAnalysis: true,
      
      // Suggestion types
      suggestionTypes: ['action-item', 'question', 'topic', 'resource'],
      
      // UI preferences
      autoExpandInsights: false,
      showAnalysisStatus: true,
      compactMode: false,
      
      // Performance settings
      maxConcurrentAnalysis: 1,
      retryAttempts: 3,
      retryDelay: 5000,
      
      // Data management
      maxSummaries: 50, // maximum summaries to keep in memory
      maxSuggestions: 100, // maximum suggestions to keep in memory
      sessionPersistence: true // persist data across app restarts
    };
    
    this.currentSettings = null;
    this.eventHandlers = new Map();
    this.validationRules = this._createValidationRules();
    
    // Load settings on initialization
    this.loadSettings();
  }

  /**
   * Gets the current settings
   * @returns {Object} - Current settings object
   */
  getSettings() {
    return { ...this.currentSettings };
  }

  /**
   * Gets a specific setting value
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} - Setting value
   */
  getSetting(key, defaultValue = undefined) {
    if (this.currentSettings.hasOwnProperty(key)) {
      return this.currentSettings[key];
    }
    return defaultValue !== undefined ? defaultValue : this.defaultSettings[key];
  }

  /**
   * Updates one or more settings
   * @param {Object} updates - Object containing setting updates
   * @param {boolean} persist - Whether to persist changes immediately (default: true)
   * @returns {Object} - Validation result with success status and any errors
   */
  updateSettings(updates, persist = true) {
    const validationResult = this.validateSettings(updates);
    
    if (!validationResult.isValid) {
      return {
        success: false,
        errors: validationResult.errors,
        warnings: validationResult.warnings
      };
    }

    const previousSettings = { ...this.currentSettings };
    
    // Apply updates
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        this.currentSettings[key] = updates[key];
      }
    });

    // Persist if requested
    if (persist) {
      try {
        this.saveSettings();
      } catch (error) {
        // Rollback on save failure
        this.currentSettings = previousSettings;
        return {
          success: false,
          errors: [`Failed to save settings: ${error.message}`]
        };
      }
    }

    // Emit change event
    this._emit('settingsChanged', {
      previousSettings,
      currentSettings: { ...this.currentSettings },
      updates
    });

    return {
      success: true,
      warnings: validationResult.warnings
    };
  }

  /**
   * Resets settings to defaults
   * @param {boolean} persist - Whether to persist the reset (default: true)
   */
  resetToDefaults(persist = true) {
    const previousSettings = { ...this.currentSettings };
    this.currentSettings = { ...this.defaultSettings };
    
    if (persist) {
      this.saveSettings();
    }

    this._emit('settingsReset', {
      previousSettings,
      currentSettings: { ...this.currentSettings }
    });
  }

  /**
   * Validates settings object
   * @param {Object} settings - Settings to validate
   * @returns {Object} - Validation result with isValid, errors, and warnings
   */
  validateSettings(settings) {
    const errors = [];
    const warnings = [];

    Object.keys(settings).forEach(key => {
      if (this.validationRules.has(key)) {
        const rule = this.validationRules.get(key);
        const result = rule.validate(settings[key]);
        
        if (!result.isValid) {
          errors.push(`${key}: ${result.error}`);
        }
        
        if (result.warning) {
          warnings.push(`${key}: ${result.warning}`);
        }
      } else {
        warnings.push(`Unknown setting: ${key}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Loads settings from localStorage
   */
  loadSettings() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsedSettings = JSON.parse(stored);
        
        // Merge with defaults to handle new settings
        this.currentSettings = {
          ...this.defaultSettings,
          ...parsedSettings
        };
        
        // Validate loaded settings
        const validationResult = this.validateSettings(this.currentSettings);
        if (!validationResult.isValid) {
          console.warn('Invalid settings detected, using defaults:', validationResult.errors);
          this.currentSettings = { ...this.defaultSettings };
        }
      } else {
        this.currentSettings = { ...this.defaultSettings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.currentSettings = { ...this.defaultSettings };
    }

    this._emit('settingsLoaded', { settings: { ...this.currentSettings } });
  }

  /**
   * Saves current settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.currentSettings));
      this._emit('settingsSaved', { settings: { ...this.currentSettings } });
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  /**
   * Exports settings for backup or transfer
   * @returns {Object} - Exportable settings object
   */
  exportSettings() {
    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      settings: { ...this.currentSettings }
    };
  }

  /**
   * Imports settings from backup or transfer
   * @param {Object} exportedData - Previously exported settings data
   * @param {boolean} persist - Whether to persist imported settings (default: true)
   * @returns {Object} - Import result with success status
   */
  importSettings(exportedData, persist = true) {
    try {
      if (!exportedData || !exportedData.settings) {
        throw new Error('Invalid export data format');
      }

      const validationResult = this.validateSettings(exportedData.settings);
      if (!validationResult.isValid) {
        return {
          success: false,
          errors: validationResult.errors
        };
      }

      const previousSettings = { ...this.currentSettings };
      this.currentSettings = {
        ...this.defaultSettings,
        ...exportedData.settings
      };

      if (persist) {
        this.saveSettings();
      }

      this._emit('settingsImported', {
        previousSettings,
        currentSettings: { ...this.currentSettings },
        importData: exportedData
      });

      return {
        success: true,
        warnings: validationResult.warnings
      };
    } catch (error) {
      return {
        success: false,
        errors: [error.message]
      };
    }
  }

  /**
   * Gets settings formatted for AnalysisEngine
   * @returns {Object} - Settings object compatible with AnalysisEngine
   */
  getAnalysisEngineSettings() {
    return {
      analysisInterval: this.currentSettings.analysisInterval,
      enableSummaries: this.currentSettings.enableSummaries,
      enableSuggestions: this.currentSettings.enableSuggestions,
      suggestionTypes: [...this.currentSettings.suggestionTypes],
      minTranscriptLength: this.currentSettings.minTranscriptLength,
      maxConcurrentAnalysis: this.currentSettings.maxConcurrentAnalysis,
      retryAttempts: this.currentSettings.retryAttempts,
      retryDelay: this.currentSettings.retryDelay
    };
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
   * Creates validation rules for settings
   * @private
   * @returns {Map} - Map of validation rules
   */
  _createValidationRules() {
    const rules = new Map();

    // Analysis interval validation
    rules.set('analysisInterval', {
      validate: (value) => {
        if (typeof value !== 'number' || value < 10000) {
          return { isValid: false, error: 'Must be a number >= 10000 (10 seconds)' };
        }
        if (value > 600000) {
          return { isValid: true, warning: 'Very long interval (>10 minutes) may reduce effectiveness' };
        }
        return { isValid: true };
      }
    });

    // Minimum transcript length validation
    rules.set('minTranscriptLength', {
      validate: (value) => {
        if (typeof value !== 'number' || value < 0) {
          return { isValid: false, error: 'Must be a non-negative number' };
        }
        if (value > 1000) {
          return { isValid: true, warning: 'High minimum length may delay analysis' };
        }
        return { isValid: true };
      }
    });

    // Boolean settings validation
    ['enableSummaries', 'enableSuggestions', 'enableAutoAnalysis', 'autoExpandInsights', 
     'showAnalysisStatus', 'compactMode', 'sessionPersistence'].forEach(key => {
      rules.set(key, {
        validate: (value) => {
          if (typeof value !== 'boolean') {
            return { isValid: false, error: 'Must be a boolean value' };
          }
          return { isValid: true };
        }
      });
    });

    // Suggestion types validation
    rules.set('suggestionTypes', {
      validate: (value) => {
        if (!Array.isArray(value)) {
          return { isValid: false, error: 'Must be an array' };
        }
        const validTypes = ['action-item', 'question', 'topic', 'resource'];
        const invalidTypes = value.filter(type => !validTypes.includes(type));
        if (invalidTypes.length > 0) {
          return { isValid: false, error: `Invalid types: ${invalidTypes.join(', ')}` };
        }
        if (value.length === 0) {
          return { isValid: true, warning: 'No suggestion types enabled' };
        }
        return { isValid: true };
      }
    });

    // Numeric settings with ranges
    const numericRules = {
      maxConcurrentAnalysis: { min: 1, max: 5 },
      retryAttempts: { min: 0, max: 10 },
      retryDelay: { min: 1000, max: 60000 },
      maxSummaries: { min: 1, max: 1000 },
      maxSuggestions: { min: 1, max: 1000 }
    };

    Object.keys(numericRules).forEach(key => {
      const { min, max } = numericRules[key];
      rules.set(key, {
        validate: (value) => {
          if (typeof value !== 'number' || value < min || value > max) {
            return { isValid: false, error: `Must be a number between ${min} and ${max}` };
          }
          return { isValid: true };
        }
      });
    });

    return rules;
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
          console.error(`Error in settings event handler for ${event}:`, error);
        }
      });
    }
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SettingsManager;
} else if (typeof window !== 'undefined') {
  window.SettingsManager = SettingsManager;
}