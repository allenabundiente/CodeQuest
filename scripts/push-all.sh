#!/usr/bin/env bash
set -euo pipefail

# Push the current commit to the primary repo, then to the backup mirror.
# The backup remote uses SSH; make sure your key is loaded (ssh-add) or that
# ~/.ssh/backup_key is available to ssh.
PRIMARY_BRANCH="${PRIMARY_BRANCH:-main}"
BACKUP_REPO="${BACKUP_REPO:-git@github.com:Des-troy09/CodeQuest.git}"

if ! git remote get-url backup >/dev/null 2>&1; then
  git remote add backup "$BACKUP_REPO"
fi

echo "→ primary: origin $PRIMARY_BRANCH"
git push origin "HEAD:${PRIMARY_BRANCH}" --tags

echo "→ backup: backup $PRIMARY_BRANCH"
git push backup "HEAD:${PRIMARY_BRANCH}" --tags

echo "✓ primary and backup are in sync"
