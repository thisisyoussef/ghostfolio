import {
  type SourceAttributionRecord,
  type VerificationSource,
  type VerificationSourceAttribution
} from './verification.types';

export function toSourceAttributionRecord(args: {
  source: string;
  timestamp?: string;
}): SourceAttributionRecord {
  return {
    source: args.source,
    timestamp: args.timestamp || new Date().toISOString()
  };
}

export function toSourceAttribution(args: {
  primarySource: string;
  backupSource?: string;
  primaryTimestamp?: string;
  backupTimestamp?: string;
}): VerificationSourceAttribution {
  return {
    primary: toSourceAttributionRecord({
      source: args.primarySource,
      timestamp: args.primaryTimestamp
    }),
    ...(args.backupSource
      ? {
          backup: toSourceAttributionRecord({
            source: args.backupSource,
            timestamp: args.backupTimestamp
          })
        }
      : {})
  };
}

export function hasValidSourceAttribution(
  attribution?: VerificationSourceAttribution
): boolean {
  if (!attribution?.primary?.source || !attribution.primary.timestamp) {
    return false;
  }

  if (
    attribution.backup &&
    (!attribution.backup.source || !attribution.backup.timestamp)
  ) {
    return false;
  }

  return true;
}

export function attributionToSources(args: {
  attribution?: VerificationSourceAttribution;
  tool: string;
  primaryClaim: string;
  backupClaim?: string;
}): VerificationSource[] {
  const { attribution, tool, primaryClaim, backupClaim } = args;

  if (!attribution) {
    return [];
  }

  const sources: VerificationSource[] = [
    {
      tool,
      claim: primaryClaim,
      source: attribution.primary.source,
      timestamp: attribution.primary.timestamp
    }
  ];

  if (attribution.backup) {
    sources.push({
      tool,
      claim: backupClaim || `${primaryClaim} (backup)`,
      source: attribution.backup.source,
      timestamp: attribution.backup.timestamp
    });
  }

  return sources;
}
