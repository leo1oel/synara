import type { I18n } from "@lingui/core";

/** Translate the finite set of labels and hints produced by Git view-model helpers. */
export function localizeGitText(i18n: I18n, text: string): string {
  switch (text) {
    case 'Add an "origin" remote before committing and pushing.':
      return i18n._('Add an "origin" remote before committing and pushing.');
    case 'Add an "origin" remote before creating a PR.':
      return i18n._('Add an "origin" remote before creating a PR.');
    case 'Add an "origin" remote before pushing.':
      return i18n._('Add an "origin" remote before pushing.');
    case 'Add an "origin" remote before pushing or creating a PR.':
      return i18n._('Add an "origin" remote before pushing or creating a PR.');
    case "A pull request is already open for this branch.":
      return i18n._("A pull request is already open for this branch.");
    case "Branch has diverged from upstream. Rebase/merge first.":
      return i18n._("Branch has diverged from upstream. Rebase/merge first.");
    case "Branch is already up to date.":
      return i18n._("Branch is already up to date.");
    case "Branch is behind upstream. Pull before creating a PR.":
      return i18n._("Branch is behind upstream. Pull before creating a PR.");
    case "Branch is behind upstream. Pull/rebase before committing and pushing.":
      return i18n._("Branch is behind upstream. Pull/rebase before committing and pushing.");
    case "Branch is behind upstream. Pull/rebase before pushing.":
      return i18n._("Branch is behind upstream. Pull/rebase before pushing.");
    case "Branch is up to date. No action needed.":
      return i18n._("Branch is up to date. No action needed.");
    case "Commit":
      return i18n._("Commit");
    case "Commit & push":
      return i18n._("Commit & push");
    case "Commit & push is currently unavailable.":
      return i18n._("Commit & push is currently unavailable.");
    case "Commit & push to default branch?":
      return i18n._("Commit & push to default branch?");
    case "Commit is currently unavailable.":
      return i18n._("Commit is currently unavailable.");
    case "Commit local changes before creating a PR.":
      return i18n._("Commit local changes before creating a PR.");
    case "Commit on new branch":
      return i18n._("Commit on new branch");
    case "Commit or stash local changes before pushing.":
      return i18n._("Commit or stash local changes before pushing.");
    case "Commit, push & PR":
      return i18n._("Commit, push & PR");
    case "Committed changes":
      return i18n._("Committed changes");
    case "Committing...":
      return i18n._("Committing...");
    case "Create and checkout a branch before pushing or opening a PR.":
      return i18n._("Create and checkout a branch before pushing or opening a PR.");
    case "Create and checkout new branch...":
      return i18n._("Create and checkout new branch...");
    case "Create Branch":
      return i18n._("Create Branch");
    case "Create feature branch & continue":
      return i18n._("Create feature branch & continue");
    case "Create feature branch & PR?":
      return i18n._("Create feature branch & PR?");
    case "Create feature branch, commit & PR?":
      return i18n._("Create feature branch, commit & PR?");
    case "Create PR":
      return i18n._("Create PR");
    case "Create PR is currently unavailable.":
      return i18n._("Create PR is currently unavailable.");
    case "Created PR":
      return i18n._("Created PR");
    case "Creating PR...":
      return i18n._("Creating PR...");
    case "Current branch has no upstream to pull from.":
      return i18n._("Current branch has no upstream to pull from.");
    case "Detached HEAD":
      return i18n._("Detached HEAD");
    case "Detached HEAD: checkout a branch before committing and pushing.":
      return i18n._("Detached HEAD: checkout a branch before committing and pushing.");
    case "Detached HEAD: checkout a branch before creating a PR.":
      return i18n._("Detached HEAD: checkout a branch before creating a PR.");
    case "Detached HEAD: checkout a branch before pulling.":
      return i18n._("Detached HEAD: checkout a branch before pulling.");
    case "Detached HEAD: checkout a branch before pushing.":
      return i18n._("Detached HEAD: checkout a branch before pushing.");
    case "Done":
      return i18n._("Done");
    case "Generating commit message...":
      return i18n._("Generating commit message...");
    case "Git action in progress.":
      return i18n._("Git action in progress.");
    case "Git status is unavailable.":
      return i18n._("Git status is unavailable.");
    case "No branch changes to include in a PR.":
      return i18n._("No branch changes to include in a PR.");
    case "No local changes or commits to push.":
      return i18n._("No local changes or commits to push.");
    case "No local commits to push.":
      return i18n._("No local commits to push.");
    case "Open PR in browser":
      return i18n._("Open PR in browser");
    case "Opened PR":
      return i18n._("Opened PR");
    case "Preparing feature branch...":
      return i18n._("Preparing feature branch...");
    case "Pull":
      return i18n._("Pull");
    case "Pulling...":
      return i18n._("Pulling...");
    case "Push":
      return i18n._("Push");
    case "Push & create PR":
      return i18n._("Push & create PR");
    case "Push is currently unavailable.":
      return i18n._("Push is currently unavailable.");
    case "Push to default branch?":
      return i18n._("Push to default branch?");
    case "Pushing...":
      return i18n._("Pushing...");
    case "Refreshing git status...":
      return i18n._("Refreshing git status...");
    case "Select at least one file to commit.":
      return i18n._("Select at least one file to commit.");
    case "Select branch":
      return i18n._("Select branch");
    case "Sync branch":
      return i18n._("Sync branch");
    case "This action is currently unavailable.":
      return i18n._("This action is currently unavailable.");
    case "View PR":
      return i18n._("View PR");
    case "View PR is currently unavailable.":
      return i18n._("View PR is currently unavailable.");
    case "Worktree is clean. Make changes before committing.":
      return i18n._("Worktree is clean. Make changes before committing.");
  }

  const fromBranch = /^From (.+)$/u.exec(text);
  if (fromBranch) return i18n._("From {branch}", { branch: fromBranch[1]! });
  const createBranch = /^Create and checkout "(.+)"$/u.exec(text);
  if (createBranch) {
    return i18n._('Create and checkout "{branch}"', { branch: createBranch[1]! });
  }
  const pushTarget = /^Pushing to (.+)\.\.\.$/u.exec(text);
  if (pushTarget) return i18n._("Pushing to {branch}...", { branch: pushTarget[1]! });
  const commitPushTarget = /^Commit & push to (.+)$/u.exec(text);
  if (commitPushTarget) {
    return i18n._("Commit & push to {branch}", { branch: commitPushTarget[1]! });
  }
  const pushBranch = /^Push to (.+)$/u.exec(text);
  if (pushBranch) return i18n._("Push to {branch}", { branch: pushBranch[1]! });
  const commitPushDescription =
    /^This action will commit and push changes on "(.+)"\. You can continue on this branch or create a feature branch and run the same action there\.$/u.exec(
      text,
    );
  if (commitPushDescription) {
    return i18n._(
      'This action will commit and push changes on "{branch}". You can continue on this branch or create a feature branch and run the same action there.',
      { branch: commitPushDescription[1]! },
    );
  }
  const pushDescription =
    /^This action will push local commits on "(.+)"\. You can continue on this branch or create a feature branch and run the same action there\.$/u.exec(
      text,
    );
  if (pushDescription) {
    return i18n._(
      'This action will push local commits on "{branch}". You can continue on this branch or create a feature branch and run the same action there.',
      { branch: pushDescription[1]! },
    );
  }
  const featureBranchCommitPr =
    /^Pull requests can't be opened from "(.+)" into itself\. This action will create a feature branch, commit your changes there, push it, and create the PR\.$/u.exec(
      text,
    );
  if (featureBranchCommitPr) {
    return i18n._(
      'Pull requests can\'t be opened from "{branch}" into itself. This action will create a feature branch, commit your changes there, push it, and create the PR.',
      { branch: featureBranchCommitPr[1]! },
    );
  }
  const featureBranchPr =
    /^Pull requests can't be opened from "(.+)" into itself\. This action will create a feature branch from your current commits, push it, and create the PR\.$/u.exec(
      text,
    );
  if (featureBranchPr) {
    return i18n._(
      'Pull requests can\'t be opened from "{branch}" into itself. This action will create a feature branch from your current commits, push it, and create the PR.',
      { branch: featureBranchPr[1]! },
    );
  }
  const committed = /^Committed (.+)$/u.exec(text);
  if (committed) return i18n._("Committed {revision}", { revision: committed[1]! });
  const createdPr = /^Created PR( #\d+)$/u.exec(text);
  if (createdPr) return i18n._("Created PR{number}", { number: createdPr[1]! });
  const openedPr = /^Opened PR( #\d+)$/u.exec(text);
  if (openedPr) return i18n._("Opened PR{number}", { number: openedPr[1]! });
  const pushed = /^Pushed(?: ([^ ]+))?(?: to (.+))?$/u.exec(text);
  if (pushed) {
    if (pushed[1] && pushed[2]) {
      return i18n._("Pushed {revision} to {branch}", {
        revision: pushed[1],
        branch: pushed[2],
      });
    }
    if (pushed[1]) return i18n._("Pushed {revision}", { revision: pushed[1] });
    if (pushed[2]) return i18n._("Pushed to {branch}", { branch: pushed[2] });
    return i18n._("Pushed");
  }

  return text;
}
