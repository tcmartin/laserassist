/**
 * Unit tests for SettingsManager
 * Tests the configuration and persistence functionality for AI insights settings
 */

// Mock localStorage for testing
const mockLocalStorage = {
  data: {},
  getItem: function(key) {
    return this.data[key] || null;
  },
  setItem: function(key, value) {
    this.data[key] = value;
  },
  removeItem: function(key) {
    delete this.data[key];
  },
  clear: function() {
    this.data = {};
  }
};

// Replace global localStorage with mock
global.localStorage = mockLocalStorage;

// Import SettingsManager
const SettingsManager = require('./settings-manager.js');

// Test suite
function runSettingsManagerTests() {
  console.log('Running SettingsManager tests...\n');
  
  let testCount = 0;
  let passCount = 0;
  
  function test(name, testFn) {
    testCount++;
    try {
      testFn();
      console.log(`✅ ${name}`);
      passCount++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
    }
  }
  
  function assertEquals(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ${message}`);
    }
  }
  
  function assertTrue(condition, message = '') {
    if (!condition) {
      throw new Error(`Expected true, got false. ${message}`);
    }
  }
  
  function assertFalse(condition, message = '') {
    if (condition) {
      throw new Error(`Expected false, got true. ${message}`);
    }
  }
  
  // Clear localStorage before each test
  beforeEach = () => {
    mockLocalStorage.clear();
  };
  
  // Test 1: Constructor and default settings
  test('Constructor initializes with default settings', () => {
    beforeEach();
    const manager = new SettingsManager();
    const settings = manager.getSettings();
    
    assertEquals(settings.analysisInterval, 60000);
    assertEquals(settings.enableSummaries, true);
    assertEquals(settings.enableSuggestions, true);
    assertEquals(settings.suggestionTypes, ['action-item', 'question', 'topic', 'resource']);
    assertEquals(settings.minTranscriptLength, 100);
  });
  
  // Test 2: Get specific setting
  test('getSetting returns correct values', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    assertEquals(manager.getSetting('analysisInterval'), 60000);
    assertEquals(manager.getSetting('nonexistent', 'default'), 'default');
    assertEquals(manager.getSetting('enableSummaries'), true);
  });
  
  // Test 3: Update settings
  test('updateSettings modifies settings correctly', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    const result = manager.updateSettings({
      analysisInterval: 30000,
      enableSummaries: false,
      suggestionTypes: ['action-item', 'question']
    });
    
    assertTrue(result.success);
    assertEquals(manager.getSetting('analysisInterval'), 30000);
    assertEquals(manager.getSetting('enableSummaries'), false);
    assertEquals(manager.getSetting('suggestionTypes'), ['action-item', 'question']);
  });
  
  // Test 4: Settings validation
  test('validateSettings catches invalid values', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    const result = manager.updateSettings({
      analysisInterval: 5000, // Too low
      enableSummaries: 'not a boolean',
      suggestionTypes: ['invalid-type']
    });
    
    assertFalse(result.success);
    assertTrue(result.errors.length > 0);
  });
  
  // Test 5: Settings persistence
  test('Settings are persisted to localStorage', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    manager.updateSettings({ analysisInterval: 45000 });
    
    // Check localStorage was updated
    const stored = JSON.parse(mockLocalStorage.getItem('ai-insights-settings'));
    assertEquals(stored.analysisInterval, 45000);
  });
  
  // Test 6: Settings loading
  test('Settings are loaded from localStorage', () => {
    beforeEach();
    
    // Pre-populate localStorage
    mockLocalStorage.setItem('ai-insights-settings', JSON.stringify({
      analysisInterval: 90000,
      enableSummaries: false
    }));
    
    const manager = new SettingsManager();
    assertEquals(manager.getSetting('analysisInterval'), 90000);
    assertEquals(manager.getSetting('enableSummaries'), false);
    // Should still have defaults for unspecified settings
    assertEquals(manager.getSetting('enableSuggestions'), true);
  });
  
  // Test 7: Reset to defaults
  test('resetToDefaults restores default values', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    // Change some settings
    manager.updateSettings({ analysisInterval: 30000, enableSummaries: false });
    
    // Reset
    manager.resetToDefaults();
    
    assertEquals(manager.getSetting('analysisInterval'), 60000);
    assertEquals(manager.getSetting('enableSummaries'), true);
  });
  
  // Test 8: Export settings
  test('exportSettings returns correct format', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    manager.updateSettings({ analysisInterval: 45000 });
    
    const exported = manager.exportSettings();
    
    assertTrue(exported.version);
    assertTrue(exported.timestamp);
    assertTrue(exported.settings);
    assertEquals(exported.settings.analysisInterval, 45000);
  });
  
  // Test 9: Import settings
  test('importSettings loads settings correctly', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    const importData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      settings: {
        analysisInterval: 75000,
        enableSummaries: false,
        suggestionTypes: ['action-item']
      }
    };
    
    const result = manager.importSettings(importData);
    
    assertTrue(result.success);
    assertEquals(manager.getSetting('analysisInterval'), 75000);
    assertEquals(manager.getSetting('enableSummaries'), false);
    assertEquals(manager.getSetting('suggestionTypes'), ['action-item']);
  });
  
  // Test 10: Import validation
  test('importSettings validates imported data', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    const invalidImportData = {
      version: '1.0',
      settings: {
        analysisInterval: 'invalid',
        enableSummaries: 'not boolean'
      }
    };
    
    const result = manager.importSettings(invalidImportData);
    
    assertFalse(result.success);
    assertTrue(result.errors.length > 0);
  });
  
  // Test 11: Analysis engine settings format
  test('getAnalysisEngineSettings returns correct format', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    manager.updateSettings({
      analysisInterval: 45000,
      enableSummaries: false,
      suggestionTypes: ['action-item', 'question']
    });
    
    const engineSettings = manager.getAnalysisEngineSettings();
    
    assertEquals(engineSettings.analysisInterval, 45000);
    assertEquals(engineSettings.enableSummaries, false);
    assertEquals(engineSettings.enableSuggestions, true); // Should still be default
    assertEquals(engineSettings.suggestionTypes, ['action-item', 'question']);
    assertTrue(engineSettings.hasOwnProperty('minTranscriptLength'));
    assertTrue(engineSettings.hasOwnProperty('maxConcurrentAnalysis'));
  });
  
  // Test 12: Event handling
  test('Event handlers are called on settings changes', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    let eventCalled = false;
    let eventData = null;
    
    manager.on('settingsChanged', (data) => {
      eventCalled = true;
      eventData = data;
    });
    
    manager.updateSettings({ analysisInterval: 30000 });
    
    assertTrue(eventCalled);
    assertTrue(eventData.previousSettings);
    assertTrue(eventData.currentSettings);
    assertTrue(eventData.updates);
    assertEquals(eventData.updates.analysisInterval, 30000);
  });
  
  // Test 13: Validation rules
  test('Validation rules work correctly', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    // Test analysis interval validation
    let result = manager.validateSettings({ analysisInterval: 5000 });
    assertFalse(result.isValid);
    
    result = manager.validateSettings({ analysisInterval: 30000 });
    assertTrue(result.isValid);
    
    // Test suggestion types validation
    result = manager.validateSettings({ suggestionTypes: ['invalid-type'] });
    assertFalse(result.isValid);
    
    result = manager.validateSettings({ suggestionTypes: ['action-item', 'question'] });
    assertTrue(result.isValid);
    
    // Test boolean validation
    result = manager.validateSettings({ enableSummaries: 'not boolean' });
    assertFalse(result.isValid);
    
    result = manager.validateSettings({ enableSummaries: false });
    assertTrue(result.isValid);
  });
  
  // Test 14: Settings persistence without immediate save
  test('updateSettings with persist=false does not save immediately', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    manager.updateSettings({ analysisInterval: 45000 }, false);
    
    // Should not be in localStorage yet
    const stored = mockLocalStorage.getItem('ai-insights-settings');
    assertTrue(stored === null || JSON.parse(stored).analysisInterval !== 45000);
    
    // But should be in memory
    assertEquals(manager.getSetting('analysisInterval'), 45000);
  });
  
  // Test 15: Manual save
  test('saveSettings persists current settings', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    manager.updateSettings({ analysisInterval: 45000 }, false);
    manager.saveSettings();
    
    const stored = JSON.parse(mockLocalStorage.getItem('ai-insights-settings'));
    assertEquals(stored.analysisInterval, 45000);
  });
  
  // Print results
  console.log(`\nTest Results: ${passCount}/${testCount} passed`);
  
  if (passCount === testCount) {
    console.log('🎉 All tests passed!');
    return true;
  } else {
    console.log('❌ Some tests failed');
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runSettingsManagerTests();
}

module.exports = { runSettingsManagerTests };