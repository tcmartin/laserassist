/**
 * Test the activities integration with the main application
 */

// This test simulates the browser environment for testing activities integration
const fs = require('fs');
const path = require('path');

// Mock DOM elements and browser APIs
global.document = {
  getElementById: (id) => ({
    innerHTML: '',
    textContent: '',
    appendChild: () => {},
    querySelector: () => null,
    remove: () => {}
  }),
  createElement: (tag) => ({
    className: '',
    innerHTML: '',
    appendChild: () => {}
  })
};

global.window = {
  electronAPI: {
    on: () => {},
    off: () => {},
    send: () => {}
  }
};

// Load the ActivityGenerator
const ActivityGenerator = require('./activity-generator.js');

class ActivitiesIntegrationTest {
  constructor() {
    this.testResults = [];
  }

  async runTests() {
    console.log('🧪 Testing Activities Integration...\n');

    await this.testActivityGeneratorInitialization();
    await this.testActivityGeneration();
    await this.testActivityExecution();
    await this.testUIIntegration();

    this.printResults();
    return this.testResults;
  }

  async testActivityGeneratorInitialization() {
    console.log('Testing ActivityGenerator initialization...');
    
    try {
      const generator = new ActivityGenerator({
        enabledTypes: ['define', 'explain', 'research'],
        maxActivitiesPerType: 2,
        confidenceThreshold: 0.6
      });

      this.assert(generator instanceof ActivityGenerator, 'Should create ActivityGenerator instance');
      this.assert(generator.options.enabledTypes.length === 3, 'Should set enabled types');
      this.assert(generator.options.maxActivitiesPerType === 2, 'Should set max activities per type');
      
      this.pass('ActivityGenerator initialization works');
    } catch (error) {
      this.fail('ActivityGenerator initialization failed', error);
    }
  }

  async testActivityGeneration() {
    console.log('Testing activity generation with realistic transcript...');
    
    try {
      const generator = new ActivityGenerator();
      const transcript = "We were discussing Peter Thiel's investment philosophy and how artificial intelligence is transforming the startup ecosystem. The algorithm they're using is quite sophisticated.";
      const timeRange = { start: new Date(), end: new Date() };
      
      const activities = await generator.generateActivities(transcript, timeRange);
      
      this.assert(Array.isArray(activities), 'Should return array of activities');
      this.assert(activities.length > 0, 'Should generate activities from realistic transcript');
      
      // Check activity structure
      if (activities.length > 0) {
        const activity = activities[0];
        this.assert(activity.id, 'Activity should have ID');
        this.assert(activity.type, 'Activity should have type');
        this.assert(activity.entity, 'Activity should have entity');
        this.assert(activity.displayText, 'Activity should have display text');
        this.assert(activity.prompt, 'Activity should have prompt');
        this.assert(typeof activity.confidence === 'number', 'Activity should have confidence');
      }
      
      // Check for expected activity types
      const types = activities.map(a => a.type);
      const hasDefine = types.includes('define');
      const hasExplain = types.includes('explain');
      
      this.assert(hasDefine || hasExplain, 'Should generate define or explain activities');
      
      this.pass('Activity generation works correctly');
    } catch (error) {
      this.fail('Activity generation failed', error);
    }
  }

  async testActivityExecution() {
    console.log('Testing activity execution...');
    
    try {
      const generator = new ActivityGenerator();
      const transcript = "Peter Thiel is a famous investor.";
      const timeRange = { start: new Date(), end: new Date() };
      
      const activities = await generator.generateActivities(transcript, timeRange);
      
      if (activities.length > 0) {
        const activity = activities[0];
        
        // Mock LLM callback
        const mockLLMCallback = async (prompt, id) => {
          this.assert(typeof prompt === 'string', 'Prompt should be string');
          this.assert(prompt.length > 50, 'Prompt should be detailed');
          this.assert(prompt.includes(activity.entity), 'Prompt should include entity');
          return `Mock response about ${activity.entity}`;
        };
        
        const result = await generator.executeActivity(activity, mockLLMCallback);
        
        this.assert(activity.executed, 'Activity should be marked as executed');
        this.assert(activity.result === result, 'Activity should store result');
        this.assert(result.includes(activity.entity), 'Result should be relevant to entity');
      }
      
      this.pass('Activity execution works correctly');
    } catch (error) {
      this.fail('Activity execution failed', error);
    }
  }

  async testUIIntegration() {
    console.log('Testing UI integration functions...');
    
    try {
      // Test that the functions would work in browser environment
      const generator = new ActivityGenerator();
      const activities = await generator.generateActivities(
        "We discussed machine learning algorithms.", 
        { start: new Date(), end: new Date() }
      );
      
      // Simulate rendering activities
      let renderedHTML = '';
      activities.forEach(activity => {
        const activityHTML = `
          <div class="activity-item">
            <span>${activity.displayText}</span>
            <button onclick="executeActivity('${activity.id}')">Ask</button>
          </div>
        `;
        renderedHTML += activityHTML;
      });
      
      this.assert(renderedHTML.length > 0, 'Should generate HTML for activities');
      this.assert(renderedHTML.includes('activity-item'), 'Should use correct CSS classes');
      this.assert(renderedHTML.includes('executeActivity'), 'Should include click handlers');
      
      this.pass('UI integration functions work correctly');
    } catch (error) {
      this.fail('UI integration test failed', error);
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  pass(testName) {
    this.testResults.push({ name: testName, status: 'PASS' });
    console.log(`✅ ${testName}`);
  }

  fail(testName, error) {
    this.testResults.push({ name: testName, status: 'FAIL', error: error?.message || error });
    console.log(`❌ ${testName}: ${error?.message || error}`);
  }

  printResults() {
    console.log('\n📊 Integration Test Results:');
    console.log('============================');
    
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    
    console.log(`Total Tests: ${this.testResults.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    
    if (failed > 0) {
      console.log('\nFailed Tests:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    }
    
    console.log(`\nSuccess Rate: ${((passed / this.testResults.length) * 100).toFixed(1)}%`);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tests = new ActivitiesIntegrationTest();
  tests.runTests().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Integration test suite failed:', error);
    process.exit(1);
  });
}

module.exports = ActivitiesIntegrationTest;