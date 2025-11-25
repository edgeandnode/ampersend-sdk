# Release Guide

This document describes how to release new versions of the Ampersend SDK packages to npm and PyPI.

## Prerequisites

### TypeScript (npm)

1. **npm Token**: Configure `NPM_TOKEN` in GitHub repository secrets
   - Generate an automation token at https://www.npmjs.com/settings/tokens
   - Token must have publish access to the `@edgeandnode` scope
   - Add to: Repository Settings → Secrets → Actions → New repository secret
   - Name: `NPM_TOKEN`

### Python (PyPI)

1. **Trusted Publishing**: Configure on PyPI (one-time setup)
   - Visit https://pypi.org/manage/account/publishing/
   - Click "Add a new pending publisher"
   - Fill in:
     - **PyPI Project Name**: `ampersend-sdk`
     - **Owner**: `edgeandnode`
     - **Repository name**: `ampersend-sdk`
     - **Workflow name**: `python-release.yml`
     - **Environment name**: `pypi`
   - After first successful publish, this becomes a "verified publisher"

## Release Process

### TypeScript SDK

1. **Update version** in `typescript/packages/ampersend-sdk/package.json`

   ```bash
   # Edit version field
   vim typescript/packages/ampersend-sdk/package.json
   ```

2. **Commit the version change**

   ```bash
   git add typescript/packages/ampersend-sdk/package.json
   git commit -m "chore(ts): bump version to X.Y.Z"
   git push origin main
   ```

3. **Create and push tag**

   ```bash
   # For stable release
   git tag ts-vX.Y.Z

   # For alpha release
   git tag ts-vX.Y.Z-alpha.N

   # For beta release
   git tag ts-vX.Y.Z-beta.N

   # Push tag
   git push origin ts-vX.Y.Z
   ```

4. **Monitor release**
   - View workflow: https://github.com/edgeandnode/ampersend-sdk/actions/workflows/typescript-release.yml
   - Check npm: https://www.npmjs.com/package/@edgeandnode/ampersend-sdk

### Python SDK

1. **Update version** in `python/ampersend-sdk/pyproject.toml`

   ```bash
   # Edit version field
   vim python/ampersend-sdk/pyproject.toml
   ```

2. **Commit the version change**

   ```bash
   git add python/ampersend-sdk/pyproject.toml
   git commit -m "chore(py): bump version to X.Y.Z"
   git push origin main
   ```

3. **Create and push tag**

   ```bash
   # For stable release
   git tag py-vX.Y.Z

   # For alpha release (PEP 440)
   git tag py-vX.Y.ZaN

   # For beta release (PEP 440)
   git tag py-vX.Y.ZbN

   # For release candidate (PEP 440)
   git tag py-vX.Y.ZrcN

   # Push tag
   git push origin py-vX.Y.Z
   ```

4. **Monitor release**
   - View workflow: https://github.com/edgeandnode/ampersend-sdk/actions/workflows/python-release.yml
   - Check PyPI: https://pypi.org/project/ampersend-sdk/

## What Happens During Release

### TypeScript Release Workflow

1. **Validation** - Runs full CI suite (build, lint, format, typecheck, test)
2. **Version Verification** - Ensures git tag matches `package.json` version
3. **Publish** - Builds and publishes to npm with provenance attestations
   - Stable releases → `latest` tag
   - Alpha releases → `alpha` tag
   - Beta releases → `beta` tag

### Python Release Workflow

1. **Validation** - Runs full CI suite (lint, format, typecheck, test)
2. **Version Verification** - Ensures git tag matches `pyproject.toml` version
3. **Build & Publish** - Builds wheel/sdist and publishes to PyPI using Trusted Publishing

## Version Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0)**: Breaking changes
- **Minor (0.X.0)**: New features, backwards compatible
- **Patch (0.0.X)**: Bug fixes, backwards compatible

### Pre-releases

**TypeScript (npm style)**:

- `0.1.0-alpha.1` - Early testing, unstable
- `0.1.0-beta.1` - Feature complete, stabilizing
- `0.1.0-rc.1` - Release candidate (not currently supported in workflow)

**Python (PEP 440 style)**:

- `0.1.0a1` - Alpha release
- `0.1.0b1` - Beta release
- `0.1.0rc1` - Release candidate

## Troubleshooting

### Version mismatch error

If the workflow fails with "versions do not match":

- Ensure the tag version (without prefix) exactly matches the package version
- Example: `ts-v0.1.0` must match `"version": "0.1.0"` in package.json

### npm publish fails

- Verify `NPM_TOKEN` secret is set correctly
- Check token has not expired
- Ensure you have publish permissions for `@edgeandnode` scope

### PyPI publish fails

- Verify Trusted Publishing is configured correctly on PyPI
- Check workflow name and environment name match exactly
- For first publish to a new package, you may need to use an API token instead

### Build artifacts missing

- Ensure `pnpm build` or `uv build` completes successfully
- Check `dist/` directory contains expected files
- Review build logs in GitHub Actions

## Security

### npm Provenance

All npm packages are published with provenance attestations:

- Proves the package was built by this specific GitHub workflow
- Visible on the npm package page
- Provides transparency and supply chain security

### PyPI Trusted Publishing

- More secure than API tokens
- No long-lived credentials to manage
- Uses GitHub's OIDC for authentication
- Recommended by PyPI for all projects

## Support

For issues with releases:

- Check GitHub Actions logs for detailed error messages
- Review this guide and ensure all prerequisites are met
- Open an issue at https://github.com/edgeandnode/ampersend-sdk/issues
