import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';
import { AssetProfileIdentifier, Filter } from '@ghostfolio/common/interfaces';

import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import ms from 'ms';
import { createHash } from 'node:crypto';

interface CacheManagerLike {
  clear(): Promise<void>;
  del(key: string): Promise<void>;
  get<T = unknown>(key: string): Promise<T | null>;
  mdel(keys: string[]): Promise<void>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  stores?: CacheStoreLike[];
}

interface CacheStoreLike {
  deserialize?: (value: string) => unknown;
  iterator?(options: Record<string, unknown>): AsyncIterable<[string, unknown]>;
  on?(event: string, handler: (error: Error) => void): void;
}

@Injectable()
export class RedisCacheService {
  private readonly cacheAdapter: CacheManagerLike;
  private readonly client?: CacheStoreLike;

  public constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly configurationService: ConfigurationService
  ) {
    this.cacheAdapter = this.cache as unknown as CacheManagerLike;
    this.client = this.cacheAdapter.stores?.[0];

    if (this.client) {
      this.client.deserialize = (value) => {
        try {
          return JSON.parse(value);
        } catch {}

        return value;
      };

      this.client.on?.('error', (error) => {
        Logger.error(error, 'RedisCacheService');
      });
    }
  }

  public async get(key: string): Promise<string> {
    return this.cacheAdapter.get<string>(key) as Promise<string>;
  }

  public async getKeys(aPrefix?: string): Promise<string[]> {
    const keys: string[] = [];
    const prefix = aPrefix;

    try {
      if (!this.client?.iterator) {
        return keys;
      }

      for await (const [key] of this.client.iterator({})) {
        if ((prefix && key.startsWith(prefix)) || !prefix) {
          keys.push(key);
        }
      }
    } catch {}

    return keys;
  }

  public getPortfolioSnapshotKey({
    filters,
    userId
  }: {
    filters?: Filter[];
    userId: string;
  }) {
    let portfolioSnapshotKey = `portfolio-snapshot-${userId}`;

    if (filters?.length > 0) {
      const filtersHash = createHash('sha256')
        .update(JSON.stringify(filters))
        .digest('hex');

      portfolioSnapshotKey = `${portfolioSnapshotKey}-${filtersHash}`;
    }

    return portfolioSnapshotKey;
  }

  public getQuoteKey({ dataSource, symbol }: AssetProfileIdentifier) {
    return `quote-${getAssetProfileIdentifier({ dataSource, symbol })}`;
  }

  public async isHealthy() {
    const testKey = '__health_check__';
    const testValue = Date.now().toString();

    try {
      await Promise.race([
        (async () => {
          await this.set(testKey, testValue, ms('1 second'));
          const result = await this.get(testKey);

          if (result !== testValue) {
            throw new Error('Redis health check failed: value mismatch');
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis health check failed: timeout')),
            ms('2 seconds')
          )
        )
      ]);

      return true;
    } catch (error) {
      Logger.error(error?.message, 'RedisCacheService');

      return false;
    } finally {
      try {
        await this.remove(testKey);
      } catch {}
    }
  }

  public async remove(key: string) {
    return this.cacheAdapter.del(key);
  }

  public async removePortfolioSnapshotsByUserId({
    userId
  }: {
    userId: string;
  }) {
    const keys = await this.getKeys(
      `${this.getPortfolioSnapshotKey({ userId })}`
    );

    return this.cacheAdapter.mdel(keys);
  }

  public async reset() {
    return this.cacheAdapter.clear();
  }

  public async set(key: string, value: string, ttl?: number) {
    return this.cacheAdapter.set(
      key,
      value,
      ttl ?? this.configurationService.get('CACHE_TTL')
    );
  }
}
