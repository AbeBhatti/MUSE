#!/bin/bash

echo "🎵 Starting MIDI Editor..."
echo ""

# Check if Flask is installed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Installing Flask..."
    pip3 install flask flask-cors
fi

# Check if basic_pitch is installed
if ! python3 -c "import basic_pitch" 2>/dev/null; then
    echo "📦 Installing basic_pitch..."
    pip3 install basic-pitch
fi

echo ""
echo "🚀 Starting server..."
echo "📂 Access the editor at: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

python3 server.py
