/**
 * OCR Provider Interface — Phase 5E
 *
 * Abstraction for OCR/text extraction from images or documents.
 * Allows swapping OCR providers without changing business logic.
 */

export interface OcrInput {
  /** Reference to the asset (file path, URL, or identifier) */
  assetRef: string;
  /** MIME type of the asset (e.g., 'image/png', 'application/pdf') */
  mimeType?: string;
  /** Optional asset data for providers that accept direct bytes */
  data?: Buffer;
}

export interface OcrResult {
  /** Extracted text content */
  text: string;
  /** Confidence score for the extraction (0-1) */
  confidence: number;
  /** Provider-specific metadata */
  metadata?: {
    provider: string;
    model?: string;
    version?: string;
    processingTimeMs?: number;
    [key: string]: unknown;
  };
  /** Warnings about the extraction (e.g., low contrast, blurry regions) */
  warnings?: string[];
}

export interface IOcrProvider {
  /** Get the provider name for logging/audit */
  getProviderName(): string;
  
  /** Extract text from an image or document */
  extract(input: OcrInput): Promise<OcrResult>;
  
  /** Check if the provider is available/configured */
  isAvailable(): Promise<boolean>;
}
