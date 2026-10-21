# Ownership rules

Work only in the member folder assigned to your task. Member 1 owns root integration files. Do not format, update lockfiles, regenerate code, or change migrations in another member's folder. Ask the owning member for an interface change through a pull request.

- member-1-platform: integration, contracts, platform, root documentation and automation.
- member-2-personalization: profile, watchlist, recommendations.
- member-3-catalog: catalog write/read.
- member-4-billing: subscription, payment, invoice.
- member-5-playback: playback session and watch history.

Use a branch named member-N/short-description. Do not commit runtime data, secrets, generated artifacts or dependencies. Each member has independent dependency manifests and build commands. Cross-folder code imports and cross-service database access are prohibited. Use the versioned contracts in member-1-platform/contracts.

Keep local demo shortcuts documented in IMPLEMENTATION_STATUS.md. Never claim production qualification based on local tests.
