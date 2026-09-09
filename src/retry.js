const { setTimeout: delay } = require('node:timers/promises')

function createRateLimiter(rateLimit, sleep = delay) {
    let nextAvailable = 0
    const interval = rateLimit > 0 ? Math.ceil(60000 / rateLimit) : 0
    return {
        async wait() {
            if (!interval) return
            const now = Date.now()
            const waitMs = Math.max(0, nextAvailable - now)
            nextAvailable = Math.max(now, nextAvailable) + interval
            if (waitMs) await sleep(waitMs)
        },
    }
}

function isRetryable(error) {
    const status = error?.response?.status
    if ([429, 503, 504].includes(status)) return true
    if (status >= 500 && status <= 599) return true
    return (
        !status &&
        [
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'EAI_AGAIN',
            'ECONNABORTED',
        ].includes(error?.code)
    )
}

function retryAfterMs(error) {
    const value = error?.response?.headers?.['retry-after']
    if (!value) return 0
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const date = Date.parse(value)
    return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now())
}

async function requestWithRetry(request, options = {}) {
    const retries = options.retries ?? 4
    const baseDelay = options.retryBaseDelay ?? 5
    const maxDelay = options.retryMaxDelay ?? 60
    const sleep = options.sleep || delay
    let lastError
    let attempts = 0
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        attempts = attempt
        try {
            if (options.limiter) await options.limiter.wait()
            return await request(attempt)
        } catch (error) {
            lastError = error
            if (attempt > retries || !isRetryable(error)) break
            const exponential = Math.min(
                maxDelay * 1000,
                baseDelay * 1000 * 2 ** (attempt - 1)
            )
            const jitter = exponential
                ? Math.floor(Math.random() * Math.max(1, exponential * 0.2))
                : 0
            await sleep(
                Math.min(
                    maxDelay * 1000,
                    Math.max(retryAfterMs(error), exponential + jitter)
                )
            )
        }
    }
    const status = lastError?.response?.status
    const vtError = lastError?.response?.data?.error
    const detail =
        vtError?.code && vtError?.message
            ? `${vtError.code}: ${vtError.message}`
            : lastError?.message || 'request failed'
    const context = options.fileName ? ` for ${options.fileName}` : ''
    throw new Error(
        `VirusTotal request failed${context}: ${status ? `HTTP ${status}, ` : ''}${detail} (attempts: ${attempts})`
    )
}

module.exports = {
    createRateLimiter,
    isRetryable,
    requestWithRetry,
    retryAfterMs,
}
