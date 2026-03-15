#!/bin/bash
# Patch @capacitor-community/apple-sign-in Package.swift to support Capacitor 8
# The plugin pins to capacitor-swift-pm from: "7.0.0" but the API is compatible with 8.x
PLUGIN_PKG="node_modules/@capacitor-community/apple-sign-in/Package.swift"
if [ -f "$PLUGIN_PKG" ]; then
  sed -i '' 's/from: "7.0.0"/from: "7.0.0"/' "$PLUGIN_PKG"
  # Replace the exact version pin with a range that includes 8.x
  sed -i '' 's/.package(url: "https:\/\/github.com\/ionic-team\/capacitor-swift-pm.git", from: "7.0.0")/.package(url: "https:\/\/github.com\/ionic-team\/capacitor-swift-pm.git", "7.0.0"..<"9.0.0")/' "$PLUGIN_PKG"
  echo "Patched apple-sign-in Package.swift for Capacitor 8 compatibility"
fi
