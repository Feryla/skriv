#!/bin/bash
set -e

# Usage: ./scripts/release.sh [major|minor|patch]
# Default: patch

bump="${1:-patch}"
current=$(jq -r .version package.json)
IFS='.' read -r major minor patch <<< "$current"

case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) echo "Usage: $0 [major|minor|patch]"; exit 1 ;;
esac

new="$major.$minor.$patch"
echo "$current -> $new"

# Bump versions
sed -i '' "s/\"version\": \"$current\"/\"version\": \"$new\"/" package.json src-tauri/tauri.conf.json
sed -i '' "s/^version = \"$current\"/version = \"$new\"/" src-tauri/Cargo.toml

# Update Cargo.lock
(cd src-tauri && cargo check --quiet 2>/dev/null)

# Commit, tag, push
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Bump version to $new"
git tag "v$new"
git push origin main --tags

echo "Released v$new"
