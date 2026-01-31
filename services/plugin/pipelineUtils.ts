import crypto from 'crypto'
import type { PipelineStep, EventPipeline } from './types.js'

export const generatePipelineId = (): string => {
  return `pipeline-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

export const shouldRunStep = (
  step: PipelineStep,
  previousStatus: 'SUCCEEDED' | 'FAILED' | null
): boolean => {
  const condition = step.condition || 'ALWAYS'

  if (condition === 'ALWAYS') {
    return true
  }

  if (condition === 'PREVIOUS_SUCCEEDED') {
    return previousStatus === 'SUCCEEDED'
  }

  if (condition === 'PREVIOUS_FAILED') {
    return previousStatus === 'FAILED'
  }

  return true
}

export const mergeSettings = (defaults: any, overrides: any): any => {
  if (overrides === null || overrides === undefined) {
    return defaults
  }

  if (Array.isArray(defaults) && Array.isArray(overrides)) {
    return overrides
  }

  if (typeof defaults === 'object' && defaults !== null && typeof overrides === 'object' && overrides !== null) {
    const output: Record<string, any> = { ...defaults }
    Object.keys(overrides).forEach(key => {
      output[key] = mergeSettings(defaults ? defaults[key] : undefined, overrides[key])
    })
    return output
  }

  return overrides
}

export const getAttachmentUrls = (downloadableFile: any): string[] => {
  const urls: string[] = []
  if (downloadableFile.url) {
    urls.push(downloadableFile.url)
  }
  return urls
}

export const parseStoredPipelines = (stored: any): EventPipeline[] => {
  if (!stored) return []
  if (typeof stored === 'string') {
    try {
      return JSON.parse(stored)
    } catch {
      return []
    }
  }
  return Array.isArray(stored) ? stored : []
}
