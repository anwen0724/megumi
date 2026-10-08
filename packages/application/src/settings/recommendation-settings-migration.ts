/* Converts raw explicit recommendation settings; never reads or modifies credentials. */
import { z } from 'zod';
import fs from 'node:fs';
import { readJsonFile, writeJsonFile } from './json-file';
import {
  RecommendationConfigurationSchema,
  RecommendationLimitsSchema,
} from './definitions/recommendation';
const ObjectSchema = z.record(z.unknown());
const VersionSchema = z.literal(1);

/** Converts legacy settings atomically before application capabilities start. */
export function migrateRecommendationSettings(filePath: string): {
  status: 'migrated' | 'unchanged';
  removedPaths: string[];
  defaultedPaths: string[];
} {
  if (!fs.existsSync(filePath))
    return {
      status: 'unchanged',
      removedPaths: [],
      defaultedPaths: [],
    };

  const read = readJsonFile(filePath);
  if (read.status === 'invalid')
    throw new Error('Recommendation settings migration requires a JSON object.');
  if (VersionSchema.safeParse(read.document.recommendationMigrationVersion).success) {
    RecommendationConfigurationSchema.parse(read.document.discovery);
    return {
      status: 'unchanged',
      removedPaths: [],
      defaultedPaths: [],
    };
  }
  if (read.document.recommendationMigrationVersion !== undefined)
    throw new Error('Unsupported recommendation settings migration version.');

  const old = ObjectSchema.parse(read.document.discovery ?? {});
  const supply = ObjectSchema.parse(old.candidateSupply ?? {});
  const oldLimits = ObjectSchema.parse(supply.limits ?? {});
  const defaults = RecommendationConfigurationSchema.parse({});
  const defaultedPaths: string[] = [];
  const removedPaths: string[] = [];
  const enabledSources =
    old.enabledSources === undefined
      ? ['zhihu']
      : z
          .array(z.string().trim().min(1))
          .parse(old.enabledSources)
          .filter((sourceId, index) => {
            if (
              RecommendationConfigurationSchema.shape.enabledSources.safeParse([sourceId]).success
            )
              return true;

            removedPaths.push(`discovery.enabledSources[${index}]`);
            return false;
          });
  const candidateSupply: Record<string, unknown> = {};
  for (const field of [
    'maintenanceIntervalMinutes',
    'maxSearchBackoffHours',
    'contentLanguages',
    'searchReuseIntervalMinutes',
    'searchHistoryDays',
  ]) {
    if (supply[field] !== undefined) candidateSupply[field] = supply[field];
  }

  const longTerm = ObjectSchema.parse(supply.longTerm ?? {});
  for (const [field, schema] of [
    ['interestMinimumCount', z.number().int().nonnegative()],
    ['interestTargetCount', z.number().int().positive()],
  ] as const) {
    if (longTerm[field] === undefined) {
      defaultedPaths.push(`discovery.candidateSupply.${field}`);
      continue;
    }

    const value = schema.safeParse(longTerm[field]);
    candidateSupply[field] = value.success ? value.data : defaults.candidateSupply[field];
    if (!value.success) defaultedPaths.push(`discovery.candidateSupply.${field}`);
  }

  if (
    Number(candidateSupply.interestTargetCount ?? defaults.candidateSupply.interestTargetCount) <=
    Number(candidateSupply.interestMinimumCount ?? defaults.candidateSupply.interestMinimumCount)
  ) {
    candidateSupply.interestMinimumCount = defaults.candidateSupply.interestMinimumCount;
    candidateSupply.interestTargetCount = defaults.candidateSupply.interestTargetCount;
    defaultedPaths.push(
      'discovery.candidateSupply.interestMinimumCount',
      'discovery.candidateSupply.interestTargetCount',
    );
  }

  const limits: Record<string, unknown> = {};
  for (const field of Object.keys(RecommendationLimitsSchema.innerType().shape))
    if (oldLimits[field] !== undefined) limits[field] = oldLimits[field];

  if (oldLimits.maxScreeningCalls !== undefined)
    limits.maxJudgmentCalls = oldLimits.maxScreeningCalls;
  if (oldLimits.maxConcurrentRequests !== undefined) {
    limits.maxConcurrentSourceRequests = oldLimits.maxConcurrentRequests;
    limits.maxConcurrentModelRequests = oldLimits.maxConcurrentRequests;
  }
  if (typeof limits.maxSearchCalls === 'number')
    limits.maxSearchCalls = Math.max(2, limits.maxSearchCalls);

  const dailyFeed: Record<string, unknown> = {};
  if (typeof supply.freshnessDays === 'number' && Number.isFinite(supply.freshnessDays))
    dailyFeed.lookbackDays = Math.max(1, Math.min(7, Math.ceil(supply.freshnessDays)));

  const discovery = {
    enabled: old.candidateSupplyConfirmed ?? false,
    // Existing installations keep the old implicit source, including files with no discovery block.
    enabledSources,
    ...(old.candidateSupplyModel !== undefined
      ? { candidateSupplyModel: old.candidateSupplyModel }
      : {}),
    candidateSupply,
    dailyFeed,
    limits,
  };
  RecommendationConfigurationSchema.parse(discovery);
  for (const field of Object.keys(old))
    if (!['candidateSupplyModel', 'enabledSources', 'candidateSupply'].includes(field))
      removedPaths.push(`discovery.${field}`);

  for (const field of Object.keys(supply))
    if (!Object.hasOwn(candidateSupply, field))
      removedPaths.push(`discovery.candidateSupply.${field}`);

  for (const field of Object.keys(oldLimits))
    if (!Object.hasOwn(RecommendationLimitsSchema.innerType().shape, field))
      removedPaths.push(`discovery.candidateSupply.limits.${field}`);

  writeJsonFile(filePath, {
    ...read.document,
    discovery,
    recommendationMigrationVersion: 1,
  });

  return {
    status: 'migrated',
    removedPaths,
    defaultedPaths,
  };
}
