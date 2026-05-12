#!/bin/sh
# Xcode Cloud post-clone hook.
# Generates apps/ios/Snout/Resources/Config.plist from secret env vars
# (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) configured in the Xcode Cloud
# workflow. Config.plist is gitignored because it holds Supabase credentials;
# locally it's hand-maintained, in CI it's materialized here.

set -eu

: "${CI_PRIMARY_REPOSITORY_PATH:?CI_PRIMARY_REPOSITORY_PATH is not set — this script must run inside Xcode Cloud}"
: "${SUPABASE_URL:?SUPABASE_URL must be set in the Xcode Cloud workflow Environment Variables}"
: "${SUPABASE_PUBLISHABLE_KEY:?SUPABASE_PUBLISHABLE_KEY must be set in the Xcode Cloud workflow Environment Variables (mark as Secret)}"

CONFIG_DIR="$CI_PRIMARY_REPOSITORY_PATH/apps/ios/Snout/Resources"
CONFIG_FILE="$CONFIG_DIR/Config.plist"

mkdir -p "$CONFIG_DIR"

cat > "$CONFIG_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>SUPABASE_URL</key>
    <string>${SUPABASE_URL}</string>
    <key>SUPABASE_PUBLISHABLE_KEY</key>
    <string>${SUPABASE_PUBLISHABLE_KEY}</string>
</dict>
</plist>
EOF

echo "Generated Config.plist at $CONFIG_FILE"
