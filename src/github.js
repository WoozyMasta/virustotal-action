async function resolveRelease(octokit, context, inputs) {
    const payload = context.payload || {}
    const dispatch = payload.client_payload || {}
    const explicitId = inputs.releaseId
    const explicitTag = inputs.releaseTag

    if (explicitId && explicitTag) {
        const [byId, byTag] = await Promise.all([
            getReleaseById(octokit, context.repo, explicitId),
            getReleaseByTag(octokit, context.repo, explicitTag),
        ])
        if (String(byId.id) !== String(byTag.id)) {
            throw new Error(
                `release_id ${explicitId} and release_tag ${explicitTag} resolve to different releases.`
            )
        }
        return byId
    }

    if (explicitId) return getReleaseById(octokit, context.repo, explicitId)
    if (explicitTag) return getReleaseByTag(octokit, context.repo, explicitTag)
    if (payload.release?.id)
        return getReleaseById(octokit, context.repo, payload.release.id)
    if (dispatch.release_id)
        return getReleaseById(octokit, context.repo, dispatch.release_id)
    if (dispatch.release_tag)
        return getReleaseByTag(octokit, context.repo, dispatch.release_tag)

    const sha = inputs.releaseSha || payload.workflow_run?.head_sha
    if (sha) return resolveReleaseBySha(octokit, context.repo, sha)
    return undefined
}

async function getReleaseById(octokit, repo, releaseId) {
    const response = await octokit.rest.repos.getRelease({
        ...repo,
        release_id: Number(releaseId),
    })
    return response.data
}

async function getReleaseByTag(octokit, repo, tag) {
    const response = await octokit.rest.repos.getReleaseByTag({ ...repo, tag })
    return response.data
}

async function resolveReleaseBySha(octokit, repo, sha) {
    const releases = await paginate(octokit, octokit.rest.repos.listReleases, {
        ...repo,
        per_page: 100,
    })
    const matches = []
    for (const release of releases) {
        try {
            const releaseSha = await resolveTagSha(
                octokit,
                repo,
                release.tag_name
            )
            if (releaseSha === sha) matches.push(release)
        } catch {
            // A deleted or inaccessible tag cannot be a valid SHA match.
        }
    }
    if (matches.length > 1) {
        throw new Error(
            `Release SHA ${sha} is ambiguous; matching releases: ${matches.map((item) => item.id).join(', ')}.`
        )
    }
    return matches[0]
}

async function resolveTagSha(octokit, repo, tag) {
    const response = await octokit.rest.git.getRef({
        ...repo,
        ref: `tags/${tag}`,
    })
    if (response.data.object.type !== 'tag') return response.data.object.sha
    const tagObject = await octokit.rest.git.getTag({
        ...repo,
        tag_sha: response.data.object.sha,
    })
    return tagObject.data.object.sha
}

async function paginate(octokit, method, params) {
    if (typeof octokit.paginate === 'function')
        return octokit.paginate(method, params)
    const items = []
    for (let page = 1; ; page += 1) {
        const response = await method({ ...params, page })
        items.push(...(response.data || []))
        if ((response.data || []).length < (params.per_page || 30)) return items
    }
}

module.exports = {
    paginate,
    resolveRelease,
    resolveReleaseBySha,
    resolveTagSha,
}
