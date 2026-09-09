const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { requestWithRetry, createRateLimiter } = require('../src/retry')
const { VirusTotalClient } = require('../src/vt')
const {
    renderReleaseBody,
    updateReleaseNotes,
} = require('../src/release-notes')
const { scanFile } = require('../src/index')

function tempFile(size = 3) {
    const file = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-')),
        'file.bin'
    )
    fs.writeFileSync(file, Buffer.alloc(size, 1))
    return file
}

test('uploads a small file and applies rate limiting per request', async () => {
    const file = tempFile()
    let posts = 0
    let waits = 0
    try {
        const client = new VirusTotalClient({
            apiKey: 'secret-key',
            retries: 0,
            limiter: {
                wait: async () => {
                    waits += 1
                },
            },
            http: {
                post: async () => {
                    posts += 1
                    return { data: { data: { id: 'analysis-1' } } }
                },
            },
        })
        const result = await client.uploadFile(file, 'file.bin')
        assert.equal(result.analysisId, 'analysis-1')
        assert.equal(posts, 1)
        assert.equal(waits, 1)
    } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true })
    }
})

test('large upload gets a fresh single-use URL after retry', async () => {
    const file = tempFile(33 * 1000 * 1000)
    let urls = 0
    let posts = 0
    try {
        const client = new VirusTotalClient({
            apiKey: 'secret-key',
            retries: 1,
            retryBaseDelay: 0,
            retryMaxDelay: 0,
            sleep: async () => {},
            limiter: { wait: async () => {} },
            http: {
                get: async () => {
                    urls += 1
                    return { data: { data: `https://upload/${urls}` } }
                },
                post: async () => {
                    posts += 1
                    if (posts === 1)
                        throw Object.assign(new Error('temporary'), {
                            response: { status: 503 },
                        })
                    return { data: { data: { id: 'analysis-2' } } }
                },
            },
        })
        await client.uploadFile(file, 'large.bin')
        assert.equal(urls, 2)
        assert.equal(posts, 2)
    } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true })
    }
})

test('retry behavior distinguishes transient and auth errors', async () => {
    let attempts = 0
    const sleeps = []
    const error = Object.assign(new Error('busy'), {
        response: { status: 429, headers: { 'retry-after': '2' } },
    })
    await requestWithRetry(
        async () => {
            attempts += 1
            if (attempts === 1) throw error
            return 'ok'
        },
        {
            retries: 1,
            retryBaseDelay: 0,
            retryMaxDelay: 10,
            sleep: async (ms) => sleeps.push(ms),
        }
    )
    assert.equal(attempts, 2)
    assert.equal(sleeps[0], 2000)
    await assert.rejects(
        requestWithRetry(
            async () => {
                throw Object.assign(new Error('denied'), {
                    response: { status: 401 },
                })
            },
            { retries: 4, sleep: async () => {} }
        ),
        /HTTP 401.*attempts: 1/
    )
})

test('release note block is idempotent and preserves unrelated text', async () => {
    const results = [
        {
            name: 'a].zip',
            status: 'submitted',
            analysis_url: 'https://vt/a',
            error: null,
        },
    ]
    const once = renderReleaseBody(null, results)
    const twice = renderReleaseBody(once, results)
    assert.equal(twice, once)
    assert.match(once, /a\\\]/)
    assert.equal(
        renderReleaseBody(
            'Intro\n\n### VirusTotal analysis results\n* old\n\n### Notes\nKeep',
            results
        ).includes('### Notes\nKeep'),
        true
    )
})

test('release note update refetches the latest body', async () => {
    let updates = 0
    const octokit = {
        rest: {
            repos: {
                getRelease: async () => ({ data: { id: 3, body: 'latest' } }),
                updateRelease: async (args) => {
                    updates += 1
                    assert.match(args.body, /latest/)
                    return args
                },
            },
        },
    }
    await updateReleaseNotes(
        octokit,
        { owner: 'o', repo: 'r' },
        { id: 3, body: 'stale' },
        [{ name: 'a', status: 'submitted', analysis_url: 'https://vt/a' }]
    )
    assert.equal(updates, 1)
})

test('records a failed file without preventing another scan', async () => {
    const first = tempFile()
    const second = tempFile()
    try {
        let calls = 0
        const vt = {
            uploadFile: async () => {
                calls += 1
                if (calls === 1) throw new Error('temporary failure')
                return { status: 'submitted', analysisId: 'ok' }
            },
        }
        const results = [
            await scanFile(vt, 'first', first),
            await scanFile(vt, 'second', second),
        ]
        assert.equal(results[0].status, 'failed')
        assert.equal(results[1].analysis_id, 'ok')
        assert.equal(calls, 2)
    } finally {
        fs.rmSync(path.dirname(first), { recursive: true, force: true })
        fs.rmSync(path.dirname(second), { recursive: true, force: true })
    }
})

test('rate limiter can be disabled', async () => {
    let slept = false
    const limiter = createRateLimiter(0, async () => {
        slept = true
    })
    await limiter.wait()
    assert.equal(slept, false)
})
