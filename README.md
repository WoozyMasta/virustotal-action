# VirusTotal Action

Upload Release Assets or Specified File Globs to VirusTotal and Optionally Update Release Notes with Links.

* [VirusTotal Action](#virustotal-action)
  * [Inputs](#inputs)
    * [Update Release](#update-release)
  * [Outputs](#outputs)
  * [Examples](#examples)

The `/files/` endpoint is used for files under 32MB, otherwise,
the `/files/upload_url/` endpoint is used providing support
for files up to `650MB`. Therefore, files over 32MB will consume 2 API calls.

## Inputs

| input            | required | default | description                                 |
| ---------------- | -------- | ------- | ------------------------------------------- |
| `github_token`   | Yes      | -       | GitHub Token: `${{ secrets.GITHUB_TOKEN }}` |
| `vt_api_key`     | Yes      | -       | VirusTotal API Key from VirusTotal \*       |
| `file_globs`     | No       | -       | File Globs to Process, newline seperated \* |
| `rate_limit`     | No       | 4       | API Calls Per Minute, `0` to disable        |
| `update_release` | No       | true    | Update Release Notes, `false` to disable    |

* `vt_api_key` - Get your API key from: <https://www.virustotal.com/gui/my-apikey>
* `file_globs` - For glob pattern examples, see: <https://github.com/actions/toolkit/tree/main/packages/glob#patterns>

```yaml
- name: VirusTotal Artifacts Scan
  uses: WoozyMasta/virustotal-action@v1.0.0
            
  with:
      github_token: ${{ secrets.GITHUB_TOKEN }}
      vt_api_key: ${{ secrets.VT_API_KEY }}
```

### Update Release

The Update Release option will append text similar to this to the release body:

---

🛡️ **VirusTotal Results:**

* [install-linux.deb](https://www.virustotal.com/gui/file-analysis/ZDAzY2M2ZGQzZmEwZWEwZTI2NjQ5NmVjZDcwZmY0YTY6MTcxNzU2NzI3Ng==)
* [install-macos.pkg](https://www.virustotal.com/gui/file-analysis/YTkzOGFjMDZhNTI3NmU5MmI4YzQzNzg5ODE3OGRkMzg6MTcxNzU2NzI3OA==)
* [install-win.exe](https://www.virustotal.com/gui/file-analysis/M2JhZDJhMzRhYjcyM2Y0MDFkNjU1OGZlYjFkNjgyMmY6MTcxNzU2NzI4MA==)

---

## Outputs

| output  | description                         |
| ------- | ----------------------------------- |
| results | Comma Seperated String of `file/id` |

Example Output:

```text
install-linux.deb/ZDAzY2M2ZGQzZmEwZWEwZTI2NjQ5NmVjZDcwZmY0YTY6MTcxNzU2NzI3Ng==,install-macos.pkg/YTkzOGFjMDZhNTI3NmU5MmI4YzQzNzg5ODE3OGRkMzg6MTcxNzU2NzI3OA==,install-win.exe/M2JhZDJhMzRhYjcyM2Y0MDFkNjU1OGZlYjFkNjgyMmY6MTcxNzU2NzI4MA==
```

```yaml
- name: VirusTotal Artifacts Scan
  uses: WoozyMasta/virustotal-action@v1.0.0
  id: vt
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    vt_api_key: ${{ secrets.VT_API_KEY }}

- name: 'Echo Results'
  run: echo ${{ steps.vt.outputs.results }}
```

## Examples

With File Globs:

```yaml
- name: VirusTotal Artifacts Scan
  uses: WoozyMasta/virustotal-action@v1.0.0
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    vt_api_key: ${{ secrets.VT_API_KEY }}
    file_globs: artifacts/*
```

Multiple Globs:

```yaml
- name: VirusTotal Artifacts Scan
  uses: WoozyMasta/virustotal-action@v1.0.0
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    vt_api_key: ${{ secrets.VT_API_KEY }}
    file_globs: |
      artifacts/*
      assets/asset.zip
```

Simple Example:

```yaml
name: VirusTotal Example

on:
  release:
    types: [published]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: VirusTotal Artifacts Scan
        uses: WoozyMasta/virustotal-action@v1.0.0
            
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          vt_api_key: ${{ secrets.VT_API_KEY }}
```
