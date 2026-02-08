/**
 * Integration tests for Settings functionality
 * Tests the settings UI integration and real-time updates
 */

// Mock DOM environment for testing
const { JSDOM } = require('jsdom');

// Create a minimal DOM environment
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <!-- Settings form elements -->
  <input type="checkbox" id="enableAutoAnalysis" />
  <input type="range" id="analysisInterval" min="10" max="300" step="10" value="60" />
  <span id="intervalDisplay">60s</span>
  <input type="number" id="minTranscriptLength" min="0" max="1000" step="10" value="100" />
  
  <input type="checkbox" id="enableSummaries" />
  <input type="checkbox" id="enableSuggestions" />
  
  <input type="checkbox" id="suggestionType-action-item" value="action-item" />
  <input type="checkbox" id="suggestionType-question" value="question" />
  <input type="checkbox" id="suggestionType-topic" value="topic" />
  <input type="checkbox" id="suggestionType-resource" value="resource" />
  
  <input type="checkbox" id="showAnalysisStatus" />
  <input type="checkbox" id="autoExpandInsights" />
  <input type="checkbox" id="compactMode" />
  
  <input type="number" id="maxSummaries" min="1" max="1000" step="1" value="50" />
  <input type="number" id="maxSuggestions" min="1" max="1000" step="1" value="100" />
  <input type="checkbox" id="sessionPersistence" />
  
  <div id="settings-status" style="display: none;"></div>
  <input type="file" id="settingsFileInput" style="display: none;" />
