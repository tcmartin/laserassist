/**
 * Test script to verify the application starts and analysis components load correctly
 */

const { spawn } = require('child_process');
const fs = require('fs');

async function testAppStartup() {
  console.log('Testing application startup...');
  
  // Check if all required files exist
  const requiredFiles = [
    'index.html',
    'main.js',
    'preload.js',
    'transcript-buffer.js',
    'analysis-engine.js',
    'summary-generator.js',
    'suggestion-generator.js',
    'settings-manager.js'
  ];
  
  console.log('\n1. Checking required files...');
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      console.log(`✓ ${file} exists`);
    } else {
      console.log(`✗ ${file} missing`);
      return false;
    }
  }
  
  // Check HTML file for required script tags
  console.log('\n2. Checking HTML script includes...');
  const htmlContent = fs.readFileSync('index.html', 'utf8');
  
  const requiredScripts = [
    'transcript-buffer.js',
    'settings-manager.js',
    'summary-generator.js',
    'suggestion-generator.js',
    'analysis-engine.js'
  ];
  
  for (const script of requiredScripts) {
    if (htmlContent.includes(script)) {
      console.log(`✓ ${script} included in HTML`);
    } else {
      console.log(`✗ ${script} not included in HTML`);
    }
  }
  
  // Check for key functions in HTML
  console.log('\n3. Checking key functions in HTML...');
  const keyFunctions = [
    'initializeAnalysisComponents',
    'initializeAnalysisEngineWithLLM',
    'updateAnalysisStatus',
    'triggerManualAnalysis',
    'checkAndTriggerAnalysis'
  ];
  
  for (const func of keyFunctions) {
    if (htmlContent.includes(`function ${func}`)) {
      console.log(`✓ ${func} function found`);
    } else {
      console.log(`✗ ${func} function missing`);
    }
  }
  
  // Test Electron startup
  console.log('\n4. Testing Electron startup...');
  
  return new Promise((resolve) => {
    const electron = spawn('npx', ['electron', '.', '--user-data-dir=./.temp-user-data'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let hasError = false;
    let output = '';
    let errorOutput = '';

    electron.stdout.on('data', (data) => {
      output += data.toString();
    });

    electron.stderr.on('data', (data) => {
      const errorStr = data.toString();
      errorOutput += errorStr;
      
      // Check for critical errors (ignore warnings)
      if (errorStr.includes('Error:') && !errorStr.includes('ExperimentalWarning')) {
        hasError = true;
      }
    });

    electron.on('error', (error) => {
      console.log(`✗ Failed to start Electron: ${error.message}`);
      hasError = true;
    });

    // Give the app time to start and initialize
    setTimeout(() => {
      electron.kill();
      
      if (hasError) {
        console.log('✗ Electron startup had errors');
        console.log('Error output:', errorOutput);
        resolve(false);
      } else {
        console.log('✓ Electron started successfully');
        if (errorOutput && !errorOutput.includes('ExperimentalWarning')) {
          console.log('Non-critical output:', errorOutput);
        }
        resolve(true);
      }
    }, 3000);
  });
}

// Run the test
if (require.main === module) {
  testAppStartup()
    .then(success => {
      console.log(`\n=== Test Result: ${success ? 'PASSED' : 'FAILED'} ===`);
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testAppStartup };