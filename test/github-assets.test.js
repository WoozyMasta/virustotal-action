const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { resolveRelease } = require('../src/github')
const {
    downloadAsset,
    listReleaseAssets,
    selectAssets,
} = require('../src/assets')

const repo = { owner: 'o', repo: 'r' }

test('resolves release selectors in precedence order', async () => {
    const calls = []
    const octokit = {
        rest: {
            repos: {
                getRelease: async (args) => {
                    calls.push(['id', args.release_id])
                    return { data: { id: 12 } }
                },
                getReleaseByTag: async (args) => {
                    calls.push(['tag', args.tag])
                    return { data: { id: 12 } }
                },
            },
        },
    }
    const result = await resolveRelease(
        octokit,
        { payload: { release: { id: 99 } } },
        {
            releaseId: '12',
            releaseTag: '',
            releaseSha: '',
        }
    )
    assert.equal(result.id, 12)
    assert.deepEqual(calls, [['id', 12]])
})

test('resolves repository dispatch selectors', async () => {
    const calls = []
    const octokit = {
        rest: {
            repos: {
                getRelease: async ({ release_id }) => {
                    calls.push(['id', release_id])
                    return { data: { id: release_id } }
                },
                getReleaseByTag: async ({ tag }) => {
                    calls.push(['tag', tag])
                    return { data: { id: 20, tag_name: tag } }
                },
            },
        },
    }
    await resolveRelease(
        octokit,
        { payload: { client_payload: { release_id: '18' } } },
        { releaseId: '', releaseTag: '', releaseSha: '' }
    )
    await resolveRelease(
        octokit,
        { payload: { client_payload: { release_tag: 'v2.0.0' } } },
        { releaseId: '', releaseTag: '', releaseSha: '' }
    )
    assert.deepEqual(calls, [
        ['id', 18],
        ['tag', 'v2.0.0'],
    ])
})

test('rejects conflicting explicit release selectors', async () => {
    const octokit = {
        rest: {
            repos: {
                getRelease: async () => ({ data: { id: 1 } }),
                getReleaseByTag: async () => ({ data: { id: 2 } }),
            },
        },
    }
    await assert.rejects(
        resolveRelease(
            octokit,
            { payload: {} },
            { releaseId: '1', releaseTag: 'v2', releaseSha: '' }
        ),
        /different releases/
    )
})

test('resolves annotated tag and rejects ambiguous SHA', async () => {
    const octokit = {
        rest: {
            repos: {
                listReleases: async () => ({
                    data: [
                        { id: 1, tag_name: 'v1' },
                        { id: 2, tag_name: 'v2' },
                    ],
                }),
            },
            git: {
                getRef: async ({ ref }) => ({
                    data: {
                        object: {
                            type: 'tag',
                            sha: ref.endsWith('v1') ? 'tag1' : 'tag2',
                        },
                    },
                }),
                getTag: async ({ tag_sha }) => ({
                    data: { object: { sha: 'commit' } },
                }),
            },
        },
        paginate: async () => [
            { id: 1, tag_name: 'v1' },
            { id: 2, tag_name: 'v2' },
        ],
    }
    await assert.rejects(
        resolveRelease(
            octokit,
            { payload: {} },
            { releaseId: '', releaseTag: '', releaseSha: 'commit' }
        ),
        /ambiguous/
    )
})

test('paginates all release assets', async () => {
    const pages = [
        Array.from({ length: 100 }, (_, index) => ({
            id: index,
            name: `a-${index}`,
        })),
        [{ id: 100, name: 'a-100' }],
    ]
    const octokit = {
        rest: {
            repos: {
                listReleaseAssets: async ({ page }) => ({
                    data: pages[page - 1] || [],
                }),
            },
        },
    }
    const assets = await listReleaseAssets(octokit, repo, 1)
    assert.equal(assets.length, 101)
})

test('waits for assets and applies include/exclude globs', async () => {
    let current = []
    let clock = 0
    const octokit = {
        rest: { repos: { listReleaseAssets: async () => ({ data: current }) } },
    }
    const promise = selectAssets({
        octokit,
        repo,
        releaseId: 1,
        assets: [],
        assetGlobs: ['*.zip'],
        excludeGlobs: ['*.sig'],
        excludedExtensions: [],
        requireAllGlobs: true,
        waitForAssets: 10,
        assetPollInterval: 1,
        now: () => clock,
        sleep: async () => {
            clock = 1
            current = [
                { id: 1, name: 'app.zip' },
                { id: 2, name: 'app.sig' },
            ]
        },
    })
    assert.deepEqual(
        (await promise).map((asset) => asset.name),
        ['app.zip']
    )
})

test('fails clearly when no assets are available or selected', async () => {
    await assert.rejects(
        selectAssets({ releaseId: 7, assets: [], waitForAssets: 0 }),
        /No Assets Found/
    )
    await assert.rejects(
        selectAssets({
            releaseId: 7,
            assets: [{ name: 'app.txt' }],
            assetGlobs: ['*.zip'],
            excludeGlobs: [],
            excludedExtensions: [],
            waitForAssets: 0,
        }),
        /No assets matched.*\*\.zip.*app\.txt/
    )
})

test('rejects traversal and writes safe asset names', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-test-'))
    try {
        await assert.rejects(
            downloadAsset(
                {
                    rest: {
                        repos: { getReleaseAsset: async () => ({ data: 'x' }) },
                    },
                },
                repo,
                { id: 1, name: '../bad' },
                path.join(temp, 'bad')
            ),
            /Unsafe/
        )
        await downloadAsset(
            {
                rest: {
                    repos: {
                        getReleaseAsset: async () => ({
                            data: Buffer.from('ok'),
                        }),
                    },
                },
            },
            repo,
            { id: 1, name: 'good.bin' },
            path.join(temp, 'good.bin')
        )
        assert.equal(
            await fs.readFile(path.join(temp, 'good.bin'), 'utf8'),
            'ok'
        )
    } finally {
        await fs.rm(temp, { recursive: true, force: true })
    }
})