</body>
</html>
`, { url: 'http://localhost' });

// Set up global DOM
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = {
  data: {},
  getItem: function(key) { return this.data[key] || null; },
  setItem: function(key, value) { this.data[key] = value; },
  removeItem: function(key) { delete this.data[key]; },
  clear: function() { this.data = {}; }
};

// Import SettingsManager
const SettingsManager = require('./settings-manager.js');

// Mock analysis engine for testing
class MockAnalysisEngine {
  constructor() {
    this.settings = {};
    this.updateCount = 0;
  }
  
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.updateCount++;
  }
  
  getSettings() {
    return { ...this.settings };
  }
}

// Test suite
function runSettingsIntegrationTests() {
  console.log('Running Settings Integration tests...\n');
  
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
  
  // Helper function to simulate form data
  function setFormValues(values) {
    Object.keys(values).forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = values[id];
        } else {
          element.value = values[id];
        }
      }
    });
  }
  
  // Helper function to get form values
  function getFormValues() {
    const suggestionTypes = [];
    ['action-item', 'question', 'topic', 'resource'].forEach(type => {
      const checkbox = document.getElementById(`suggestionType-${type}`);
      if (checkbox && checkbox.checked) {
        suggestionTypes.push(type);
      }
    });
    
    return {
      enableAutoAnalysis: document.getElementById('enableAutoAnalysis').checked,
      analysisInterval: parseInt(document.getElementById('analysisInterval').value) * 1000,
      minTranscriptLength: parseInt(document.getElementById('minTranscriptLength').value),
      enableSummaries: document.getElementById('enableSummaries').checked,
      enableSuggestions: document.getElementById('enableSuggestions').checked,
      suggestionTypes: suggestionTypes,
      showAnalysisStatus: document.getElementById('showAnalysisStatus').checked,
      autoExpandInsights: document.getElementById('autoExpandInsights').checked,
      compactMode: document.getElementById('compactMode').checked,
      maxSummaries: parseInt(document.getElementById('maxSummaries').value),
      maxSuggestions: parseInt(document.getElementById('maxSuggestions').value),
      sessionPersistence: document.getElementById('sessionPersistence').checked
    };
  }
  
  // Helper function to load settings into form (simulates the UI function)
  function loadSettingsIntoUI(settingsManager) {
    const settings = settingsManager.getSettings();
    
    document.getElementById('enableAutoAnalysis').checked = settings.enableAutoAnalysis;
    document.getElementById('analysisInterval').value = settings.analysisInterval / 1000;
    document.getElementById('intervalDisplay').textContent = `${settings.analysisInterval / 1000}s`;
    document.getElementById('minTranscriptLength').value = settings.minTranscriptLength;
    
    document.getElementById('enableSummaries').checked = settings.enableSummaries;
    document.getElementById('enableSuggestions').checked = settings.enableSuggestions;
    
    // Clear all suggestion type checkboxes first
    ['action-item', 'question', 'topic', 'resource'].forEach(type => {
      const checkbox = document.getElementById(`suggestionType-${type}`);
      if (checkbox) checkbox.checked = false;
    });
    
    // Set checked suggestion types
    settings.suggestionTypes.forEach(type => {
      const checkbox = document.getElementById(`suggestionType-${type}`);
      if (checkbox) checkbox.checked = true;
    });
    
    document.getElementById('showAnalysisStatus').checked = settings.showAnalysisStatus;
    document.getElementById('autoExpandInsights').checked = settings.autoExpandInsights;
    document.getElementById('compactMode').checked = settings.compactMode;
    
    document.getElementById('maxSummaries').value = settings.maxSummaries;
    document.getElementById('maxSuggestions').value = settings.maxSuggestions;
    document.getElementById('sessionPersistence').checked = settings.sessionPersistence;
  }
  
  // Clear localStorage before each test
  beforeEach = () => {
    global.localStorage.clear();
  };
  
  // Test 1: Settings load into UI correctly
  test('Settings load into UI form correctly', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    // Modify some settings
    manager.updateSettings({
      analysisInterval: 45000,
      enableSummaries: false,
      suggestionTypes: ['action-item', 'question']
    });
    
    // Load into UI
    loadSettingsIntoUI(manager);
    
    // Check form values
    assertEquals(document.getElementById('analysisInterval').value, '45');
    assertEquals(document.getElementById('intervalDisplay').textContent, '45s');
    assertFalse(document.getElementById('enableSummaries').checked);
    assertTrue(document.getElementById('suggestionType-action-item').checked);
    assertTrue(document.getElementById('suggestionType-question').checked);
    assertFalse(document.getElementById('suggestionType-topic').checked);
    assertFalse(document.getElementById('suggestionType-resource').checked);
  });
  
  // Test 2: Form values can be read correctly
  test('Form values are read correctly', () => {
    beforeEach();
    
    // Set form values
    setFormValues({
      enableAutoAnalysis: true,
      analysisInterval: 90, // seconds
      minTranscriptLength: 150,
      enableSummaries: false,
      enableSuggestions: true,
      'suggestionType-action-item': true,
      'suggestionType-question': true,
      'suggestionType-topic': false,
      'suggestionType-resource': false,
      showAnalysisStatus: true,
      autoExpandInsights: false,
      compactMode: true,
      maxSummaries: 75,
      maxSuggestions: 125,
      sessionPersistence: false
    });
    
    const formData = getFormValues();
    
    assertEquals(formData.enableAutoAnalysis, true);
    assertEquals(formData.analysisInterval, 90000); // Should be converted to milliseconds
    assertEquals(formData.minTranscriptLength, 150);
    assertEquals(formData.enableSummaries, false);
    assertEquals(formData.enableSuggestions, true);
    assertEquals(formData.suggestionTypes, ['action-item', 'question']);
    assertEquals(formData.showAnalysisStatus, true);
    assertEquals(formData.autoExpandInsights, false);
    assertEquals(formData.compactMode, true);
    assertEquals(formData.maxSummaries, 75);
    assertEquals(formData.maxSuggestions, 125);
    assertEquals(formData.sessionPersistence, false);
  });
  
  // Test 3: Settings round-trip (save and load)
  test('Settings round-trip correctly between manager and UI', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    // Set form values - need to set all form elements to avoid defaults
    setFormValues({
      enableAutoAnalysis: false,
      analysisInterval: 120,
      minTranscriptLength: 100,
      enableSummaries: true,
      enableSuggestions: false, // Set to false to test the specific value
      'suggestionType-action-item': true,
      'suggestionType-question': false,
      'suggestionType-topic': false,
      'suggestionType-resource': true,
      showAnalysisStatus: true,
      autoExpandInsights: false,
      compactMode: true,
      maxSummaries: 50,
      maxSuggestions: 100,
      sessionPersistence: true
    });
    
    // Get form data and update manager
    const formData = getFormValues();
    const result = manager.updateSettings(formData);
    
    assertTrue(result.success);
    
    // Load back into UI
    loadSettingsIntoUI(manager);
    
    // Verify values match exactly what we set
    assertFalse(document.getElementById('enableAutoAnalysis').checked);
    assertEquals(document.getElementById('analysisInterval').value, '120');
    assertTrue(document.getElementById('enableSummaries').checked);
    assertFalse(document.getElementById('enableSuggestions').checked); // Should match what we set
    assertTrue(document.getElementById('suggestionType-action-item').checked);
    assertFalse(document.getElementById('suggestionType-question').checked);
    assertFalse(document.getElementById('suggestionType-topic').checked);
    assertTrue(document.getElementById('suggestionType-resource').checked);
    assertTrue(document.getElementById('compactMode').checked);
  });
  
  // Test 4: Analysis engine integration
  test('Settings updates are propagated to analysis engine', () => {
    beforeEach();
    const manager = new SettingsManager();
    const mockEngine = new MockAnalysisEngine();
    
    // Simulate analysis engine integration
    manager.on('settingsChanged', (event) => {
      const engineSettings = manager.getAnalysisEngineSettings();
      mockEngine.updateSettings(engineSettings);
    });
    
    // Update settings
    manager.updateSettings({
      analysisInterval: 30000,
      enableSummaries: false,
      suggestionTypes: ['action-item']
    });
    
    // Check engine was updated
    assertEquals(mockEngine.updateCount, 1);
    assertEquals(mockEngine.getSettings().analysisInterval, 30000);
    assertEquals(mockEngine.getSettings().enableSummaries, false);
    assertEquals(mockEngine.getSettings().suggestionTypes, ['action-item']);
  });
  
  // Test 5: Form validation integration
  test('Form validation prevents invalid settings', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    // Set invalid form values
    setFormValues({
      analysisInterval: 5, // Too low (5 seconds)
      minTranscriptLength: -10, // Negative
      maxSummaries: 2000 // Too high
    });
    
    const formData = getFormValues();
    const result = manager.updateSettings(formData);
    
    assertFalse(result.success);
    assertTrue(result.errors.length > 0);
    
    // Original settings should be unchanged
    assertEquals(manager.getSetting('analysisInterval'), 60000); // Default
    assertEquals(manager.getSetting('minTranscriptLength'), 100); // Default
    assertEquals(manager.getSetting('maxSummaries'), 50); // Default
  });
  
  // Test 6: Settings persistence across manager instances
  test('Settings persist across manager instances', () => {
    beforeEach();
    
    // Create first manager and set settings
    const manager1 = new SettingsManager();
    manager1.updateSettings({
      analysisInterval: 75000,
      enableSummaries: false,
      suggestionTypes: ['question', 'topic']
    });
    
    // Create second manager (simulates app restart)
    const manager2 = new SettingsManager();
    
    // Should load persisted settings
    assertEquals(manager2.getSetting('analysisInterval'), 75000);
    assertEquals(manager2.getSetting('enableSummaries'), false);
    assertEquals(manager2.getSetting('suggestionTypes'), ['question', 'topic']);
  });
  
  // Test 7: Default settings handling
  test('Default settings are applied for missing values', () => {
    beforeEach();
    
    // Manually set partial settings in localStorage
    global.localStorage.setItem('ai-insights-settings', JSON.stringify({
      analysisInterval: 45000,
      enableSummaries: false
      // Missing other settings
    }));
    
    const manager = new SettingsManager();
    
    // Should have custom values for set settings
    assertEquals(manager.getSetting('analysisInterval'), 45000);
    assertEquals(manager.getSetting('enableSummaries'), false);
    
    // Should have defaults for missing settings
    assertEquals(manager.getSetting('enableSuggestions'), true);
    assertEquals(manager.getSetting('suggestionTypes'), ['action-item', 'question', 'topic', 'resource']);
    assertEquals(manager.getSetting('minTranscriptLength'), 100);
  });
  
  // Test 8: Event handling in UI context
  test('Settings change events work in UI context', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    let eventFired = false;
    let eventData = null;
    
    manager.on('settingsChanged', (data) => {
      eventFired = true;
      eventData = data;
    });
    
    // Simulate form submission - need to set all required checkbox values
    setFormValues({
      enableAutoAnalysis: true,
      analysisInterval: 90,
      minTranscriptLength: 100,
      enableSummaries: false,
      enableSuggestions: true,
      'suggestionType-action-item': true,
      'suggestionType-question': true,
      'suggestionType-topic': true,
      'suggestionType-resource': true,
      showAnalysisStatus: true,
      autoExpandInsights: false,
      compactMode: false,
      maxSummaries: 50,
      maxSuggestions: 100,
      sessionPersistence: true
    });
    
    const formData = getFormValues();
    manager.updateSettings(formData);
    
    assertTrue(eventFired);
    assertTrue(eventData !== null);
    assertEquals(eventData.currentSettings.analysisInterval, 90000);
    assertEquals(eventData.currentSettings.enableSummaries, false);
  });
  
  // Test 9: Export/Import functionality
  test('Export and import work with UI integration', () => {
    beforeEach();
    const manager = new SettingsManager();
    
    // Set custom settings
    setFormValues({
      analysisInterval: 120,
      enableSummaries: false,
      'suggestionType-action-item': true,
      'suggestionType-question': false,
      'suggestionType-topic': false,
      'suggestionType-resource': false,
      compactMode: true
    });
    
    const formData = getFormValues();
    manager.updateSettings(formData);
    
    // Export settings
    const exported = manager.exportSettings();
    
    // Reset to defaults
    manager.resetToDefaults();
    loadSettingsIntoUI(manager);
    
    // Verify reset
    assertEquals(document.getElementById('analysisInterval').value, '60');
    assertTrue(document.getElementById('enableSummaries').checked);
    
    // Import settings
    const importResult = manager.importSettings(exported);
    assertTrue(importResult.success);
    
    // Load into UI and verify
    loadSettingsIntoUI(manager);
    assertEquals(document.getElementById('analysisInterval').value, '120');
    assertFalse(document.getElementById('enableSummaries').checked);
    assertTrue(document.getElementById('suggestionType-action-item').checked);
    assertFalse(document.getElementById('suggestionType-question').checked);
    assertTrue(document.getElementById('compactMode').checked);
  });
  
  // Print results
  console.log(`\nTest Results: ${passCount}/${testCount} passed`);
  
  if (passCount === testCount) {
    console.log('🎉 All integration tests passed!');
    return true;
  } else {
    console.log('❌ Some integration tests failed');
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runSettingsIntegrationTests();
}

module.exports = { runSettingsIntegrationTests };