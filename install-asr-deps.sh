#!/bin/bash

# Install ASR dependencies for development
echo "🔧 Installing ASR dependencies for development..."

# Check if virtual environment exists
if [ ! -d "asr-dev-env" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv asr-dev-env
fi

# Activate virtual environment
source asr-dev-env/bin/activate

# Install basic dependencies
echo "Installing basic ASR dependencies..."
pip install numpy>=1.21.0
pip install torch>=2.0.0
pip install torchaudio>=2.0.0
pip install transformers>=4.30.0
pip install websockets>=11.0.0

echo "✅ ASR dependencies installed!"
echo "To use ASR in development, run:"
echo "  source asr-dev-env/bin/activate"
echo "  npm start"