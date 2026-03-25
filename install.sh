#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Building Spectr..."
xcodebuild -project spectr.xcodeproj -scheme Spectr -configuration Release \
  SYMROOT=build -quiet build

echo "Installing to /Applications..."
rm -rf /Applications/Spectr.app
cp -R build/Release/Spectr.app /Applications/

echo "Done. Spectr is ready."
