# Member 1 — platform and integration

Own this folder and root integration documents. Other members consume the contracts without changing them. Own the Compose stack, bootstrap, gateway, identity, schemas and shared tests.

```powershell
python member-1-platform/tools/check_workspace.py
python -m unittest discover -s member-1-platform/tests -p "test_*.py"
node --test member-1-platform/tests/frontend.test.mjs
node member-1-platform/tools/bootstrap.mjs
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml config --quiet
```

`github/ci.yml`, `github/integration.yml` and `github/CODEOWNERS` are templates. If publishing the complete project as its own repository, install them under `.github/workflows/` and `.github/CODEOWNERS`. If retaining the parent repository, Member 1 must adapt the paths and working directory before installing them there. Replace the sample team handles and require code-owner approval and CI in repository settings. Integration uses an isolated self-hosted Linux runner with the `streaming` label and sufficient Docker memory.

See [VERIFICATION.md](VERIFICATION.md) for checks actually executed and the Docker-engine limitation.

Production infrastructure, HA, Vault, mesh policies and DR are tracked in the original plan; this local stack intentionally does not claim those gates.

## Frontend and API documentation

The Compose `frontend` service serves the streaming UI at http://localhost:8090. API documentation is the Markdown [API_REFERENCE.md](API_REFERENCE.md); there is no API documentation webpage. The frontend uses Node built-ins with no dependency manifest/build step. See [frontend usage](frontend/README.md).

The versioned HTTP definitions in `contracts/http.v1.mjs` describe all eleven service roles. Public and per-service OpenAPI 3.1 documents are served in memory. Tests compare route declarations across the four language stacks with documented paths and exercise the proxy using isolated mock upstreams; they do not substitute for the real-stack smoke test.
