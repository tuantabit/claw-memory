
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Evidence, Claim, EvidenceSource } from "../../types.js";
import { nanoid } from "nanoid";

const execAsync = promisify(exec);

export interface GitDiff {
  file: string;
  additions: number;
  deletions: number;
  changes: string[];
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export class GitEvidenceSource {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Collect evidence for a claim from git
   */
  async collectForClaim(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      if (!(await this.isGitRepo())) {
        return evidence;
      }

      const filePaths = claim.entities
        .filter((e) => e.type === "file")
        .map((e) => e.normalized ?? e.value);

      for (const filePath of filePaths) {
        const fileEvidence = await this.collectForFile(claim, filePath);
        if (fileEvidence) {
          evidence.push(fileEvidence);
        }
      }

      if (this.isCodeClaim(claim.claim_type)) {
        const diffEvidence = await this.collectRecentDiffs(claim);
        evidence.push(...diffEvidence);
      }
    } catch (error) {
      console.debug("[veridic-claw] Git evidence collection failed:", error);
    }

    return evidence;
  }

  /**
   * Collect evidence for a specific file from git
   */
  async collectForFile(claim: Claim, filePath: string): Promise<Evidence | null> {
    try {
      const status = await this.getFileStatus(filePath);
      const diff = await this.getFileDiff(filePath);

      const supports = this.evaluateGitSupport(claim, status, diff);

      return {
        evidence_id: nanoid(),
        claim_id: claim.claim_id,
        source: "git_diff" as EvidenceSource,
        source_ref: filePath,
        data: {
          file: filePath,
          status,
          diff_summary: diff ? {
            additions: diff.additions,
            deletions: diff.deletions,
            has_changes: diff.changes.length > 0,
          } : null,
        },
        supports_claim: supports,
        confidence: this.calculateGitConfidence(claim, status, diff),
        collected_at: new Date(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Collect evidence from recent diffs
   */
  async collectRecentDiffs(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const { stdout } = await execAsync(
        "git diff --stat HEAD~1 2>/dev/null || git diff --stat",
        { cwd: this.cwd }
      );

      const changedFiles = this.parseGitDiffStat(stdout);

      for (const file of changedFiles) {
        const isRelevant = claim.entities.some(
          (e) => file.includes(e.value) || e.value.includes(file)
        );

        if (isRelevant) {
          const diff = await this.getFileDiff(file);

          evidence.push({
            evidence_id: nanoid(),
            claim_id: claim.claim_id,
            source: "git_diff" as EvidenceSource,
            source_ref: file,
            data: {
              file,
              in_recent_commit: true,
              diff_summary: diff ? {
                additions: diff.additions,
                deletions: diff.deletions,
              } : null,
            },
            supports_claim: true,
            confidence: 0.8,
            collected_at: new Date(),
          });
        }
      }
    } catch {
    }

    return evidence;
  }

  /**
   * Check if directory is a git repo
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await execAsync("git rev-parse --git-dir", { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get git status for a file
   */
  async getFileStatus(filePath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git status --porcelain "${filePath}"`,
        { cwd: this.cwd }
      );

      const status = stdout.trim();
      if (!status) return "unchanged";

      const code = status.slice(0, 2);
      if (code.includes("A")) return "added";
      if (code.includes("M")) return "modified";
      if (code.includes("D")) return "deleted";
      if (code.includes("?")) return "untracked";

      return "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Get git diff for a file
   */
  async getFileDiff(filePath: string): Promise<GitDiff | null> {
    try {
      const { stdout } = await execAsync(
        `git diff --numstat "${filePath}"`,
        { cwd: this.cwd }
      );

      if (!stdout.trim()) return null;

      const [additions, deletions] = stdout.trim().split(/\s+/).map(Number);

      const { stdout: diffContent } = await execAsync(
        `git diff "${filePath}" | head -50`,
        { cwd: this.cwd }
      );

      return {
        file: filePath,
        additions: additions ?? 0,
        deletions: deletions ?? 0,
        changes: diffContent.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get overall git status
   */
  async getStatus(): Promise<GitStatus> {
    try {
      const { stdout } = await execAsync("git status --porcelain", {
        cwd: this.cwd,
      });

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;

        const status = line.slice(0, 2);
        const file = line.slice(3).trim();

        if (status[0] !== " " && status[0] !== "?") {
          staged.push(file);
        }
        if (status[1] !== " " && status[1] !== "?") {
          unstaged.push(file);
        }
        if (status === "??") {
          untracked.push(file);
        }
      }

      return { staged, unstaged, untracked };
    } catch {
      return { staged: [], unstaged: [], untracked: [] };
    }
  }

  /**
   * Parse git diff --stat output
   */
  private parseGitDiffStat(output: string): string[] {
    const files: string[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.match(/^\s*(.+?)\s+\|\s+\d+/);
      if (match) {
        files.push(match[1].trim());
      }
    }

    return files;
  }

  /**
   * Check if claim type is code-related
   */
  private isCodeClaim(claimType: string): boolean {
    return [
      "file_created",
      "file_modified",
      "file_deleted",
      "code_added",
      "code_removed",
      "code_fixed",
    ].includes(claimType);
  }

  /**
   * Evaluate if git status supports claim
   */
  private evaluateGitSupport(
    claim: Claim,
    status: string,
    diff: GitDiff | null
  ): boolean {
    switch (claim.claim_type) {
      case "file_created":
        return status === "added" || status === "untracked";

      case "file_modified":
      case "code_fixed":
        return status === "modified" && (diff?.changes.length ?? 0) > 0;

      case "file_deleted":
        return status === "deleted";

      case "code_added":
        return (diff?.additions ?? 0) > 0;

      case "code_removed":
        return (diff?.deletions ?? 0) > 0;

      default:
        return status !== "unchanged";
    }
  }

  /**
   * Calculate confidence for git evidence
   */
  private calculateGitConfidence(
    claim: Claim,
    status: string,
    diff: GitDiff | null
  ): number {
    let confidence = 0.6;

    if (this.evaluateGitSupport(claim, status, diff)) {
      confidence += 0.2;
    }

    if (diff && diff.changes.length > 0) {
      confidence += 0.1;
    }

    if (diff && (diff.additions + diff.deletions) > 5) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }
}
