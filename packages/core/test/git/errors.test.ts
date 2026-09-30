import { describe, expect, it } from 'vitest'
import { classifyError } from '../../src/git/errors.ts'
import { deriveStatus } from '../../src/git/status.ts'

const base = { code: 1, stdout: '', timedOut: false, message: 'git 失败了' }

describe('classifyError', () => {
  it('认证失败 → auth，并提示用户自己去认证', () => {
    const err = classifyError({
      ...base,
      stderr: 'fatal: could not read Username for \'https://github.com\': terminal prompts disabled',
    })
    expect(err.kind).toBe('auth')
    expect(err.message).toContain('gh auth login')
  })

  it('网络问题 → network', () => {
    const err = classifyError({
      ...base,
      stderr: "fatal: unable to access 'https://example.com/': Could not resolve host: example.com",
    })
    expect(err.kind).toBe('network')
  })

  it('锁文件残留 → locked，并告诉用户删哪个文件', () => {
    const err = classifyError({
      ...base,
      stderr: "fatal: Unable to create 'D:/repo/.git/index.lock': File exists.",
    })
    expect(err.kind).toBe('locked')
    expect(err.message).toContain('index.lock')
  })

  it('超时 → timeout', () => {
    const err = classifyError({ ...base, timedOut: true, stderr: '' })
    expect(err.kind).toBe('timeout')
  })

  it('认不出来时保留原始信息，不吞掉', () => {
    const err = classifyError({ ...base, stderr: 'fatal: something odd happened' })
    expect(err.kind).toBe('unknown')
    expect(err.message).toContain('something odd happened')
    expect(err.raw).toContain('something odd happened')
  })
})

describe('deriveStatus 优先级', () => {
  const base = {
    isRepo: true,
    dirty: false,
    detached: false,
    hasCommits: true,
    upstream: true,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    hasRemote: true,
  }

  it('脏工作区盖过「没有远程」', () => {
    expect(deriveStatus({ ...base, dirty: true, upstream: false, hasRemote: false })).toBe('dirty')
  })

  it('detached 盖过「没有上游」', () => {
    expect(deriveStatus({ ...base, detached: true, upstream: false })).toBe('detached')
  })

  it('有远程但没上游 vs 干脆没远程', () => {
    expect(deriveStatus({ ...base, upstream: false, hasRemote: true })).toBe('no_upstream')
    expect(deriveStatus({ ...base, upstream: false, hasRemote: false })).toBe('no_remote')
  })

  it('空仓库先于一切', () => {
    expect(deriveStatus({ ...base, hasCommits: false, dirty: true })).toBe('no_commits')
  })

  it('ahead / behind / diverged', () => {
    expect(deriveStatus({ ...base, ahead: 2 })).toBe('ahead')
    expect(deriveStatus({ ...base, behind: 3 })).toBe('behind')
    expect(deriveStatus({ ...base, ahead: 1, behind: 1 })).toBe('diverged')
    expect(deriveStatus(base)).toBe('up_to_date')
  })
})
