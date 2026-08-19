# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list`
- Comment: `gh issue comment <number> --body "..."`
- Apply/remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

- “Publish to the issue tracker”: create a GitHub issue.
- “Fetch the relevant ticket”: run `gh issue view <number> --comments`.
- Wayfinder maps and child tickets use GitHub issues, native sub-issues and dependencies when available, with task-list and `Blocked by:` fallbacks.
