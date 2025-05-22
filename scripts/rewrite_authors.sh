#!/bin/bash
# Script to continuously check for new commits on a source branch and rewrite authorship on a target branch

SOURCE_BRANCH=dev
TARGET_BRANCH=deploy-dev
NEW_AUTHOR_NAME=CreatorShare
NEW_AUTHOR_EMAIL=creatorshare@thegeeky.ninja
TEMP_BRANCH="temp-rewrite-authors"

while true; do
  echo "Fetching latest changes..."
  git fetch origin

  # Check if source branch has new commits compared to target branch
  UPSTREAM_DIFF=$(git rev-list --count origin/$TARGET_BRANCH..origin/$SOURCE_BRANCH)
  if [ "$UPSTREAM_DIFF" -eq 0 ]; then
    echo "No new commits on $SOURCE_BRANCH since last sync."
  else
    echo "New commits detected on $SOURCE_BRANCH. Rewriting authors and updating $TARGET_BRANCH..."

    # Checkout target branch and reset to remote
    git checkout $TARGET_BRANCH
    git reset --hard origin/$TARGET_BRANCH

    # Check if latest commit author matches desired author
    CURRENT_AUTHOR=$(git log -1 --format='%an <%ae>')
    DESIRED_AUTHOR="$NEW_AUTHOR_NAME <$NEW_AUTHOR_EMAIL>"
    if [ "$CURRENT_AUTHOR" = "$DESIRED_AUTHOR" ]; then
      echo "Latest commit author already matches desired author. Skipping amend and push."
    else
      # Delete temp branch locally if it exists
      if git show-ref --verify --quiet refs/heads/$TEMP_BRANCH; then
        git branch -D $TEMP_BRANCH
      fi

      # Create a temporary branch from source branch
      git checkout -b $TEMP_BRANCH origin/$SOURCE_BRANCH

      # Rewrite author and committer info on the latest commit in temp branch
      git checkout $TEMP_BRANCH
      git commit --amend --author="$NEW_AUTHOR_NAME <$NEW_AUTHOR_EMAIL>" --no-edit

      # Reset target branch to rewritten temp branch
      git checkout $TARGET_BRANCH
      git reset --hard $TEMP_BRANCH

      # Force push updated target branch
      git push origin $TARGET_BRANCH --force
    fi

    # Cleanup
    git branch -D $TEMP_BRANCH
    git reflog expire --expire=now --all
    git gc --prune=now --aggressive

    echo "Update complete."
  fi

  echo "Sleeping for 60 seconds..."
  sleep 60
done