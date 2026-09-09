const core = require('@actions/core')
const github = require('@actions/github')
const glob = require('@actions/glob')
const fs = require('node:fs/promises')
const path = require('node:path')

const { parseInputs } = require('./inputs')
const { resolveRelease } = require('./github')
const {
    createTempDirectory,
    downloadAsset,
    listReleaseAssets,
    selectAssets,
} = require('./assets')
const { createRateLimiter } = require('./retry')
const { VirusTotalClient } = require('./vt')
const { updateReleaseNotes } = require('./release-notes')
const { hashFile, isExcluded, sanitizeError } = require('./utils')

async function run() {
    try {
        const inputs = parseInputs()
        const octokit = github.getOctokit(inputs.githubToken)
        const release =
            inputs.source === 'files'
                ? undefined
                : await resolveRelease(octokit, github.context, inputs)
        const useRelease =
            inputs.source === 'release' || (inputs.source === 'auto' && release)

        if (inputs.source === 'release' && !release) {
            throw new Error(
                'source=release requires a resolvable release selector.'
            )
        }

        const limiter = createRateLimiter(inputs.rateLimit)
        const vt = new VirusTotalClient({
            apiKey: inputs.vtApiKey,
            limiter,
            requestTimeout: inputs.requestTimeout,
            retries: inputs.retries,
            retryBaseDelay: inputs.retryBaseDelay,
            retryMaxDelay: inputs.retryMaxDelay,
            waitForAnalysis: inputs.waitForAnalysis,
            analysisTimeout: inputs.analysisTimeout,
        })

        let results
        if (useRelease) {
            core.startGroup(`Processing release ${release.id}`)
            results = await processRelease(inputs, octokit, release, vt)
            core.endGroup()
        } else if (inputs.fileGlobs.length) {
            core.startGroup('Processing local files')
            results = await processFiles(inputs, vt)
            core.endGroup()
        } else {
            throw new Error(
                'No release was resolved and no file_globs were provided. Set a release selector or configure local files.'
            )
        }

        setOutputs(results, release?.id)
        await writeSummary(inputs, results, release)

        if (release && inputs.updateRelease) {
            await updateReleaseNotes(
                octokit,
                github.context.repo,
                release,
                results
            )
        } else if (inputs.updateRelease) {
            core.info(
                'Skipping release note update because no release was selected.'
            )
        }

        const failed = results.filter((result) => result.status === 'failed')
        if (failed.length && inputs.failOnPartial) {
            core.setFailed(
                `${failed.length} of ${results.length} file(s) failed to submit.`
            )
        } else if (failed.length) {
            core.warning(
                `${failed.length} of ${results.length} file(s) failed to submit.`
            )
        }
    } catch (error) {
        core.setFailed(sanitizeError(error))
    }
}

async function processRelease(inputs, octokit, release, vt) {
    const assets = await listReleaseAssets(
        octokit,
        github.context.repo,
        release.id
    )
    const selected = await selectAssets({
        octokit,
        repo: github.context.repo,
        releaseId: release.id,
        assets,
        assetGlobs: inputs.assetGlobs.length
            ? inputs.assetGlobs
            : inputs.fileGlobs,
        excludeGlobs: inputs.excludeGlobs,
        excludedExtensions: inputs.excludedExtensions,
        requireAllGlobs: inputs.requireAllGlobs,
        waitForAssets: inputs.waitForAssets,
        assetPollInterval: inputs.assetPollInterval,
    })

    const tempDirectory = await createTempDirectory()
    try {
        const results = []
        for (const asset of selected) {
            const filePath = path.join(tempDirectory, asset.name)
            try {
                await downloadAsset(
                    octokit,
                    github.context.repo,
                    asset,
                    filePath
                )
                results.push(await scanFile(vt, asset.name, filePath))
            } catch (error) {
                results.push(await failedResult(asset.name, filePath, error))
            }
        }
        return results
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true })
    }
}

async function processFiles(inputs, vt) {
    const globber = await glob.create(inputs.fileGlobs.join('\n'), {
        matchDirectories: false,
    })
    const files = (await globber.glob()).filter(
        (file) =>
            !isExcluded(
                path.basename(file),
                inputs.excludeGlobs,
                inputs.excludedExtensions
            )
    )

    if (!files.length) {
        throw new Error(
            `No files matched file_globs: ${inputs.fileGlobs.join(', ')}`
        )
    }

    const results = []
    for (const file of files) {
        const name = path.basename(file)
        try {
            results.push(await scanFile(vt, name, file))
        } catch (error) {
            results.push(await failedResult(name, file, error))
        }
    }
    return results
}

async function scanFile(vt, name, filePath) {
    const sha256 = await hashFile(filePath)
    const fileUrl = `https://www.virustotal.com/gui/file/${sha256}`
    try {
        const submission = await vt.uploadFile(filePath, name)
        const analysisId = submission.analysisId
        const result = {
            name,
            sha256,
            status: submission.status,
            analysis_id: analysisId,
            analysis_url: analysisId
                ? `https://www.virustotal.com/gui/file-analysis/${analysisId}`
                : null,
            file_url: fileUrl,
            error: null,
        }
        if (submission.analysis) {
            result.status = submission.analysis.status
            result.stats = submission.analysis.stats || null
        }
        return result
    } catch (error) {
        return {
            name,
            sha256,
            status: 'failed',
            analysis_id: null,
            analysis_url: null,
            file_url: fileUrl,
            error: sanitizeError(error),
        }
    }
}

async function failedResult(name, filePath, error) {
    let sha256 = null
    try {
        sha256 = await hashFile(filePath)
    } catch {
        // The download may have failed before a file was created.
    }
    return {
        name,
        sha256,
        status: 'failed',
        analysis_id: null,
        analysis_url: null,
        file_url: sha256
            ? `https://www.virustotal.com/gui/file/${sha256}`
            : null,
        error: sanitizeError(error),
    }
}

function setOutputs(results, releaseId) {
    const successful = results.filter((result) => result.analysis_id)
    core.setOutput(
        'results',
        successful
            .map((result) => `${result.name}/${result.analysis_id}`)
            .join(',')
    )
    core.setOutput('json', JSON.stringify(results))
    core.setOutput('release_id', releaseId ? String(releaseId) : '')
    core.setOutput('processed_count', String(results.length))
    core.setOutput('success_count', String(successful.length))
    core.setOutput(
        'failed_count',
        String(results.filter((result) => result.status === 'failed').length)
    )
}

async function writeSummary(inputs, results, release) {
    if (!inputs.summary || !core.summary) return
    core.summary.addHeading('VirusTotal analysis results')
    if (release)
        core.summary.addRaw(`Release: ${release.tag_name || release.id}`)
    core.summary.addTable([
        [
            { data: 'File', header: true },
            { data: 'Status', header: true },
            { data: 'Analysis', header: true },
        ],
        ...results.map((result) => [
            result.name,
            result.status,
            result.analysis_url
                ? `[link](${result.analysis_url})`
                : result.error || '-',
        ]),
    ])
    await core.summary.write()
}

if (require.main === module) {
    run()
}

module.exports = {
    failedResult,
    processFiles,
    processRelease,
    run,
    scanFile,
    setOutputs,
}
