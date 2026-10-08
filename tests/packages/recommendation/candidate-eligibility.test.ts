/*
 * Verifies the single candidate pool through its read and commit boundary.
 */
// @vitest-environment node
import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { createMaterialStorage } from '@megumi/application/recommendation/content/material-storage';
import { createCandidateQualificationStorage } from '@megumi/application/recommendation/candidates/candidate-qualification-storage';
import { rehearsalFolder } from './foundation-fixture';
let database: DatabaseConnection;
let folder: string;
afterEach(() => {
  database?.close();
  if (folder)
    fs.rmSync(folder, {
      recursive: true,
      force: true,
    });
});
it('applies language and excluded content to the same eligible collection', () => {
  database = createDatabase({ filename: ':memory:' });
  folder = rehearsalFolder();
  migrateDatabase({
    database,
    migrationsFolder: folder,
  });
  database
    .prepare({
      sql: "INSERT INTO interests(id,text,enabled,created_at,updated_at) VALUES('i1','面试',1,0,0)",
    })
    .run();

  const contents = createMaterialStorage(database);
  const candidates = createCandidateQualificationStorage(database);
  const ids: string[] = [];
  for (const language of ['zh', 'en']) {
    const text = language === 'zh' ? '面试准备方法' : 'Interview preparation';
    const material = contents.saveMaterial({
      platform: 'web',
      canonicalUrl: `https://example.com/${language}`,
      language,
      text,
      kind: 'full_text',
      truncated: false,
      rangeEnd: [...text].length,
      method: 'direct_web',
      acquiredAt: 10,
      publicationEvidence: [],
    }).material;
    const evidence = [
      {
        materialId: material.id,
        quote: text,
      },
    ];
    contents.saveAnalysis({
      contentId: material.contentId,
      materialId: material.id,
      result: {
        summary: text,
        keyPoints: [
          {
            text,
            evidence,
          },
        ],
        topics: ['interview'],
        contentType: 'article',
        qualityScore: 0.7,
        spamScore: 0,
        timeScope: {
          kind: 'unknown',
          evidence: [],
        },
      },
      now: 20,
    });
    candidates.saveQualification({
      contentId: material.contentId,
      materialId: material.id,
      interestId: 'i1',
      interestRevision: 1,
      relation: 'direct',
      status: 'eligible',
      basis: 'Provides preparation methods',
      evidence,
      reviewedAt: 20,
      validUntil: 100,
    });
    ids.push(material.contentId);
  }

  expect(
    candidates
      .listEligible(30, {
        contentLanguages: ['zh'],
        excludeContentIds: [],
      })
      .map(item => item.contentId),
  ).toEqual([ids[0]]);
  expect(
    candidates.listEligible(30, {
      contentLanguages: ['zh'],
      excludeContentIds: [ids[0]!],
    }),
  ).toEqual([]);
});
it('rejects an obsolete matching attempt without replacing the current qualification', () => {
  database = createDatabase({ filename: ':memory:' });
  folder = rehearsalFolder();
  migrateDatabase({
    database,
    migrationsFolder: folder,
  });
  database
    .prepare({
      sql: "INSERT INTO interests(id,text,enabled,created_at,updated_at) VALUES('i1','面试',1,0,0)",
    })
    .run();
  database
    .prepare({
      sql: "INSERT INTO discovery_runs(id,purpose,status,interest_snapshot,config_revision,started_at,budget) VALUES('r1','candidate_supply','running','[]','v1',10,'{}')",
    })
    .run();

  const contents = createMaterialStorage(database);
  const candidates = createCandidateQualificationStorage(database);
  const material = contents.saveMaterial({
    platform: 'web',
    canonicalUrl: 'https://example.com/token',
    text: '面试方法',
    kind: 'full_text',
    truncated: false,
    rangeEnd: 4,
    method: 'direct_web',
    acquiredAt: 10,
    publicationEvidence: [],
  }).material;
  const evidence = [
    {
      materialId: material.id,
      quote: '面试方法',
    },
  ];
  contents.saveAnalysis({
    contentId: material.contentId,
    materialId: material.id,
    result: {
      summary: '面试方法',
      keyPoints: [
        {
          text: '面试',
          evidence,
        },
      ],
      topics: ['面试'],
      contentType: 'article',
      qualityScore: 0.5,
      spamScore: 0,
      timeScope: {
        kind: 'unknown',
        evidence: [],
      },
    },
    now: 20,
  });

  const qualification = {
    contentId: material.contentId,
    materialId: material.id,
    interestId: 'i1',
    interestRevision: 1,
    relation: 'direct' as const,
    status: 'eligible' as const,
    basis: '面试方法',
    evidence,
    reviewedAt: 30,
    validUntil: 100,
  };
  candidates.saveQualification(qualification);
  database
    .prepare({
      sql: "UPDATE recommendation_candidates SET status='pending',owner_run_id='r1',attempt_token='new-token',attempt_started_at=20,attempt_deadline_at=100",
    })
    .run();

  expect(
    candidates.saveQualification(qualification, {
      runId: 'r1',
      token: 'old-token',
      startedAt: 20,
      deadlineAt: 100,
    }),
  ).toEqual({ status: 'input_changed' });
  expect(candidates.listEligible(40)).toEqual([]);
});
