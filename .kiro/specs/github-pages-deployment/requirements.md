# Requirements Document

## Introduction

This document defines the requirements for deploying the Rally Flutter web application to GitHub Pages. The Rally project is a stock trading valuations engine with a neon-themed UI, hosted at `github.com:ChrisKramer15/rally.git`. The deployment pipeline will use GitHub Actions to automatically build the Flutter web app and publish it to GitHub Pages whenever changes are pushed to the main branch.

## Glossary

- **Workflow**: A GitHub Actions workflow defined as a YAML file in the `.github/workflows/` directory that automates the build and deployment process
- **Build_Artifact**: The compiled Flutter web output produced by `flutter build web`, located in the `build/web` directory
- **Base_Href**: The base URL path prefix required for the app to load assets correctly when hosted in a subdirectory (e.g., `/rally/`)
- **Deployment_Pipeline**: The automated sequence of steps from code push to live site availability on GitHub Pages
- **GitHub_Pages**: A static site hosting service provided by GitHub that serves content from a designated branch or GitHub Actions artifact

## Requirements

### Requirement 1: GitHub Actions Workflow File

**User Story:** As a developer, I want a GitHub Actions workflow configuration file, so that the deployment process is automated and version-controlled.

#### Acceptance Criteria

1. THE Workflow SHALL be defined in a file located at `.github/workflows/deploy.yml` with a `name` field set to identify it in the GitHub Actions UI
2. WHEN a push event occurs on the `main` branch, THE Workflow SHALL trigger a deployment run
3. THE Workflow SHALL specify `permissions` for `contents: read` and `pages: write` and `id-token: write`
4. THE Workflow SHALL define a concurrency group that cancels any in-progress deployment when a new deployment run starts, preventing simultaneous deployments to GitHub Pages

### Requirement 2: Flutter Web Build Step

**User Story:** As a developer, I want the workflow to build the Flutter web application, so that the latest code is compiled into deployable static files.

#### Acceptance Criteria

1. WHEN the Workflow executes, THE Workflow SHALL first check out the repository source code before any subsequent build steps
2. WHEN the Workflow executes, THE Workflow SHALL set up the Flutter SDK on the stable channel at a version satisfying the project SDK constraint (>=3.10.0 <4.0.0)
3. WHEN the Workflow executes, THE Workflow SHALL run `flutter pub get` to resolve dependencies
4. WHEN the Workflow executes, THE Workflow SHALL run `flutter build web` with the `--release` flag to produce optimized output
5. WHEN the Workflow executes, THE Workflow SHALL pass `--base-href /rally/` to the build command to match the GitHub Pages repository path

### Requirement 3: GitHub Pages Deployment Step

**User Story:** As a developer, I want the built web artifacts uploaded and deployed to GitHub Pages, so that the application is publicly accessible.

#### Acceptance Criteria

1. WHEN the build step succeeds, THE Workflow SHALL upload the contents of `build/web` as a GitHub Pages artifact using `actions/upload-pages-artifact@v4`
2. WHEN the upload succeeds, THE Workflow SHALL deploy the artifact to the `github-pages` environment using `actions/deploy-pages@v4`
3. THE Workflow SHALL pin the `actions/upload-pages-artifact` and `actions/deploy-pages` GitHub Actions to a major version tag to ensure reproducible deployments
4. WHEN the deployment completes, THE Deployment_Pipeline SHALL make the application accessible at `https://chriskramer15.github.io/rally/` such that an HTTP GET request to that URL returns a successful response serving the `index.html` page

### Requirement 4: Build Failure Handling

**User Story:** As a developer, I want clear feedback when the deployment fails, so that I can quickly identify and fix issues.

#### Acceptance Criteria

1. IF the `flutter pub get` step fails with a non-zero exit code, THEN THE Workflow SHALL skip all subsequent steps in the job and mark the workflow run as failed
2. IF the `flutter build web` step fails with a non-zero exit code, THEN THE Workflow SHALL skip all subsequent steps in the job and mark the workflow run as failed
3. IF the pages deployment step fails, THEN THE Workflow SHALL mark the workflow run as failed
4. IF any step fails, THEN THE Workflow SHALL preserve the failed step's command output in the GitHub Actions log so that the failure cause is identifiable without re-running the workflow

### Requirement 5: Base Href Configuration

**User Story:** As a developer, I want the base href set correctly for the repository path, so that all assets and routes load properly on GitHub Pages.

#### Acceptance Criteria

1. WHEN the build runs, THE Workflow SHALL set the Base_Href to `/rally/` matching the repository name
2. THE Build_Artifact SHALL contain an `index.html` file with the `<base href="/rally/">` tag set correctly
3. WHEN the application is loaded in a browser at `https://chriskramer15.github.io/rally/`, THE Build_Artifact SHALL resolve all asset paths (JavaScript, CSS, images, fonts) relative to the `/rally/` Base_Href so that no 404 errors occur for static resources

### Requirement 6: Workflow Trigger Control

**User Story:** As a developer, I want the option to manually trigger a deployment, so that I can redeploy without pushing a code change.

#### Acceptance Criteria

1. THE Workflow SHALL include `workflow_dispatch` in its trigger configuration alongside the push trigger
2. WHEN a developer triggers the Workflow manually from the GitHub Actions UI, THE Workflow SHALL execute the same build and deployment steps as a push-triggered run, including checkout, Flutter setup, dependency resolution, web build, and pages deployment
3. WHEN a developer triggers the Workflow manually, THE Workflow SHALL use the branch selected in the GitHub Actions UI as the source for checkout and build
