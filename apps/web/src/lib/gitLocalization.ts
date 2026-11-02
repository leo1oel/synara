import { t } from "~/i18n";

/** Translate the finite set of labels and hints produced by Git view-model helpers. */
export function localizeGitText(translate: typeof t, text: string): string {
  switch (text) {
    case 'Add an "origin" remote before committing and pushing.':
      return translate("lattice:addAnOriginRemoteBeforeCommittingAnd");
    case 'Add an "origin" remote before creating a PR.':
      return translate("lattice:addAnOriginRemoteBeforeCreatingA");
    case 'Add an "origin" remote before pushing.':
      return translate("lattice:addAnOriginRemoteBeforePushing");
    case 'Add an "origin" remote before pushing or creating a PR.':
      return translate("lattice:addAnOriginRemoteBeforePushingOr");
    case "A pull request is already open for this branch.":
      return translate("lattice:aPullRequestIsAlreadyOpenFor");
    case "Branch has diverged from upstream. Rebase/merge first.":
      return translate("lattice:branchHasDivergedFromUpstreamRebaseMerge");
    case "Branch is already up to date.":
      return translate("lattice:branchIsAlreadyUpToDate");
    case "Branch is behind upstream. Pull before creating a PR.":
      return translate("lattice:branchIsBehindUpstreamPullBeforeCreating");
    case "Branch is behind upstream. Pull/rebase before committing and pushing.":
      return translate("lattice:branchIsBehindUpstreamPullRebaseBefore");
    case "Branch is behind upstream. Pull/rebase before pushing.":
      return translate("lattice:branchIsBehindUpstreamPullRebaseBefore2");
    case "Branch is up to date. No action needed.":
      return translate("lattice:branchIsUpToDateNoAction");
    case "Commit":
      return translate("lattice:commit");
    case "Commit & push":
      return translate("lattice:commitPush");
    case "Commit & push is currently unavailable.":
      return translate("lattice:commitPushIsCurrentlyUnavailable");
    case "Commit & push to default branch?":
      return translate("lattice:commitPushToDefaultBranch");
    case "Commit is currently unavailable.":
      return translate("lattice:commitIsCurrentlyUnavailable");
    case "Commit local changes before creating a PR.":
      return translate("lattice:commitLocalChangesBeforeCreatingAPR");
    case "Commit on new branch":
      return translate("lattice:commitOnNewBranch");
    case "Commit or stash local changes before pushing.":
      return translate("lattice:commitOrStashLocalChangesBeforePushing");
    case "Commit, push & PR":
      return translate("lattice:commitPushPR");
    case "Committed changes":
      return translate("lattice:committedChanges");
    case "Committing...":
      return translate("lattice:committing");
    case "Create and checkout a branch before pushing or opening a PR.":
      return translate("lattice:createAndCheckoutABranchBeforePushing");
    case "Create and checkout new branch...":
      return translate("common:createAndCheckoutNewBranch");
    case "Create Branch":
      return translate("common:createBranch");
    case "Create feature branch & continue":
      return translate("git:createFeatureBranchContinue");
    case "Create feature branch & PR?":
      return translate("lattice:createFeatureBranchPR");
    case "Create feature branch, commit & PR?":
      return translate("lattice:createFeatureBranchCommitPR");
    case "Create PR":
      return translate("git:createPR");
    case "Create PR is currently unavailable.":
      return translate("lattice:createPRIsCurrentlyUnavailable");
    case "Created PR":
      return translate("lattice:createdPR");
    case "Creating PR...":
      return translate("lattice:creatingPR");
    case "Current branch has no upstream to pull from.":
      return translate("lattice:currentBranchHasNoUpstreamToPull");
    case "Detached HEAD":
      return translate("common:detachedHEAD");
    case "Detached HEAD: checkout a branch before committing and pushing.":
      return translate("lattice:detachedHEADCheckoutABranchBeforeCommitting");
    case "Detached HEAD: checkout a branch before creating a PR.":
      return translate("lattice:detachedHEADCheckoutABranchBeforeCreating");
    case "Detached HEAD: checkout a branch before pulling.":
      return translate("lattice:detachedHEADCheckoutABranchBeforePulling");
    case "Detached HEAD: checkout a branch before pushing.":
      return translate("lattice:detachedHEADCheckoutABranchBeforePushing");
    case "Done":
      return translate("git:detail_done");
    case "Generating commit message...":
      return translate("lattice:generatingCommitMessage");
    case "Git action in progress.":
      return translate("lattice:gitActionInProgress");
    case "Git status is unavailable.":
      return translate("lattice:gitStatusIsUnavailable");
    case "No branch changes to include in a PR.":
      return translate("git:noBranchChangesToIncludeInAPR");
    case "No local changes or commits to push.":
      return translate("lattice:noLocalChangesOrCommitsToPush");
    case "No local commits to push.":
      return translate("lattice:noLocalCommitsToPush");
    case "Open PR in browser":
      return translate("git:openPRInBrowser");
    case "Opened PR":
      return translate("lattice:openedPR");
    case "Preparing feature branch...":
      return translate("lattice:preparingFeatureBranch");
    case "Pull":
      return translate("git:pull");
    case "Pulling...":
      return translate("lattice:pulling");
    case "Push":
      return translate("lattice:push");
    case "Push & create PR":
      return translate("lattice:pushCreatePR");
    case "Push is currently unavailable.":
      return translate("lattice:pushIsCurrentlyUnavailable");
    case "Push to default branch?":
      return translate("lattice:pushToDefaultBranch");
    case "Pushing...":
      return translate("lattice:pushing");
    case "Refreshing git status...":
      return translate("git:refreshingGitStatus");
    case "Select at least one file to commit.":
      return translate("lattice:selectAtLeastOneFileToCommit");
    case "Select branch":
      return translate("common:selectBranch");
    case "Sync branch":
      return translate("lattice:syncBranch");
    case "This action is currently unavailable.":
      return translate("lattice:thisActionIsCurrentlyUnavailable");
    case "View PR":
      return translate("git:viewPR");
    case "View PR is currently unavailable.":
      return translate("lattice:viewPRIsCurrentlyUnavailable");
    case "Worktree is clean. Make changes before committing.":
      return translate("lattice:worktreeIsCleanMakeChangesBeforeCommitting");
  }

  const fromBranch = /^From (.+)$/u.exec(text);
  if (fromBranch) return translate("common:from", { value0: fromBranch[1]! });
  const createBranch = /^Create and checkout "(.+)"$/u.exec(text);
  if (createBranch) {
    return translate("common:createAndCheckout", { value0: createBranch[1]! });
  }
  const pushTarget = /^Pushing to (.+)\.\.\.$/u.exec(text);
  if (pushTarget) return translate("lattice:pushingTo", { branch: pushTarget[1]! });
  const commitPushTarget = /^Commit & push to (.+)$/u.exec(text);
  if (commitPushTarget) {
    return translate("lattice:commitPushTo", { branch: commitPushTarget[1]! });
  }
  const pushBranch = /^Push to (.+)$/u.exec(text);
  if (pushBranch) return translate("lattice:pushTo", { branch: pushBranch[1]! });
  const commitPushDescription =
    /^This action will commit and push changes on "(.+)"\. You can continue on this branch or create a feature branch and run the same action there\.$/u.exec(
      text,
    );
  if (commitPushDescription) {
    return translate("lattice:thisActionWillCommitAndPushChanges", {
      branch: commitPushDescription[1]!,
    });
  }
  const pushDescription =
    /^This action will push local commits on "(.+)"\. You can continue on this branch or create a feature branch and run the same action there\.$/u.exec(
      text,
    );
  if (pushDescription) {
    return translate("lattice:thisActionWillPushLocalCommitsOn", { branch: pushDescription[1]! });
  }
  const featureBranchCommitPr =
    /^Pull requests can't be opened from "(.+)" into itself\. This action will create a feature branch, commit your changes there, push it, and create the PR\.$/u.exec(
      text,
    );
  if (featureBranchCommitPr) {
    return translate("lattice:pullRequestsCanTBeOpenedFrom", { branch: featureBranchCommitPr[1]! });
  }
  const featureBranchPr =
    /^Pull requests can't be opened from "(.+)" into itself\. This action will create a feature branch from your current commits, push it, and create the PR\.$/u.exec(
      text,
    );
  if (featureBranchPr) {
    return translate("lattice:pullRequestsCanTBeOpenedFrom2", { branch: featureBranchPr[1]! });
  }
  const committed = /^Committed (.+)$/u.exec(text);
  if (committed) return translate("lattice:committed", { revision: committed[1]! });
  const createdPr = /^Created PR( #\d+)$/u.exec(text);
  if (createdPr) return translate("lattice:createdPR2", { number: createdPr[1]! });
  const openedPr = /^Opened PR( #\d+)$/u.exec(text);
  if (openedPr) return translate("lattice:openedPR2", { number: openedPr[1]! });
  const pushed = /^Pushed(?: ([^ ]+))?(?: to (.+))?$/u.exec(text);
  if (pushed) {
    if (pushed[1] && pushed[2]) {
      return translate("lattice:pushedTo", { revision: pushed[1], branch: pushed[2] });
    }
    if (pushed[1]) return translate("lattice:pushed", { revision: pushed[1] });
    if (pushed[2]) return translate("lattice:pushedTo2", { branch: pushed[2] });
    return translate("workspace:pushed");
  }

  return text;
}
