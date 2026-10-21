# Five-person contribution workflow

1. Clone the same repository and use the agreed base branch. Preserve the `Map_nnovatve` directory when it is nested in a larger repository.
2. Create `member-N/feature-name` from the latest base.
3. Edit only your owned folder. Each folder contains its own README, dependencies, tests, Dockerfile and migrations.
4. Run the member's checks and `python member-1-platform/tools/check_workspace.py`.
5. Run `python member-1-platform/tools/check_scope.py --member N --base <base-ref>` to validate your commit diff. This also checks uncommitted and untracked files in this project.
6. Commit explicit member paths, push your branch, and open a pull request. Git uploads must use commits/PRs, not overwriting folders through the web interface.
7. Update from the base before merge and run the integration smoke test. Rebase only your own unpublished work or coordinate before rewriting a shared branch.

Member 1 owns the root files, Compose, identity setup and the versioned contract registry. Other members propose shared changes to Member 1; they do not edit shared files as part of their service PR.

## Interface changes

- Producer and consumer review the contract together.
- Keep released v1 fields and semantics compatible; add a v2 contract for breaking changes.
- New optional event fields must not break existing consumers.
- Never rename a service, port, topic, JSON field or environment variable unilaterally.
- Keep migrations append-only after release, with names local to the service.
- Keep dependency locks local to each member; no root application lockfile exists.

## Backups and review

| Primary | Review/backup partner |
|---|---|
| Member 1 | Member 3 |
| Member 2 | Member 5 |
| Member 3 | Member 2 |
| Member 4 | Member 1 |
| Member 5 | Member 4 |

CODEOWNERS is a template until real GitHub usernames/teams are configured. Branch protection and required status checks must be enabled on the hosting repository. Local scripts alone cannot enforce server-side rules.

Separate ownership reduces textual conflicts. It cannot guarantee zero conflicts or prevent incompatible behavior; contract tests and integration tests address those separate risks.
