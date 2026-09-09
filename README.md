# VirusTotal Action

Scan local files or GitHub release assets with the VirusTotal API.
The action uses bounded HTTP timeouts, retries transient failures,
per-request rate limiting, SHA-256 results, partial-failure reporting,
and an idempotent release-notes block.

## Quick start

For local files, check out the repository and provide `file_globs`:

```yaml
* uses: actions/checkout@v6
* name: Scan artifacts
  id: vt
  uses: WoozyMasta/virustotal-action@v2
  with:
    vt_api_key: ${{ secrets.VT_API_KEY }}
    file_globs: artifacts/*
    update_release: false
```

Release asset scanning does not require checkout.
Set `release_id` for deterministic selection,
or use `source: auto` with a supported event payload.

## Inputs

Input | Default | Description
--- | --- | ---
`vt_api_key` | required | VirusTotal API key.
`github_token` | `${{ github.token }}` | GitHub API token.
`source` | `auto` | `auto`, `release`, or `files`. Explicit mode overrides detection.
`file_globs` | empty | Local file patterns; in release mode, backward-compatible asset patterns.
`asset_globs` | empty | Release asset basename patterns. If empty, `file_globs` is used.
`exclude_globs` | empty | Patterns excluded after inclusion matching.
`excluded_extensions` | empty | Deprecated v1 alias; accepts extensions or glob patterns.
`release_id` | empty | Exact numeric release ID.
`release_tag` | empty | Exact release tag.
`release_sha` | empty | Commit SHA used to resolve a release.
`rate_limit` | `4` | Maximum VirusTotal requests/minute; `0` disables client throttling.
`update_release` | `true` | Update the managed release-notes block.
`wait_for_assets` | `60` | Maximum seconds to wait for assets; `0` disables waiting.
`asset_poll_interval` | `5` | Seconds between asset-list polls.
`request_timeout` | `120` | Timeout per VirusTotal request, in seconds.
`retries` | `4` | Retries for network errors and transient HTTP responses.
`retry_base_delay` | `5` | Initial exponential retry delay, in seconds.
`retry_max_delay` | `60` | Maximum retry delay, in seconds.
`require_all_globs` | `false` | Fail if every configured release glob does not match.
`fail_on_partial` | `true` | Process all files, then fail if any submission failed.
`summary` | `true` | Write results to the GitHub job summary.
`wait_for_analysis` | `false` | Poll analysis status after submission.
`analysis_timeout` | `300` | Maximum analysis polling time per file, in seconds.

`update_release: true` requires `contents: write`;
use `contents: read` when it is false.
Public VirusTotal API documentation currently
lists 4 requests/minute and 500 requests/day;
Premium limits differ and should be checked with VirusTotal.

## Outputs

Output | Description
--- | ---
`results` | Legacy comma-separated `file/analysis-id` list for successful submissions.
`json` | JSON array containing one structured result per selected file.
`release_id` | Resolved release ID, if any.
`processed_count` | Number of selected files.
`success_count` | Number of successful submissions.
`failed_count` | Number of failed submissions.

Each JSON result contains `name`, `sha256`, `status`,
`analysis_id`, `analysis_url`, `file_url`, and `error`.
With `wait_for_analysis: false`,
`submitted` means VirusTotal accepted the upload;
it does not mean engine analysis has completed.

## Release asset mode

Assets are fetched with pagination, matched by basename using `minimatch`,
and downloaded into a unique temporary directory.
Asset names containing path separators, traversal,
or control characters are rejected.
Temporary files are removed after processing.

```yaml
permissions:
  contents: write

steps:
  - name: Scan release assets
    uses: WoozyMasta/virustotal-action@v2
    with:
      vt_api_key: ${{ secrets.VT_API_KEY }}
      release_tag: ${{ github.ref_name }}
      asset_globs: |
        my-app-*
        *.zip
      exclude_globs: '*.sig'
      require_all_globs: true
```

If no assets exist, the action waits up to `wait_for_assets`.
If the final selection is empty,
the action fails instead of reporting a successful empty scan.

## Local file mode

Use `source: files` to prevent release detection,
and include a checkout step when files are produced by the repository:

```yaml
* uses: actions/checkout@v6
* uses: WoozyMasta/virustotal-action@v2
  with:
    source: files
    vt_api_key: ${{ secrets.VT_API_KEY }}
    file_globs: |
      dist/**
      package.json
    exclude_globs: |
      '**/*.sig'
      '**/*.sbom.json'
    update_release: false
```

## Release workflows created by GitHub Actions

A release event created with the workflow's `GITHUB_TOKEN`
normally does not trigger another workflow.
This is GitHub recursion prevention. `workflow_dispatch`
and `repository_dispatch` are explicit exceptions,
so a scanner that only listens to `release: published`
is not sufficient for a release created with the normal token.

### Recommended: `repository_dispatch` without a PAT

Create and upload every release asset,
then dispatch the independent scanner with release metadata:

