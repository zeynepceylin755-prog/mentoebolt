import { IOcrProvider, OcrInput, OcrResult } from '../../domain/interfaces/ocr/IOcrProvider.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { OcrProviderError } from '../../domain/errors/QuestionAnalysisErrors.js';

/**
 * MockOcrProvider — Phase 5E
 *
 * Deterministic mock OCR provider for testing.
 * Returns predictable results based on input asset reference.
 *
 * This provider does NOT require any external OCR service or API key.
 */
export class MockOcrProvider implements IOcrProvider {
  private readonly provider = 'mock-ocr';
  private readonly version = '1.0.0';

  getProviderName(): string {
    return this.provider;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    // Input contract: an OCR extraction requires a non-empty asset reference.
    // There is nothing to extract from, so this must fail loudly rather than
    // fabricate text for an unnamed asset.
    if (!input || typeof input.assetRef !== 'string' || input.assetRef.trim().length === 0) {
      throw new OcrProviderError('OCR extraction requires a non-empty assetRef');
    }

    const startTime = Date.now();
    
    // Simulate processing latency
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

    // Deterministic mock response based on asset reference
    const mockText = this.generateMockText(input.assetRef);
    const confidence = this.generateMockConfidence(input.assetRef);
    const warnings = this.generateMockWarnings(input.assetRef);

    const processingTimeMs = Date.now() - startTime;

    logger.debug({
      assetRef: input.assetRef,
      mimeType: input.mimeType,
      textLength: mockText.length,
      confidence,
      processingTimeMs,
    }, 'Mock OCR extraction');

    return {
      text: mockText,
      confidence,
      metadata: {
        provider: this.provider,
        version: this.version,
        processingTimeMs,
      },
      warnings,
    };
  }

  /**
   * Generate deterministic mock text based on asset reference.
   * In production, this would be actual OCR output.
   */
  private generateMockText(assetRef: string): string {
    // Use assetRef as a seed for deterministic but varied output
    const hash = this.simpleHash(assetRef);
    
    const mockQuestions = [
      'x² + 5x + 6 = 0 denkleminin köklerini bulunuz.',
      'f(x) = 3x² - 2x + 1 fonksiyonunun türevini hesaplayınız.',
      'Aşağıdaki verilerin aritmetik ortalamasını bulunuz: 12, 15, 18, 21, 24',
      'Bir üçgenin alanı taban × yükseklik / 2 formülü ile hesaplanır. Tabanı 8 cm ve yüksekliği 5 cm olan üçgenin alanını bulunuz.',
      'sin(30°) + cos(60°) değerini hesaplayınız.',
      'Logaritma tanımına göre log₂(8) değerini bulunuz.',
      'Bir dairenin çevresi 2πr formülü ile hesaplanır. Yarıçapı 7 cm olan dairenin çevresini bulunuz.',
    ];

    // Select question based on hash
    const index = hash % mockQuestions.length;
    return mockQuestions[Math.abs(index)];
  }

  /**
   * Generate deterministic confidence score (0.7-0.99) based on asset reference.
   */
  private generateMockConfidence(assetRef: string): number {
    const hash = this.simpleHash(assetRef);
    // Map hash to 0.7-0.99 range
    const normalized = (Math.abs(hash) % 290) / 1000;
    return 0.7 + normalized;
  }

  /**
   * Generate deterministic warnings based on asset reference.
   * Some asset refs trigger warnings to test low-confidence scenarios.
   */
  private generateMockWarnings(assetRef: string): string[] {
    const hash = this.simpleHash(assetRef);
    const warnings: string[] = [];

    // 20% of assets have low contrast warning
    if (hash % 5 === 0) {
      warnings.push('Low contrast detected in some regions');
    }

    // 10% of assets have blurry regions
    if (hash % 10 === 0) {
      warnings.push('Blurry regions detected');
    }

    return warnings;
  }

  /**
   * Simple hash function for deterministic mock behavior.
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}
