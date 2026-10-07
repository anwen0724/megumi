/* Persists immutable material versions and analysis independently from interest matching. */
import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import { normalizeContentUrl } from './normalize-content';
import {
  MaterialInputSchema,
  PublicationEvidenceSchema,
  MaterialAnalysisSchema,
  ANALYSIS_CONTRACT_VERSION,
  type ContentMaterial,
  type MaterialInput,
  type MaterialAnalysis,
  type Evidence
} from './material-contracts';
import { z } from 'zod';

interface MaterialRow extends DatabaseRow {
  id: string;
  content_id: string;
  revision: number;
  platform: string;
  external_id: string | null;
  canonical_url: string;
  title: string | null;
  author: string | null;
  author_id: string | null;
  language: string | null;
  text: string;
  kind: string;
  truncated: number;
  range_start: number;
  range_end: number;
  method: string;
  acquired_at: number;
  publication_evidence: string;
}

/** Opens material persistence after the foundation migration has been applied. */
export function createMaterialStorage(database: DatabaseConnection, newId: () => string = randomUUID) {
  const readMaterial = (id: string): ContentMaterial | undefined => {
    const row = database.prepare<MaterialRow>({
      sql: 'SELECT m.*, c.platform,c.external_id,c.canonical_url,c.author_id,c.language FROM content_materials m JOIN contents c ON c.id = m.content_id WHERE m.id = ?'
    }).get([id]);
    if (!row) return undefined;
    const parsed = MaterialInputSchema.parse({
      platform: row.platform,
      ...(row.external_id ? { externalId: row.external_id } : {}),
      canonicalUrl: row.canonical_url,
      ...(row.title !== null ? { title: row.title } : {}),
      ...(row.author !== null ? { author: row.author } : {}),
      ...(row.author_id !== null ? { authorId: row.author_id } : {}),
      ...(row.language !== null ? { language: row.language } : {}),
      text: row.text,
      kind: row.kind,
      truncated: row.truncated === 1,
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      method: row.method,
      acquiredAt: row.acquired_at,
      publicationEvidence: z.array(PublicationEvidenceSchema).parse(JSON.parse(row.publication_evidence))
    });
    return { ...parsed, id: row.id, contentId: row.content_id, revision: row.revision };
  };
  return {
    /** Saves actual acquired text; service metadata is separate from material identity. */
    saveMaterial(input: MaterialInput): { status: 'created' | 'unchanged'; material: ContentMaterial } {
      const material = MaterialInputSchema.parse(input);
      const canonicalUrl = normalizeContentUrl(material.canonicalUrl);
      if (!canonicalUrl) throw new Error('Material URL must use HTTP or HTTPS.');
      return database.transaction({
        operation: () => {
          const existing = database.prepare<{ id: string; current_material_id: string | null }>({
            sql: 'SELECT id,current_material_id FROM contents WHERE (platform = ? AND external_id = ? AND external_id IS NOT NULL) OR canonical_url = ? ORDER BY CASE WHEN platform = ? AND external_id = ? THEN 0 ELSE 1 END LIMIT 1'
          }).get([
            material.platform,
            material.externalId ?? null,
            canonicalUrl,
            material.platform,
            material.externalId ?? null
          ]);
          const contentId = existing?.id ?? newId();
          if (existing && material.externalId) {
            database.prepare({
              sql: 'UPDATE contents SET external_id = ? WHERE id = ? AND platform = ? AND external_id IS NULL'
            }).run([material.externalId, contentId, material.platform]);
          }
          const previous = existing?.current_material_id ? readMaterial(existing.current_material_id) : undefined;
          if (previous && sameMaterial(previous, material)) {
            database.prepare({
              sql: 'INSERT INTO material_acquisitions(id,material_id,method,acquired_at) VALUES(?,?,?,?)'
            }).run([newId(), previous.id, material.method, material.acquiredAt]);
            return { status: 'unchanged', material: previous };
          }
          const materialId = newId();
          if (!existing) database.prepare({
            sql: 'INSERT INTO contents(id,platform,external_id,canonical_url,title,author,author_id,language,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
          }).run([
            contentId,
            material.platform,
            material.externalId ?? null,
            canonicalUrl,
            material.title ?? null,
            material.author ?? null,
            material.authorId ?? null,
            material.language ?? null,
            material.acquiredAt,
            material.acquiredAt
          ]);
          database.prepare({
            sql: 'INSERT INTO content_materials(id,content_id,revision,title,author,text,text_hash,kind,truncated,range_start,range_end,method,acquired_at,publication_evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          }).run([
            materialId,
            contentId,
            (previous?.revision ?? 0) + 1,
            material.title ?? null,
            material.author ?? null,
            material.text,
            createHash('sha256').update(material.text).digest('hex'),
            material.kind,
            material.truncated ? 1 : 0,
            material.rangeStart,
            material.rangeEnd,
            material.method,
            material.acquiredAt,
            JSON.stringify(material.publicationEvidence)
          ]);
          database.prepare({
            sql: 'UPDATE contents SET current_material_id = ?, title = ?, author = ?, author_id = ?, language = coalesce(?,language), updated_at = ? WHERE id = ?'
          }).run([
            materialId,
            material.title ?? null,
            material.author ?? null,
            material.authorId ?? null,
            material.language ?? null,
            material.acquiredAt,
            contentId
          ]);
          database.prepare({
            sql: 'INSERT INTO material_acquisitions(id,material_id,method,acquired_at) VALUES(?,?,?,?)'
          }).run([newId(), materialId, material.method, material.acquiredAt]);
          return {
            status: 'created',
            material: {
              ...material,
              canonicalUrl,
              id: materialId,
              contentId,
              revision: (previous?.revision ?? 0) + 1
            }
          };
        }
      });
    },
    /** Saves a material-specific analysis; matching and candidate value are separate facts. */
    saveAnalysis(input: { contentId: string; materialId: string; result: MaterialAnalysis; now: number }): void {
      const result = MaterialAnalysisSchema.parse(input.result);
      const material = readMaterial(input.materialId);
      if (!material || material.contentId !== input.contentId) throw new Error('Analysis material does not belong to this content.');
      validateEvidence(material, [...result.keyPoints.flatMap((point) => point.evidence), ...result.timeScope.evidence]);
      database.prepare({
        sql: "INSERT INTO content_analysis(content_id,material_id,contract_version,status,result,analyzed_at) VALUES(?,?,?,'ready',?,?) ON CONFLICT(content_id,material_id,contract_version) DO UPDATE SET status = 'ready',result = excluded.result,analyzed_at = excluded.analyzed_at"
      }).run([
        input.contentId,
        input.materialId,
        ANALYSIS_CONTRACT_VERSION,
        JSON.stringify(result),
        input.now
      ]);
    },
    /** Reads only the requested analysis version, never the legacy analysis contract. */
    readAnalysis(contentId: string, materialId: string): MaterialAnalysis | undefined {
      const row = database.prepare<{ result: string }>({
        sql: "SELECT result FROM content_analysis WHERE content_id = ? AND material_id = ? AND contract_version = ? AND status = 'ready'"
      }).get([contentId, materialId, ANALYSIS_CONTRACT_VERSION]);
      return row ? MaterialAnalysisSchema.parse(JSON.parse(row.result)) : undefined;
    },
    /** Reads the currently acquired version; a known identity may still have no material. */
    readCurrentMaterial(contentId: string): ContentMaterial | undefined {
      const row = database.prepare<{ current_material_id: string | null }>({ sql: 'SELECT current_material_id FROM contents WHERE id = ?' }).get([contentId]);
      return row?.current_material_id ? readMaterial(row.current_material_id) : undefined;
    },
    /** Reads the exact historical material, without consulting a source. */
    readMaterial,
  };
}

/** Service, URL aliases and acquisition time do not change the material presented to a model. */
function sameMaterial(before: ContentMaterial, after: z.output<typeof MaterialInputSchema>): boolean {
  const visible = (material: z.output<typeof MaterialInputSchema>) => [
    material.title ?? null,
    material.author ?? null,
    material.text,
    material.kind,
    material.truncated,
    material.rangeStart,
    material.rangeEnd,
    material.publicationEvidence
  ];
  return JSON.stringify(visible(before)) === JSON.stringify(visible(after));
}

/** Evidence must refer to an exact fragment of the material actually analyzed. */
export function validateEvidence(material: ContentMaterial, evidence: readonly Evidence[]): void {
  if (evidence.some((entry) => entry.materialId !== material.id || !material.text.includes(entry.quote))) {
    throw new Error('Evidence must quote the specified acquired material.');
  }
}
