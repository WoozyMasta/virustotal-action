const axios = require('axios')
const FormData = require('form-data')
const fs = require('node:fs')

const { requestWithRetry } = require('./retry')
const { sanitizeError } = require('./utils')

const API_BASE = 'https://www.virustotal.com/api/v3'
const LARGE_FILE_SIZE = 32 * 1000 * 1000

class VirusTotalClient {
    constructor(options = {}) {
        this.apiKey = options.apiKey
        this.limiter = options.limiter
        this.requestTimeout = options.requestTimeout ?? 120
        this.retries = options.retries ?? 4
        this.retryBaseDelay = options.retryBaseDelay ?? 5
        this.retryMaxDelay = options.retryMaxDelay ?? 60
        this.waitForAnalysis = options.waitForAnalysis ?? false
        this.analysisTimeout = options.analysisTimeout ?? 300
        this.sleep = options.sleep
        this.http = options.http || axios
    }

    async uploadFile(filePath, fileName) {
        const stats = fs.statSync(filePath)
        const response =
            stats.size < LARGE_FILE_SIZE
                ? await this.uploadToUrl(
                      `${API_BASE}/files`,
                      filePath,
                      fileName
                  )
                : await this.uploadLargeFile(filePath, fileName)
        const analysisId = response?.data?.data?.id
        if (!analysisId)
            throw new Error(
                `VirusTotal returned no analysis ID for ${fileName}.`
            )
        const result = { status: 'submitted', analysisId }
        if (this.waitForAnalysis)
            result.analysis = await this.waitFor(analysisId, fileName)
        return result
    }

    async uploadLargeFile(filePath, fileName) {
        return this.request(async () => {
            // VT upload URLs are single-use; this callback obtains a new URL on every retry.
            const uploadUrl = await this.getUploadUrl(fileName)
            return this.uploadToUrlOnce(uploadUrl, filePath)
        }, fileName)
    }

    async getUploadUrl(fileName) {
        const response = await this.request(
            () =>
                this.http.get(`${API_BASE}/files/upload_url`, {
                    headers: this.headers(),
                    timeout: this.requestTimeout * 1000,
                }),
            fileName
        )
        const url = response?.data?.data
        if (!url)
            throw new Error(
                `VirusTotal returned no upload URL for ${fileName}.`
            )
        return url
    }

    async uploadToUrl(url, filePath, fileName) {
        return this.request(() => this.uploadToUrlOnce(url, filePath), fileName)
    }

    async uploadToUrlOnce(url, filePath) {
        const form = new FormData()
        const stream = fs.createReadStream(filePath)
        form.append('file', stream)
        try {
            return await this.http.post(url, form, {
                headers: { ...this.headers(), ...form.getHeaders() },
                timeout: this.requestTimeout * 1000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
        } finally {
            stream.destroy()
        }
    }

    async request(request, fileName) {
        try {
            return await requestWithRetry(request, {
                limiter: this.limiter,
                retries: this.retries,
                retryBaseDelay: this.retryBaseDelay,
                retryMaxDelay: this.retryMaxDelay,
                sleep: this.sleep,
                fileName,
            })
        } catch (error) {
            throw new Error(sanitizeError(error, this.apiKey), { cause: error })
        }
    }

    async waitFor(analysisId, fileName) {
        const deadline = Date.now() + this.analysisTimeout * 1000
        let response
        do {
            response = await this.request(
                () =>
                    this.http.get(
                        `${API_BASE}/analyses/${encodeURIComponent(analysisId)}`,
                        {
                            headers: this.headers(),
                            timeout: this.requestTimeout * 1000,
                        }
                    ),
                fileName
            )
            const attributes = response?.data?.data?.attributes || {}
            if (['completed', 'failed'].includes(attributes.status)) {
                return {
                    status: attributes.status,
                    stats: attributes.stats || null,
                }
            }
            if (Date.now() >= deadline) {
                throw new Error(
                    `Analysis ${analysisId} did not complete within ${this.analysisTimeout}s.`
                )
            }
            await (
                this.sleep ||
                ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
            )(5000)
        } while (Date.now() < deadline)
        throw new Error(
            `Analysis ${analysisId} did not complete within ${this.analysisTimeout}s.`
        )
    }

    headers() {
        return { accept: 'application/json', 'x-apikey': this.apiKey }
    }
}

async function vtUpload(filePath, apiKey, options = {}) {
    return new VirusTotalClient({ ...options, apiKey }).uploadFile(
        filePath,
        filePath
    )
}

module.exports = VirusTotalClient
module.exports.VirusTotalClient = VirusTotalClient
module.exports.vtUpload = vtUpload
