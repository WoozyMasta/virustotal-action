const core = require('@actions/core')

const START = '<!-- virustotal-action:start -->'
const END = '<!-- virustotal-action:end -->'

async function updateReleaseNotes(octokit, repo, release, results) {
    const latest = await octokit.rest.repos.getRelease({
        ...repo,
        release_id: release.id,
    })
    const body = renderReleaseBody(latest.data?.body ?? '', results)
    if (body === (latest.data?.body ?? '')) {
        core.info(
            'Release notes already contain the current VirusTotal results.'
        )
        return
    }
    await octokit.rest.repos.updateRelease({
        ...repo,
        release_id: release.id,
        body,
    })
}

function renderReleaseBody(body, results) {
    body = body ?? ''
    const block = renderManagedBlock(results)
    const marked = new RegExp(
        `${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`
    )
    if (marked.test(body)) return body.replace(marked, block)

    // Migrate the old append-only heading only when it is a standalone level-3 section.
    const legacy =
        /(?:\r?\n)?### VirusTotal analysis results\r?\n[\s\S]*?(?=\r?\n#{1,6}\s|$)/i
    const migrated = body.replace(legacy, '')
    return `${migrated.replace(/\s*$/, '')}\n\n${block}\n`
}

function renderManagedBlock(results) {
    const failed = results.filter((result) => result.status === 'failed')
    const lines = [START, '### VirusTotal analysis results', '']
    for (const result of results) {
        const label = escapeMarkdown(result.name)
        const link = result.analysis_url || result.file_url
        lines.push(`* [${label}](${link || '#'}) — ${result.status}`)
        if (result.error)
            lines.push(`  * Error: ${escapeMarkdown(result.error)}`)
    }
    if (failed.length)
        lines.push('', `Scan completed with ${failed.length} failed asset(s).`)
    lines.push(END)
    return lines.join('\n')
}

function escapeMarkdown(value) {
    return String(value).replace(/([\\`*_[\]{}()<>#+.!|])/g, '\\$1')
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
    END,
    START,
    escapeMarkdown,
    renderManagedBlock,
    renderReleaseBody,
    updateReleaseNotes,
}
