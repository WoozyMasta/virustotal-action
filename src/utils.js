const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(filePath)
        stream.on('error', reject)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

function isSafeAssetName(name) {
    return (
        typeof name === 'string' &&
        name.length > 0 &&
        name === path.posix.basename(name) &&
        name === path.win32.basename(name) &&
        !Array.from(name).some((char) => {
            const code = char.charCodeAt(0)
            return code < 32 || code === 127
        })
    )
}

function isExcluded(name, excludeGlobs, excludedExtensions) {
    const { minimatch } = require('minimatch')
    if (excludeGlobs.some((pattern) => minimatch(name, pattern, { dot: true })))
        return true
    return excludedExtensions.some((pattern) => {
        if (
            ['*', '?', '[', ']', '{', '}'].some((char) =>
                pattern.includes(char)
            )
        ) {
            return minimatch(name, pattern, { dot: true })
        }
        const extension = pattern.startsWith('.') ? pattern : `.${pattern}`
        return path.extname(name) === extension
    })
}

function sanitizeError(error, secret) {
    let message = error instanceof Error ? error.message : String(error)
    if (secret) message = message.split(secret).join('[REDACTED]')
    return message.replace(
        /(x-apikey|authorization|api[-_ ]?key)\s*[:=]\s*[^,\s}]+/gi,
        '$1=[REDACTED]'
    )
}

module.exports = { hashFile, isExcluded, isSafeAssetName, sanitizeError }
