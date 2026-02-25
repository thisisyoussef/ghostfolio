export type VerificationStatus = 'pass' | 'warning' | 'fail';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface VerificationCheck {
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface SourceAttributionRecord {
  source: string;
  timestamp: string;
}

export interface VerificationSourceAttribution {
  primary: SourceAttributionRecord;
  backup?: SourceAttributionRecord;
}

export interface VerificationSource {
  tool: string;
  claim: string;
  source: string;
  timestamp: string;
}

export interface VerificationSummary {
  status: VerificationStatus;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  checks: Record<string, VerificationCheck>;
  sources: VerificationSource[];
  generatedAt: string;
}
