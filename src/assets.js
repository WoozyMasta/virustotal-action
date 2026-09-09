const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const core = require('@actions/core')
const { minimatch } = require('minimatch')

const { paginate } = require('./github')
const { isExcluded, isSafeAssetName } = require('./utils')

async function listReleaseAssets(octokit, repo, releaseId) {
    try {
        return await paginate(octokit, octokit.rest.repos.listReleaseAssets, {
            ...repo,
            release_id: releaseId,
            per_page: 100,
        })
    } catch (error) {
        throw new Error(
            `Failed to list assets for release ${releaseId}: ${error.message}`,
            { cause: error }
        )
    }
}

async function selectAssets(options) {
    let assets = options.assets
    const now = options.now || Date.now
    const sleep =
        options.sleep ||
        ((milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)))
    const deadline = now() + options.waitForAssets * 1000
    while (shouldWait(assets, options)) {
        if (now() >= deadline) {
            throw new Error(
                `No matching assets for release ${options.releaseId} after waiting ${options.waitForAssets}s. Missing globs: ${missingGlobs(assets, options).join(', ') || '(assets not ready)'}. Available assets: ${assetNames(assets) || '(none)'}`
            )
        }
        core.debug(
            `Waiting for release ${options.releaseId} assets; available: ${assetNames(assets) || '(none)'}`
        )
        const remaining = Math.max(1, deadline - now())
        await sleep(Math.min(options.assetPollInterval * 1000, remaining))
        assets = await listReleaseAssets(
            options.octokit,
            options.repo,
            options.releaseId
        )
    }

    if (!assets.length) {
        throw new Error(`No Assets Found for Release: ${options.releaseId}`)
    }
    const patterns = options.assetGlobs || []
    const selected = assets.filter((asset) => {
        if (typeof asset.name !== 'string') return false
        const name = path.basename(asset.name)
        const included =
            !patterns.length ||
            patterns.some((pattern) => minimatch(name, pattern, { dot: true }))
        return (
            included &&
            !isExcluded(
                name,
                options.excludeGlobs || [],
                options.excludedExtensions || []
            )
        )
    })

    if (!selected.length) {
        throw new Error(
            `No assets matched. Patterns: ${patterns.join(', ') || '(all assets)'}; available assets: ${assetNames(assets) || '(none)'}`
        )
    }
    if (options.requireAllGlobs) {
        const missing = missingGlobs(assets, options)
        if (missing.length) {
            throw new Error(
                `Configured asset globs did not match: ${missing.join(', ')}. Available assets: ${assetNames(assets)}`
            )
        }
    }
    return selected
}

function shouldWait(assets, options) {
    if (!options.waitForAssets) return false
    if (!assets.length) return true
    if (!options.requireAllGlobs || !options.assetGlobs?.length) return false
    return options.assetGlobs.some(
        (pattern) =>
            !assets.some(
                (asset) =>
                    typeof asset.name === 'string' &&
                    minimatch(path.basename(asset.name), pattern, { dot: true })
            )
    )
}

function missingGlobs(assets, options) {
    const patterns = options.assetGlobs || []
    return patterns.filter(
        (pattern) =>
            !assets.some(
                (asset) =>
                    typeof asset.name === 'string' &&
                    minimatch(path.basename(asset.name), pattern, {
                        dot: true,
                    })
            )
    )
}

async function createTempDirectory() {
    const root = process.env.RUNNER_TEMP || os.tmpdir()
    await fs.mkdir(root, { recursive: true })
    return fs.mkdtemp(path.join(root, 'virustotal-action-'))
}

async function downloadAsset(octokit, repo, asset, filePath) {
    if (!isSafeAssetName(asset.name)) {
        throw new Error(
            `Unsafe release asset name rejected: ${JSON.stringify(asset.name)}`
        )
    }
    try {
        const response = await octokit.rest.repos.getReleaseAsset({
            ...repo,
            asset_id: asset.id,
            headers: { Accept: 'application/octet-stream' },
        })
        await fs.writeFile(filePath, Buffer.from(response.data))
    } catch (error) {
        throw new Error(
            `Failed to download release asset ${asset.name} (id ${asset.id}): ${error.message}`,
            { cause: error }
        )
    }
}

function assetNames(assets) {
    return assets.map((asset) => String(asset.name)).join(', ')
}

module.exports = {
    createTempDirectory,
    downloadAsset,
    listReleaseAssets,
    selectAssets,
}
