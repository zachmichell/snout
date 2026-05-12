#!/bin/sh
#
# ci_post_clone.sh
#
# Xcode Cloud runs this script after cloning the repository, before the build
# starts. Because apps/ios/Snout/Resources/Config.plist is gitignored (it
# contains the Supabase credentials), we generate it here from environment
# variables that the operator configures in App Store Connect:
#
#   App Store Connect → Apps → Snout → Xcode Cloud → Settings → Environment
#
# Required environment variables (mark as Secret in App Store Connect):
#   SUPABASE_URL       e.g. https://xxxx.supabase.co
#   SUPABASE_ANON_KEY  the public anon key for the Supabase project
#
# Reference: https://developer.apple.com/documentation/xcode/writing-custom-build-scripts
#
set -eu

echo "==> ci_post_clone: generating Config.plist"

# Xcode Cloud sets CI_PRIMARY_REPOSITORY_PATH to the repo checkout root.
# Fall back to a path relative to this script so the script also works when
# run manually from a developer machine.
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
CONFIG_PATH="${REPO_ROOT}/apps/ios/Snout/Resources/Config.plist"

if [ -z "${SUPABASE_URL:-}" ]; then
  echo "ERROR: SUPABASE_URL is not set." >&2
  echo "       Set it in App Store Connect → Xcode Cloud → Environment Variables." >&2
  exit 1
fi

if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: SUPABASE_ANON_KEY is not set." >&2
  echo "       Set it in App Store Connect → Xcode Cloud → Environment Variables." >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_PATH")"

cat > "$CONFIG_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>SUPABASE_URL</key>
    <string>${SUPABASE_URL}</string>
    <key>SUPABASE_ANON_KEY</key>
    <string>${SUPABASE_ANON_KEY}</string>
</dict>
</plist>
PLIST

# Validate the file we just wrote so a malformed env var fails the build here
# rather than deep inside the Swift build.
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$CONFIG_PATH" >/dev/null
fi

echo "==> ci_post_clone: wrote $CONFIG_PATH"
