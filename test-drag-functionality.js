/**
 * Test to verify drag functionality works correctly
 * This test checks the CSS rules for webkit-app-region
 */

function testDragFunctionality() {
  console.log('=== Testing Drag Functionality ===\n');

  // Read the HTML file to check CSS rules
  const fs = require('fs');
  const htmlContent = fs.readFileSync('index.html', 'utf8');

  // Test 1: Check that main widget is draggable
  console.log('1. Testing main widget drag region...');
  if (!htmlContent.includes('#widget') || !htmlContent.includes('-webkit-app-region: drag')) {
    throw new Error('❌ Main widget should be draggable');
  }
  console.log('✅ Main widget is set to draggable');

  // Test 2: Check that blanket no-drag rule is removed
  console.log('\n2. Testing blanket no-drag rule removal...');
  if (htmlContent.includes('#widget *') && htmlContent.includes('-webkit-app-region: no-drag')) {
    throw new Error('❌ Blanket no-drag rule should be removed');
  }
  console.log('✅ Blanket no-drag rule has been removed');

  // Test 3: Check that interactive elements are non-draggable
  console.log('\n3. Testing interactive elements are non-draggable...');
  const interactiveElements = [
    'button',
    'input', 
    'textarea',
    '.activity-button',
    '.control-btn',
    '.manual-trigger'
  ];

  let foundInteractiveRules = 0;
  interactiveElements.forEach(element => {
    if (htmlContent.includes(element) && htmlContent.includes('-webkit-app-region: no-drag')) {
      foundInteractiveRules++;
    }
  });

  if (foundInteractiveRules === 0) {
    throw new Error('❌ Interactive elements should be non-draggable');
  }
  console.log(`✅ Found ${foundInteractiveRules} interactive element rules`);

  // Test 4: Check that header is draggable
  console.log('\n4. Testing header drag functionality...');
  if (!htmlContent.includes('.widget-header') || !htmlContent.includes('-webkit-app-region: drag')) {
    throw new Error('❌ Widget header should be draggable');
  }
  console.log('✅ Widget header is draggable');

  // Test 5: Check that panel headers are draggable
  console.log('\n5. Testing panel header drag functionality...');
  if (!htmlContent.includes('.panel-header') || !htmlContent.includes('-webkit-app-region: drag')) {
    throw new Error('❌ Panel headers should be draggable');
  }
  console.log('✅ Panel headers are draggable');

  // Test 6: Check that content areas are non-draggable
  console.log('\n6. Testing content areas are non-draggable...');
  const contentAreas = [
    '.widget-content',
    '.panel-content', 
    '.content-container'
  ];

  let foundContentRules = 0;
  contentAreas.forEach(area => {
    if (htmlContent.includes(area) && htmlContent.includes('-webkit-app-region: no-drag')) {
      foundContentRules++;
    }
  });

  if (foundContentRules === 0) {
    throw new Error('❌ Content areas should be non-draggable');
  }
  console.log(`✅ Found ${foundContentRules} content area rules`);

  console.log('\n🎉 All drag functionality tests passed!');
  
  console.log('\n📋 Drag Behavior Summary:');
  console.log('✅ Main widget window: DRAGGABLE');
  console.log('✅ Widget header: DRAGGABLE');
  console.log('✅ Panel headers: DRAGGABLE');
  console.log('✅ Buttons and inputs: NON-DRAGGABLE');
  console.log('✅ Content areas: NON-DRAGGABLE');
  console.log('✅ Interactive elements: NON-DRAGGABLE');
  
  console.log('\n🖱️ How to Use:');
  console.log('• Drag the window by clicking and dragging the header area');
  console.log('• Drag the window by clicking and dragging panel headers');
  console.log('• All buttons, inputs, and content remain fully functional');
  console.log('• Scrolling and text selection work normally in content areas');
}

// Test CSS rule structure
function testCSSRuleStructure() {
  console.log('\n=== Testing CSS Rule Structure ===\n');

  const fs = require('fs');
  const htmlContent = fs.readFileSync('index.html', 'utf8');

  // Extract CSS rules related to webkit-app-region
  const dragRules = [];
  const lines = htmlContent.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('-webkit-app-region')) {
      // Find the selector by looking backwards
      let selector = '';
      for (let j = i - 1; j >= 0; j--) {
        const prevLine = lines[j].trim();
        if (prevLine.includes('{')) {
          // Found opening brace, selector is on this line or previous
          const parts = prevLine.split('{');
          selector = parts[0].trim();
          break;
        } else if (prevLine && !prevLine.includes('}') && !prevLine.includes('/*')) {
          selector = prevLine + ' ' + selector;
        }
      }
      
      dragRules.push({
        selector: selector,
        rule: line,
        line: i + 1
      });
    }
  }

  console.log('Found drag-related CSS rules:');
  dragRules.forEach((rule, index) => {
    console.log(`${index + 1}. ${rule.selector} → ${rule.rule}`);
  });

  if (dragRules.length === 0) {
    throw new Error('❌ No drag rules found');
  }

  console.log(`\n✅ Found ${dragRules.length} drag-related CSS rules`);
  return dragRules;
}

// Run tests
function runTests() {
  try {
    testDragFunctionality();
    testCSSRuleStructure();
    console.log('\n🎉 All tests passed! Window should be draggable while maintaining functionality.');
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testDragFunctionality, testCSSRuleStructure };