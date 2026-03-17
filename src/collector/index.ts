/**
 * Collector Index
 */

export {
  EvidenceCollector,
  createEvidenceCollector,
  type CollectionResult,
} from "./evidence-collector.js";

export { FileEvidenceSource, type FileEvidence } from "./sources/file-source.js";
export { CommandEvidenceSource, type CommandEvidence } from "./sources/command-source.js";
export { ToolEvidenceSource } from "./sources/tool-source.js";
export { GitEvidenceSource, type GitDiff, type GitStatus } from "./sources/git-source.js";