```yaml
permissions:
  contents: write

steps:
  - name: Create Release
    id: create_release
    uses: ncipollo/release-action@v1
    with:
      token: ${{ github.token }}
      # artifacts/body/etc...

  - name: Trigger VirusTotal scan
    env:
      GH_TOKEN: ${{ github.token }}
      RELEASE_ID: ${{ steps.create_release.outputs.id }}
      RELEASE_TAG: ${{ github.ref_name }}
    run: |
      jq -n \
        --arg release_id "$RELEASE_ID" \
        --arg release_tag "$RELEASE_TAG" \
        '{event_type:"virustotal-scan",client_payload:{release_id:$release_id,release_tag:$release_tag}}' \
      | gh api --method POST "repos/${GITHUB_REPOSITORY}/dispatches" --input -
```

The independent workflow can use its own token:

```yaml
name: VirusTotal release scan

on:
  repository_dispatch:
    types: [virustotal-scan]

permissions:
  contents: write

concurrency:
  group: vt-release-${{ github.event.client_payload.release_id }}
  cancel-in-progress: false

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: WoozyMasta/virustotal-action@v2
        with:
          github_token: ${{ github.token }}
          vt_api_key: ${{ secrets.VT_API_KEY }}
          release_id: ${{ github.event.client_payload.release_id }}
          update_release: true
```

The dispatch payload is metadata only.
Never put `VT_API_KEY`, a PAT, or a private key in `client_payload`.

### `workflow_run` alternative

`workflow_run` is another independent, PAT-free option.
Require `github.event.workflow_run.conclusion == 'success'`,
keep the workflow file on the default branch,
and resolve releases carefully from `head_sha`;
multiple releases can point to one commit.
A privileged `workflow_run` must not execute untrusted artifacts
or scripts from the preceding workflow.
Pass trusted release metadata where practical.

### GitHub App installation token

Use a narrowly installed GitHub App
when a natural `release: published` chain is required:

```yaml
* name: Create GitHub App token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.APP_CLIENT_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}
    permission-contents: write

* name: Create Release
  uses: ncipollo/release-action@v1
  with:
    token: ${{ steps.app-token.outputs.token }}
```

The scanner can then use `on: release: types: [published]`
and its own `${{ github.token }}`.
Do not pass the App private key to this action.
Installation tokens are short-lived;
`actions/create-github-app-token` revokes its token
in the post step unless configured otherwise.

### Fine-grained PAT fallback

Use a fine-grained PAT restricted to the required repository
and `Contents: Read and write`, with short expiration and rotation:

```yaml
* name: Create Release
  uses: ncipollo/release-action@v1
  with:
    token: ${{ secrets.RELEASE_TOKEN }}
```

The scanner can listen to `release: published`.
A classic PAT has broader scope
and should only be used when compatibility requires it.
Do not configure `created`, `released`, or `edited` for a normal scanner;
use only `published` to reduce recursion and duplicate runs.

## Manual re-scan

Add `workflow_dispatch` to retry a failed scan without editing the release:

```yaml
on:
  workflow_dispatch:
    inputs:
      release_tag:
        description: Release tag to scan
        required: true
        type: string

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: WoozyMasta/virustotal-action@v2
        with:
          vt_api_key: ${{ secrets.VT_API_KEY }}
          release_tag: ${{ inputs.release_tag }}
```

## Release notes and reliability

When enabled, the action maintains this block:

```html
<!-- virustotal-action:start -->
### VirusTotal analysis results
...
<!-- virustotal-action:end -->
```

Existing blocks are replaced, not appended.
The latest release body is fetched immediately before writing;
null bodies are supported, unrelated text is preserved,
and old unmarked v1 sections are migrated when they form a standalone heading.

Every VirusTotal request has an explicit timeout.
Retries use exponential backoff with jitter,
honor `Retry-After`, and cover network errors, 429, 503, and 504.
Authentication and malformed-request errors are not retried.
Large-file retries obtain a fresh upload URL and create a fresh stream/form.
Rate limiting is applied before each HTTP request,
including upload URL requests and optional analysis polling.

## Troubleshooting

* **The scan runs only after editing/saving the release:**
  the release was likely created with `GITHUB_TOKEN`;
  use `repository_dispatch`, `workflow_run`, a GitHub App token,
  or a fine-grained PAT as described above.
* **No Assets Found:**
  publication may race asset upload.
  Dispatch after all uploads or increase `wait_for_assets`.
* **No assets matched:**
  check the logged patterns and available asset names;
  matching uses basenames.
* **HTTP 429:**
  retries help transient throttling,
  but cannot immediately fix an exhausted Public API daily quota.
* **VT timeout/503/504:**
  built-in retries are bounded;
  also set a job-level `timeout-minutes`.
* **Release notes are not updated:**
  ensure `permissions: contents: write` and `update_release: true`.

## References

* [GitHub workflow triggers and `GITHUB_TOKEN`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
* [GitHub events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
* [Create a repository dispatch event](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
* [VirusTotal API overview](https://docs.virustotal.com/reference/overview)
* [VirusTotal upload URL](https://docs.virustotal.com/reference/files-upload-url)
* [VirusTotal Public vs Premium limits](https://docs.virustotal.com/reference/public-vs-premium-api)
