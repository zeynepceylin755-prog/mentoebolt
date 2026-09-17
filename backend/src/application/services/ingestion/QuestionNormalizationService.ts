import { NormalizationError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface NormalizationResult {
  normalizedText: string;
  warnings: string[];
  parsingConfidence: number;
}

/**
 * QuestionNormalizationService — Phase 5E
 *
 * Normalizes OCR-extracted text before AI analysis.
 * 
 * Key principles:
 * - Does NOT change mathematical meaning
 * - Generates warnings for ambiguous symbols
 * - Preserves semantic content
 * - Only performs safe, deterministic transformations
 */
export class QuestionNormalizationService {
  /**
   * Normalize OCR-extracted text.
   * 
   * Transformations:
   * - Whitespace cleanup
   * - Line joining
   * - OCR artifact removal
   * - Mathematical symbol canonicalization (safe only)
   * 
   * Does NOT:
   * - Change variable names (x → y is forbidden)
   * - Change operators (* → - is forbidden)
   * - Change functions (sin → cos is forbidden)
   */
  async normalize(ocrText: string, ocrWarnings: string[] = []): Promise<NormalizationResult> {
    if (!ocrText || typeof ocrText !== 'string') {
      throw new NormalizationError('OCR text must be a non-empty string');
    }

    const warnings: string[] = [...ocrWarnings];
    let normalized = ocrText;

    // Step 1: Whitespace normalization
    normalized = this.normalizeWhitespace(normalized);

    // Step 2: Remove common OCR artifacts
    normalized = this.removeOcrArtifacts(normalized);

    // Step 3: Join broken lines (heuristic: lowercase followed by uppercase)
    normalized = this.joinBrokenLines(normalized);

    // Step 4: Safe mathematical symbol canonicalization
    const symbolResult = this.canonicalizeMathSymbols(normalized);
    normalized = symbolResult.text;
    warnings.push(...symbolResult.warnings);

    // Step 5: Check for ambiguous mathematical symbols
    warnings.push(...this.detectAmbiguousSymbols(normalized));

    // Calculate parsing confidence based on warnings
    const parsingConfidence = this.calculateParsingConfidence(warnings, normalized);

    logger.debug({
      inputLength: ocrText.length,
      outputLength: normalized.length,
      warningsCount: warnings.length,
      parsingConfidence,
    }, 'Question normalization completed');

    return {
      normalizedText: normalized,
      warnings,
      parsingConfidence,
    };
  }

  /**
   * Normalize whitespace: collapse multiple spaces, trim edges.
   */
  private normalizeWhitespace(text: string): string {
    return text
      .replace(/[ \t]+/g, ' ')  // Collapse spaces/tabs to single space
      .replace(/\n\s+/g, '\n')   // Remove leading spaces after newline
      .replace(/\s+\n/g, '\n')   // Remove trailing spaces before newline
      .trim();
  }

  /**
   * Remove common OCR artifacts that don't affect meaning.
   */
  private removeOcrArtifacts(text: string): string {
    // Remove common noise patterns
    return text
      .replace(/[|_]{3,}/g, '')  // Remove long separator lines
      .replace(/•/g, '')          // Remove bullet points
      .replace(/\[PAGE\]/gi, '')  // Remove page markers
      .replace(/\[IMAGE\]/gi, ''); // Remove image markers
  }

  /**
   * Join lines that were incorrectly split by OCR.
   * Heuristic: lowercase letter followed by uppercase letter suggests a split.
   */
  private joinBrokenLines(text: string): string {
    // Pattern: lowercase letter, newline, uppercase letter
    return text.replace(/([a-zçğıöşü])\n([A-ZÇĞİÖŞÜ])/g, '$1 $2');
  }

  /**
   * Canonicalize mathematical symbols safely.
   * Only performs transformations that are unambiguous.
   */
  private canonicalizeMathSymbols(text: string): { text: string; warnings: string[] } {
    const warnings: string[] = [];
    let result = text;

    // Safe transformations: these are unambiguous
    const safeReplacements: Array<[RegExp, string]> = [
      [/×/g, '*'],           // Multiplication sign to asterisk
      [/÷/g, '/'],           // Division sign to slash
      [/≤/g, '<='],          // Less than or equal
      [/≥/g, '>='],          // Greater than or equal
      [/≠/g, '!='],          // Not equal
      [/²/g, '^2'],          // Superscript 2
      [/³/g, '^3'],          // Superscript 3
      [/π/g, 'pi'],          // Pi to 'pi' (common in programming)
    ];

    for (const [pattern, replacement] of safeReplacements) {
      result = result.replace(pattern, replacement);
    }

    // Detect ambiguous symbols that we CANNOT auto-fix
    const ambiguousPatterns = [
      { pattern: /[xх]/, message: 'Ambiguous character: could be x (variable) or х (Cyrillic)' },
      { pattern: /[aа]/, message: 'Ambiguous character: could be a (Latin) or а (Cyrillic)' },
      { pattern: /[oо]/, message: 'Ambiguous character: could be o (Latin) or о (Cyrillic)' },
      { pattern: /[eе]/, message: 'Ambiguous character: could be e (Latin) or е (Cyrillic)' },
    ];

    for (const { pattern, message } of ambiguousPatterns) {
      if (pattern.test(result)) {
        warnings.push(message);
      }
    }

    return { text: result, warnings };
  }

  /**
   * Detect ambiguous mathematical symbols that require human review.
   */
  private detectAmbiguousSymbols(text: string): string[] {
    const warnings: string[] = [];

    // Detect potential variable confusion
    if (/[xхyу]/.test(text)) {
      warnings.push('Potential Cyrillic/Latin character confusion in variables');
    }

    // Detect operator ambiguity
    if (/[–—]/.test(text)) {
      warnings.push('Ambiguous dash character (could be minus or hyphen)');
    }

    // Detect function name ambiguity
    if (/sin|cos|tan|log/i.test(text)) {
      // Check if these appear in contexts that might be ambiguous
      // This is a simple heuristic; in production, use more sophisticated parsing
    }

    return warnings;
  }

  /**
   * Calculate parsing confidence based on warnings and text quality.
   * 
   * Base confidence: 1.0
   * Each warning reduces confidence by 0.05
   * Minimum confidence: 0.5
   */
  private calculateParsingConfidence(warnings: string[], normalizedText: string): number {
    let confidence = 1.0;

    // Reduce confidence for each warning
    confidence -= warnings.length * 0.05;

    // Reduce confidence for very short text (likely incomplete)
    if (normalizedText.length < 20) {
      confidence -= 0.2;
    }

    // Reduce confidence for very long text (might include noise)
    if (normalizedText.length > 1000) {
      confidence -= 0.1;
    }

    // Ensure confidence stays within valid range
    return Math.max(0.5, Math.min(1.0, confidence));
  }
}
