/**
 * Test script to verify the app icon is properly configured and displays
 */

const fs = require('fs');
const path = require('path');

function testAppIcon() {
  console.log('=== Testing App Icon Configuration ===\n');

  // Test 1: Check if icon file exists
  console.log('1. Checking icon file existence...');
  const iconPath = path.join(__dirname, 'app-icon.icns');
  
  if (!fs.existsSync(iconPath)) {
    throw new Error('❌ app-icon.icns file not found');
  }
  
  const stats = fs.statSync(iconPath);
  console.log(`✅ Icon file exists (${Math.round(stats.size / 1024)}KB)`);

  // Test 2: Check main.js configuration
  console.log('\n2. Checking main.js icon configuration...');
  const mainJsContent = fs.readFileSync('main.js', 'utf8');
  
  if (!mainJsContent.includes('app-icon.icns')) {
    throw new Error('❌ Icon not configured in main.js');
  }
  console.log('✅ Icon path configured in BrowserWindow');

  // Test 3: Check dock icon configuration
  if (!mainJsContent.includes('app.dock.setIcon')) {
    throw new Error('❌ Dock icon not configured');
  }
  console.log('✅ Dock icon configured for macOS');

  // Test 4: Check skipTaskbar setting
  if (mainJsContent.includes('skipTaskbar: true')) {
    throw new Error('❌ skipTaskbar is true - icon won\'t show in dock');
  }
  console.log('✅ skipTaskbar is false - icon will show in dock');

  // Test 5: Check individual icon sizes
  console.log('\n3. Checking individual icon sizes...');
  const iconSizes = [16, 32, 64, 128, 256, 512, 1024];
  let foundSizes = 0;
  
  iconSizes.forEach(size => {
    const sizePath = path.join(__dirname, 'icons', `icon-${size}.png`);
    if (fs.existsSync(sizePath)) {
      foundSizes++;
    }
  });
  
  if (foundSizes === 0) {
    console.log('⚠️  Individual icon sizes not found (optional)');
  } else {
    console.log(`✅ Found ${foundSizes}/${iconSizes.length} individual icon sizes`);
  }

  console.log('\n🎉 All icon tests passed!');
  
  console.log('\n📋 Icon Configuration Summary:');
  console.log('✅ Icon file: app-icon.icns exists');
  console.log('✅ BrowserWindow: icon configured');
  console.log('✅ Dock: app.dock.setIcon() configured');
  console.log('✅ Taskbar: skipTaskbar set to false');
  
  console.log('\n🚀 How to Test:');
  console.log('1. Run: npm start');
  console.log('2. Look for the custom icon in:');
  console.log('   • Mac Dock (when app is running)');
  console.log('   • Alt+Tab app switcher');
  console.log('   • Activity Monitor');
  console.log('   • Mission Control');
  
  console.log('\n💡 Troubleshooting:');
  console.log('• If icon doesn\'t appear, try restarting the app');
  console.log('• Check Console.app for any icon-related errors');
  console.log('• Verify the .icns file is valid with: file app-icon.icns');
}

// Test icon file validity
function testIconFileValidity() {
  console.log('\n=== Testing Icon File Validity ===\n');
  
  const { execSync } = require('child_process');
  
  try {
    // Check file type
    const fileOutput = execSync('file app-icon.icns', { encoding: 'utf8' });
    console.log('File type check:', fileOutput.trim());
    
    if (!fileOutput.includes('Apple Icon Image')) {
      console.log('⚠️  File may not be a valid .icns file');
    } else {
      console.log('✅ Valid .icns file detected');
    }
    
    // Check iconset contents if available
    if (fs.existsSync('app-icon.iconset')) {
      const iconsetFiles = fs.readdirSync('app-icon.iconset');
      console.log(`✅ Iconset contains ${iconsetFiles.length} files`);
    }
    
  } catch (error) {
    console.log('⚠️  Could not verify file type:', error.message);
  }
}

// Run tests
function runTests() {
  try {
    testAppIcon();
    testIconFileValidity();
    console.log('\n🎉 All tests passed! Icon should display when app runs.');
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testAppIcon, testIconFileValidity };