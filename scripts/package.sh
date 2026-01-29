#!/bin/bash

# Chrome Extension Packaging Script
# Creates a ZIP file ready for Chrome Web Store submission

set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Get version from manifest.json
VERSION=$(awk -F'"' '/"version"/ {print $4; exit}' manifest.json)
PACKAGE_NAME="github-pr-html-preview-v${VERSION}.zip"
OUTPUT_DIR="$PROJECT_ROOT/dist"

echo "Packaging GitHub PR HTML Preview v${VERSION}..."

# Create dist directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Remove old package if exists
rm -f "$OUTPUT_DIR/$PACKAGE_NAME"

# Create ZIP with only necessary files
zip -r "$OUTPUT_DIR/$PACKAGE_NAME" \
  manifest.json \
  icons/ \
  src/ \
  -x "*.DS_Store" \
  -x "*/.git/*" \
  -x "*.map"

echo ""
echo "Package created: $OUTPUT_DIR/$PACKAGE_NAME"
echo ""

# Show package contents
echo "Package contents:"
unzip -l "$OUTPUT_DIR/$PACKAGE_NAME"

# Show file size
SIZE=$(ls -lh "$OUTPUT_DIR/$PACKAGE_NAME" | awk '{print $5}')
echo ""
echo "Package size: $SIZE"
