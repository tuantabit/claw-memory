
import { describe, it, expect } from "vitest";
import { ClaimExtractor, ALL_PATTERNS } from "../extractor/index.js";
import { DEFAULT_CONFIG } from "../config.js";

describe("ClaimExtractor", () => {
  const config = DEFAULT_CONFIG;

  describe("patterns", () => {
    it("should have ALL_PATTERNS defined", () => {
      expect(ALL_PATTERNS).toBeDefined();
      expect(Array.isArray(ALL_PATTERNS)).toBe(true);
      expect(ALL_PATTERNS.length).toBeGreaterThan(0);
    });

    it("should extract file_created claim", () => {
      const text = "I have created the file src/index.ts";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "file_created");
      expect(claim).toBeDefined();
    });

    it("should extract file_modified claim", () => {
      const text = "I have updated the file package.json";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "file_modified");
      expect(claim).toBeDefined();
    });

    it("should extract command_executed claim", () => {
      const text = "I ran the command npm install";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "command_executed");
      expect(claim).toBeDefined();
    });

    it("should extract test_passed claim", () => {
      const text = "All tests passed";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "test_passed");
      expect(claim).toBeDefined();
    });

    it("should extract code_added claim", () => {
      const text = "I have added the function processData()";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "code_added");
      expect(claim).toBeDefined();
    });

    it("should extract code_fixed claim", () => {
      const text = "I have fixed the bug in the login function";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "code_fixed");
      expect(claim).toBeDefined();
    });

    it("should extract dependency_added claim", () => {
      const text = "I have installed the package lodash";
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex(text, "session1", null, null);

      expect(claims.length).toBeGreaterThan(0);
      const claim = claims.find(c => c.claim_type === "dependency_added");
      expect(claim).toBeDefined();
    });
  });

  describe("shouldExtract", () => {
    it("should return true for actionable content", () => {
      const extractor = new ClaimExtractor(config);
      expect(extractor.shouldExtract("I created a new file src/index.ts")).toBe(true);
      expect(extractor.shouldExtract("I updated the configuration file")).toBe(true);
      expect(extractor.shouldExtract("I fixed the bug in the code")).toBe(true);
    });

    it("should return false for simple responses", () => {
      const extractor = new ClaimExtractor(config);
      expect(extractor.shouldExtract("Hello!")).toBe(false);
      expect(extractor.shouldExtract("Sure, I can help.")).toBe(false);
      expect(extractor.shouldExtract("What?")).toBe(false);
    });
  });

  describe("extractWithRegex", () => {
    it("should return array of claims", () => {
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex("I created src/test.ts", "session1", null, null);

      expect(Array.isArray(claims)).toBe(true);
    });

    it("should include required fields in claims", () => {
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex("I have created the file src/utils.ts", "session1", "task1", "response1");

      if (claims.length > 0) {
        const claim = claims[0];
        expect(claim).toHaveProperty("claim_id");
        expect(claim).toHaveProperty("claim_type");
        expect(claim).toHaveProperty("original_text");
        expect(claim).toHaveProperty("entities");
        expect(claim).toHaveProperty("confidence");
        expect(claim).toHaveProperty("session_id");
      }
    });

    it("should extract file entity", () => {
      const extractor = new ClaimExtractor(config);
      const claims = extractor.extractWithRegex("I have created the file src/components/Button.tsx", "session1", null, null);

      const fileClaim = claims.find(c => c.claim_type === "file_created");
      expect(fileClaim).toBeDefined();
      if (fileClaim) {
        const fileEntity = fileClaim.entities.find(e => e.type === "file");
        expect(fileEntity).toBeDefined();
        expect(fileEntity?.value).toContain("Button.tsx");
      }
    });
  });

  describe("extract (async)", () => {
    it("should return ExtractionResult structure", async () => {
      const extractor = new ClaimExtractor(config);
      const result = await extractor.extract("I created src/test.ts", "session1", null, null);

      expect(result).toHaveProperty("claims");
      expect(result).toHaveProperty("text_length");
      expect(result).toHaveProperty("processing_time_ms");
      expect(result).toHaveProperty("method");
      expect(Array.isArray(result.claims)).toBe(true);
    });

    it("should use regex method when LLM is disabled", async () => {
      const configNoLLM = { ...config, enableLLM: false };
      const extractor = new ClaimExtractor(configNoLLM);
      const result = await extractor.extract("I created src/test.ts", "session1", null, null);

      expect(result.method).toBe("regex");
    });
  });
});
