#!/bin/bash
# Script to continuously check for new commits on a source branch and rewrite authorship on a target branch
# Usage: ./rewrite_authors.sh [--force]

SOURCE_BRANCH=dev
TARGET_BRANCH=deploy-dev
NEW_AUTHOR_NAME=CreatorShare
NEW_AUTHOR_EMAIL=creatorshare@thegeeky.ninja
TEMP_BRANCH="temp-rewrite-authors"

force_run=false

if [ "$1" == "--force" ]; then
  force_run=true
fi

fetch_latest() {
  git fetch --quiet origin
}

check_new_commits() {
  git rev-list --count origin/$TARGET_BRANCH..origin/$SOURCE_BRANCH
}

get_commit_counts() {
  source_count=$(git rev-list --count origin/$SOURCE_BRANCH)
  target_count=$(git rev-list --count origin/$TARGET_BRANCH)
}

delete_temp_branch() {
  if git show-ref --verify --quiet refs/heads/$TEMP_BRANCH; then
    git branch -D $TEMP_BRANCH || true
  fi
}

create_temp_branch() {
  git checkout -b $TEMP_BRANCH origin/$SOURCE_BRANCH
}

amend_latest_commit() {
  git checkout $TEMP_BRANCH
  GIT_COMMITTER_NAME="$NEW_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$NEW_AUTHOR_EMAIL" git commit --amend --author="$NEW_AUTHOR_NAME <$NEW_AUTHOR_EMAIL>" --no-edit
}

reset_target_branch() {
  git checkout $TARGET_BRANCH
  git reset --hard $TEMP_BRANCH
}

push_target_branch() {
  git push --quiet origin $TARGET_BRANCH --force
}

cleanup() {
  delete_temp_branch
  git reflog expire --expire=now --all > /dev/null 2>&1
  git gc --prune=now --aggressive > /dev/null 2>&1
}

process_update() {
  echo "New commits detected on $SOURCE_BRANCH. Rewriting authors and updating $TARGET_BRANCH..."

  git checkout $TARGET_BRANCH
  git reset --hard origin/$TARGET_BRANCH

  get_commit_counts

  if [ "$source_count" -le "$target_count" ] && [ "$force_run" = false ]; then
    # Target branch has equal or more commits. Skipping amend and push.
    return
  fi

  delete_temp_branch
  create_temp_branch
  amend_latest_commit
  reset_target_branch
  push_target_branch
  # yarn deploy-dev > /dev/null 2>&1 # Uncomment if manual deploy trigger needed
  cleanup
}

main_loop() {
  while true; do
    # Fetching latest changes...
    fetch_latest

    upstream_diff=$(check_new_commits)
    if [ "$upstream_diff" -eq 0 ] && [ "$force_run" = false ]; then
      # No new commits on $SOURCE_BRANCH since last sync.
      :
    else
      process_update
      if [ "$force_run" = true ]; then
        exit 0
      fi
    fi

    sleep 60
  done
}

if [ "$force_run" = true ]; then
  fetch_latest
  upstream_diff=$(check_new_commits)
  if [ "$upstream_diff" -eq 0 ]; then
    # No new commits on $SOURCE_BRANCH since last sync.
    :
  else
    process_update
  fi
else
  main_loop
fi