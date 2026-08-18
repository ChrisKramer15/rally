# Implementation Plan: GitHub Pages Deployment

## Overview

Create a GitHub Actions workflow file (`.github/workflows/deploy.yml`) that automatically builds the Rally Flutter web application and deploys it to GitHub Pages. The workflow uses a two-job architecture (build + deploy) with GitHub's first-party Pages actions.

## Tasks

- [x] 1. Create workflow file with trigger and permissions configuration
  - [x] 1.1 Create `.github/workflows/deploy.yml` with workflow name, trigger configuration, permissions, and concurrency settings
    - Create the `.github/workflows/` directory structure if it does not exist
    - Define `name: Deploy to GitHub Pages`
    - Add `on` triggers for `push` (branches: `[main]`) and `workflow_dispatch`
    - Add `permissions` block with `contents: read`, `pages: write`, and `id-token: write`
    - Add `concurrency` block with group `"pages"` and `cancel-in-progress: true`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.2, 6.3_

- [x] 2. Implement the build job
  - [x] 2.1 Add build job with checkout and Flutter SDK setup steps
    - Define `build` job running on `ubuntu-latest`
    - Add `actions/checkout@v4` step to check out the repository
    - Add `subosito/flutter-action@v2` step with `channel: stable` to set up the Flutter SDK
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Add dependency resolution and web build steps
    - Add `run: flutter pub get` step for dependency resolution
    - Add `run: flutter build web --release --base-href /rally/` step for the web build
    - _Requirements: 2.3, 2.4, 2.5, 5.1, 5.2, 5.3_

  - [x] 2.3 Add artifact upload step to the build job
    - Add `actions/upload-pages-artifact@v4` step with `path: build/web`
    - _Requirements: 3.1, 3.3_

- [x] 3. Implement the deploy job
  - [x] 3.1 Add deploy job with environment configuration and deployment step
    - Define `deploy` job running on `ubuntu-latest` with `needs: build`
    - Add `environment` block with `name: github-pages` and `url: ${{ steps.deployment.outputs.page_url }}`
    - Add `actions/deploy-pages@v4` step with `id: deployment`
    - _Requirements: 3.2, 3.3, 3.4, 4.3_

- [x] 4. Checkpoint - Validate workflow file
  - Ensure the workflow YAML is syntactically valid and all required fields are present, ask the user if questions arise.

- [x] 5. Local build verification
  - [x] 5.1 Run `flutter build web --release --base-href /rally/` locally and verify `build/web/index.html` contains `<base href="/rally/">`
    - Execute the Flutter web build command locally
    - Inspect the output `build/web/index.html` to confirm the base href tag is correctly set
    - Verify no build errors occur
    - _Requirements: 2.4, 2.5, 5.1, 5.2, 5.3, 4.1, 4.2_

- [x] 6. Final checkpoint - Verify complete workflow
  - Ensure the workflow file is complete and correct, ask the user if questions arise.

## Notes

- This feature produces a single declarative YAML configuration file — no algorithmic code or property-based tests apply
- Correctness is validated by GitHub Actions' execution engine and post-deployment smoke testing
- The deploy job depends on the build job (`needs: build`), so build failures automatically prevent deployment (Requirements 4.1, 4.2, 4.3)
- GitHub Actions natively preserves step output in logs, satisfying Requirement 4.4 without additional configuration
- GitHub Pages must be configured in repository settings to use "GitHub Actions" as the source before the workflow can deploy successfully

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "3.1"] },
    { "id": 4, "tasks": ["5.1"] }
  ]
}
```
