export type {
  UpdateStatus,
  GitError,
  GitErrorKind,
  GitCommitRef,
  RepoStatus,
  GitLogEntry,
  UpdateReport,
  UpdateReportEntry,
  PullOutcome,
  PullResult,
  ScannedRepo,
  ScanResult,
} from './types.ts'
export { Scheduler, defaultScheduler, type SchedulerOptions } from './scheduler.ts'
export {
  runGit,
  probe,
  toGitError,
  gitSpawnCount,
  resetGitSpawnCount,
  recentCommands,
  clearCommandLog,
  DEFAULT_TIMEOUT_MS,
  type CommandLogEntry,
  type GitResult,
  type RunOptions,
} from './runner.ts'
export { classifyError } from './errors.ts'
export {
  deriveAlternativeRemote,
  fetchRemote,
  fetchWithFallback,
  fallbackTimeoutMs,
  withOtherRouteHint,
  composeFetchFailure,
  FETCH_REFSPEC,
  type FetchAttempt,
  type FetchExecutor,
  type FetchRemoteOptions,
  type FetchRemoteResult,
  type FetchWithFallbackOptions,
  type FetchWithFallbackResult,
  type RemoteTransport,
} from './fetch.ts'
export {
  getRepoStatus,
  getRepoStatuses,
  getRemoteUrl,
  readRemoteUrl,
  deriveStatus,
  parseDirtyCount,
  type StatusOptions,
  type StatusProfile,
  type DeriveInput,
} from './status.ts'
export {
  readRepoStatus,
  readRepoStatuses,
  type ReadStatusOptions,
  type RepoFacts,
  type WorktreeFacts,
  type DivergenceFacts,
  type CommitFacts,
} from './inspect/index.ts'
export { readRepoFacts } from './inspect/via-lib.ts'
export { readWorktree, readDivergence, readUpstreamTipCommit } from './inspect/via-cli.ts'
export {
  getLog,
  parseGitLog,
  analyzeUpdates,
  type LogOptions,
} from './log.ts'
export { scanDirectory, type ScanOptions } from './scan.ts'
export { readReadme, readmeStamp, README_NAMES, type ReadmeResult } from './readme.ts'
export {
  findLogo,
  chooseLogo,
  scoreLogo,
  explicitLogo,
  isPreviewish,
  isImagePath,
  readmeImages,
  normalizeLogoRef,
  LOGO_MAX_BYTES,
  type LogoPick,
  type LogoCandidate,
} from './logo.ts'
export { detectProjectType, TYPE_RULES, type TypeRule } from './project-type.ts'
export { pullRepo, type PullOptions } from './pull.ts'
