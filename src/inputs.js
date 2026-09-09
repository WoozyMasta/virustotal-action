const core = require('@actions/core')

function parseInputs(api = core) {
    const getInput = (name) => api.getInput(name, { required: false }).trim()
    const githubToken = api.getInput('github_token', { required: true }).trim()
    const vtApiKey = api.getInput('vt_api_key', { required: true }).trim()
    const source = getInput('source') || 'auto'
    if (!['auto', 'release', 'files'].includes(source)) {
        throw new Error(
            `Invalid source "${source}". Expected auto, release, or files.`
        )
    }

    const fileGlobs = splitPatterns(getInput('file_globs'))
    const assetGlobs = splitPatterns(getInput('asset_globs'))
    const excludeGlobs = splitPatterns(getInput('exclude_globs'))
    const excludedExtensions = splitPatterns(
        getInput('excluded_extensions'),
        /[,\n]/
    )
    if (excludedExtensions.length && api.warning) {
        api.warning(
            'excluded_extensions is deprecated; use exclude_globs for new workflows.'
        )
    }

    const releaseId = getInput('release_id')
    if (releaseId && (!/^\d+$/.test(releaseId) || Number(releaseId) < 1)) {
        throw new Error(
            `Invalid release_id "${releaseId}". It must be a positive numeric ID.`
        )
    }
    const releaseSha = getInput('release_sha')
    if (releaseSha && !/^[0-9a-f]{7,64}$/i.test(releaseSha)) {
        throw new Error(
            `Invalid release_sha "${releaseSha}". It must be a hexadecimal commit SHA.`
        )
    }

    const rateLimit = integerInput(
        getInput('rate_limit') || '4',
        'rate_limit',
        0,
        10000
    )
    const waitForAssets = integerInput(
        getInput('wait_for_assets') || '60',
        'wait_for_assets',
        0,
        86400
    )
    const assetPollInterval = integerInput(
        getInput('asset_poll_interval') || '5',
        'asset_poll_interval',
        1,
        3600
    )
    const requestTimeout = integerInput(
        getInput('request_timeout') || '120',
        'request_timeout',
        1,
        3600
    )
    const retries = integerInput(getInput('retries') || '4', 'retries', 0, 10)
    const retryBaseDelay = integerInput(
        getInput('retry_base_delay') || '5',
        'retry_base_delay',
        0,
        3600
    )
    const retryMaxDelay = integerInput(
        getInput('retry_max_delay') || '60',
        'retry_max_delay',
        0,
        3600
    )
    const analysisTimeout = integerInput(
        getInput('analysis_timeout') || '300',
        'analysis_timeout',
        1,
        86400
    )
    if (retryMaxDelay < retryBaseDelay) {
        throw new Error(
            'retry_max_delay must be greater than or equal to retry_base_delay.'
        )
    }

    return {
        githubToken,
        vtApiKey,
        source,
        fileGlobs,
        assetGlobs,
        excludeGlobs,
        excludedExtensions,
        releaseId,
        releaseTag: getInput('release_tag'),
        releaseSha,
        rateLimit,
        updateRelease: api.getBooleanInput('update_release', {
            required: false,
        }),
        waitForAssets,
        assetPollInterval,
        requestTimeout,
        retries,
        retryBaseDelay,
        retryMaxDelay,
        requireAllGlobs: api.getBooleanInput('require_all_globs', {
            required: false,
        }),
        failOnPartial: api.getBooleanInput('fail_on_partial', {
            required: false,
        }),
        summary: api.getBooleanInput('summary', { required: false }),
        waitForAnalysis: api.getBooleanInput('wait_for_analysis', {
            required: false,
        }),
        analysisTimeout,
    }
}

function splitPatterns(value, separator = /[\n,]/) {
    return value
        .split(separator)
        .map((item) => item.trim())
        .filter(Boolean)
}

function integerInput(value, name, min, max) {
    if (!/^\d+$/.test(value)) {
        throw new Error(
            `${name} must be an integer between ${min} and ${max}. Got "${value}".`
        )
    }
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(
            `${name} must be an integer between ${min} and ${max}. Got "${value}".`
        )
    }
    return parsed
}

module.exports = { integerInput, parseInputs, splitPatterns }
