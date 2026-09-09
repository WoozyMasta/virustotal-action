const test = require('node:test')
const assert = require('node:assert/strict')

const { integerInput, parseInputs } = require('../src/inputs')

function fakeApi(values = {}, booleans = {}) {
    return {
        getInput: (name) => values[name] || '',
        getBooleanInput: (name) => booleans[name] ?? false,
        warning: () => {},
    }
}

test('parses defaults and zero rate limit', () => {
    const inputs = parseInputs(
        fakeApi(
            { github_token: 'gh', vt_api_key: 'vt', rate_limit: '0' },
            { update_release: true, fail_on_partial: true }
        )
    )
    assert.equal(inputs.rateLimit, 0)
    assert.equal(inputs.source, 'auto')
    assert.equal(inputs.updateRelease, true)
    assert.equal(inputs.failOnPartial, true)
})

test('rejects invalid integer values and retry bounds', () => {
    assert.throws(
        () => integerInput('-1', 'rate_limit', 0, 10),
        /integer between/
    )
    assert.throws(
        () => integerInput('1.5', 'retries', 0, 10),
        /integer between/
    )
    assert.throws(
        () =>
            parseInputs(
                fakeApi(
                    {
                        github_token: 'gh',
                        vt_api_key: 'vt',
                        retry_base_delay: '10',
                        retry_max_delay: '5',
                    },
                    {}
                )
            ),
        /retry_max_delay/
    )
})

test('validates source and release id', () => {
    assert.throws(
        () =>
            parseInputs(
                fakeApi({ github_token: 'gh', vt_api_key: 'vt', source: 'bad' })
            ),
        /Invalid source/
    )
    assert.throws(
        () =>
            parseInputs(
                fakeApi({
                    github_token: 'gh',
                    vt_api_key: 'vt',
                    release_id: 'abc',
                })
            ),
        /Invalid release_id/
    )
})

test('supports deprecated extension alias and v2 globs', () => {
    const inputs = parseInputs(
        fakeApi({
            github_token: 'gh',
            vt_api_key: 'vt',
            file_globs: 'dist/*\nREADME.md',
            asset_globs: '*.zip',
            exclude_globs: '*.sig',
            excluded_extensions: '.log,*.sbom.json',
        })
    )
    assert.deepEqual(inputs.fileGlobs, ['dist/*', 'README.md'])
    assert.deepEqual(inputs.assetGlobs, ['*.zip'])
    assert.deepEqual(inputs.excludeGlobs, ['*.sig'])
    assert.deepEqual(inputs.excludedExtensions, ['.log', '*.sbom.json'])
})
