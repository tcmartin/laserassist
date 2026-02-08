#!/usr/bin/env python3
"""
Build script to compile asr_server.py into a standalone binary using PyInstaller.
This creates a self-contained executable that includes all Python dependencies.
"""

import os
import sys
import subprocess
import shutil
import platform
from pathlib import Path

def run_command(cmd, cwd=None):
    """Run a command and handle errors."""
    print(f"Running: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)
        if result.stdout:
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {e}")
        if e.stdout:
            print(f"STDOUT: {e.stdout}")
        if e.stderr:
            print(f"STDERR: {e.stderr}")
        return False

def install_dependencies():
    """Install required Python packages."""
    print("Installing Python dependencies...")
    
    # Install PyInstaller first
    if not run_command([sys.executable, "-m", "pip", "install", "pyinstaller>=5.0"]):
        return False
    
    # Install core dependencies first (more likely to succeed)
    core_deps = [
        "numpy>=1.21.0",
        "torch>=2.0.0",
        "torchaudio>=2.0.0", 
        "transformers>=4.30.0",
        "websockets>=11.0.0",
        "omegaconf>=2.3.0",
        "hydra-core>=1.3.0",
        "pytorch-lightning>=2.0.0"
    ]
    
    for dep in core_deps:
        print(f"Installing {dep}...")
        if not run_command([sys.executable, "-m", "pip", "install", dep]):
            print(f"Warning: Failed to install {dep}, continuing...")
    
    # Try to install NeMo (may fail, but we'll handle it gracefully)
    print("Attempting to install NeMo toolkit...")
    nemo_success = run_command([sys.executable, "-m", "pip", "install", "nemo-toolkit[asr]>=1.20.0"])
    if not nemo_success:
        print("Warning: NeMo installation failed. The binary will work with fallback transcription.")
    
    # Try PyAudio (optional)
    print("Attempting to install PyAudio...")
    pyaudio_success = run_command([sys.executable, "-m", "pip", "install", "pyaudio>=0.2.11"])
    if not pyaudio_success:
        print("Warning: PyAudio installation failed. Microphone input will not be available.")
    
    return True

def create_pyinstaller_spec():
    """Create a PyInstaller spec file for the ASR server."""
    
    spec_content = '''# -*- mode: python ; coding: utf-8 -*-

import os
import sys
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(SPEC)))

block_cipher = None

# Hidden imports for NeMo and related packages
hidden_imports = [
    'nemo',
    'nemo.collections',
    'nemo.collections.asr',
    'nemo.collections.asr.models',
    'nemo.core',
    'omegaconf',
    'hydra',
    'pytorch_lightning',
    'torch',
    'torchaudio',
    'transformers',
    'numpy',
    'websockets',
    'pyaudio',
    'wave',
    'asyncio',
    'concurrent.futures',
    'logging',
    'tempfile',
    'base64',
    'json',
    'argparse',
    'dataclasses',
    'collections',
    'typing',
    'time',
    'os',
    'sys'
]

# Data files to include
datas = []

# Try to find NeMo data files
try:
    import nemo
    nemo_path = Path(nemo.__file__).parent
    # Include NeMo configuration files
    nemo_configs = nemo_path / 'collections' / 'asr' / 'conf'
    if nemo_configs.exists():
        datas.append((str(nemo_configs), 'nemo/collections/asr/conf'))
except ImportError:
    pass

a = Analysis(
    ['asr_server.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='cluely-asr',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
'''
    
    with open('asr_server.spec', 'w') as f:
        f.write(spec_content)
    
    print("Created PyInstaller spec file: asr_server.spec")

def build_binary():
    """Build the ASR server binary using PyInstaller."""
    print("Building ASR server binary...")
    
    # Create the spec file
    create_pyinstaller_spec()
    
    # Build using PyInstaller
    cmd = [sys.executable, "-m", "PyInstaller", "--clean", "asr_server.spec"]
    
    if not run_command(cmd):
        return False
    
    # Check if binary was created
    system = platform.system().lower()
    if system == "windows":
        binary_name = "cluely-asr.exe"
    else:
        binary_name = "cluely-asr"
    
    binary_path = Path("dist") / binary_name
    
    if not binary_path.exists():
        print(f"Error: Binary not found at {binary_path}")
        return False
    
    print(f"✅ ASR binary created successfully: {binary_path}")
    
    # Make executable on Unix systems
    if system != "windows":
        os.chmod(binary_path, 0o755)
    
    return True

def test_binary():
    """Test the built binary."""
    print("Testing ASR binary...")
    
    system = platform.system().lower()
    binary_name = "cluely-asr.exe" if system == "windows" else "cluely-asr"
    binary_path = Path("dist") / binary_name
    
    # Test with --help flag
    cmd = [str(binary_path), "--help"]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            print("✅ Binary test passed")
            return True
        else:
            print(f"❌ Binary test failed with return code {result.returncode}")
            if result.stderr:
                print(f"STDERR: {result.stderr}")
            return False
    except subprocess.TimeoutExpired:
        print("❌ Binary test timed out")
        return False
    except Exception as e:
        print(f"❌ Binary test failed: {e}")
        return False

def setup_virtual_environment():
    """Create and activate a virtual environment."""
    venv_path = Path("build-venv")
    
    if venv_path.exists():
        print("Using existing virtual environment...")
    else:
        print("Creating virtual environment...")
        if not run_command([sys.executable, "-m", "venv", str(venv_path)]):
            return None
    
    # Determine activation script path
    if platform.system().lower() == "windows":
        activate_script = venv_path / "Scripts" / "activate.bat"
        python_exe = venv_path / "Scripts" / "python.exe"
    else:
        activate_script = venv_path / "bin" / "activate"
        python_exe = venv_path / "bin" / "python"
    
    if not python_exe.exists():
        print(f"❌ Python executable not found at {python_exe}")
        return None
    
    print(f"✅ Virtual environment ready at {venv_path}")
    return str(python_exe)

def main():
    """Main build process."""
    print("🚀 Building ASR Server Binary")
    print("=" * 50)
    
    # Check Python version
    if sys.version_info < (3, 8):
        print("❌ Python 3.8 or higher is required")
        return False
    
    print(f"✅ Python version: {sys.version}")
    
    # Setup virtual environment
    venv_python = setup_virtual_environment()
    if not venv_python:
        print("❌ Failed to setup virtual environment")
        return False
    
    # Update sys.executable to use venv python
    original_executable = sys.executable
    sys.executable = venv_python
    
    try:
        # Install dependencies
        if not install_dependencies():
            print("❌ Failed to install dependencies")
            return False
        
        print("✅ Dependencies installed")
        
        # Build binary
        if not build_binary():
            print("❌ Failed to build binary")
            return False
        
        # Test binary
        if not test_binary():
            print("❌ Binary test failed")
            return False
        
        print("\n🎉 ASR Server binary built successfully!")
        print(f"📁 Binary location: dist/cluely-asr{'.exe' if platform.system().lower() == 'windows' else ''}")
        print("\nNext steps:")
        print("1. Run 'npm run build' to package the Electron app")
        print("2. The ASR binary will be included in the app bundle")
        
        return True
    
    finally:
        # Restore original executable
        sys.executable = original_executable

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)