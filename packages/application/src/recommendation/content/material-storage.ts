/*
 * Persists immutable material versions and analysis independently from interest matching.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import { normalizeContentUrl } from './normalize-content';
import { MaterialInputSchema, PublicationEvidenceSchema, MaterialAnalysisSchema, ANALYSIS_CONTRACT_VERSION, type ContentMaterial, type MaterialInput, type MaterialAnalysis, type DiscoveryAttempt, type Evidence } from './material-contracts';
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
      sql: 'SELECT m.*, c.platform,c.external_id,c.canonical_url FROM content_materials m JOIN contents c ON c.id = m.content_id WHERE m.id = ?'
    }).get([id]);
    if (!row)
      return undefined;
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
    /** Reads a saved canonical identity URL even when material acquisition is unfinished. */
    savedUrl(contentId:string) {
      return database.prepare<{canonical_url:string}>({sql:'SELECT canonical_url FROM contents WHERE id=?'}).get([contentId])?.canonical_url;
    },
    /** Reports active analysis ownership without exposing Content tables to other owners. */
    activeRunIds() {
      return database.prepare<{owner_run_id:string}>({sql:'SELECT DISTINCT owner_run_id FROM content_analysis WHERE owner_run_id IS NOT NULL'}).all().map(row=>row.owner_run_id);
    },
    /** Old waiting work cannot protect itself; displayed and eligible content remains recoverable. */
    abandonPending(before:number,protectedContentIds:ReadonlySet<string>):string[] {
      const rows=database.prepare<{content_id:string;material_id:string}>({sql:"SELECT a.content_id,a.material_id FROM content_analysis a JOIN content_materials m ON m.id=a.material_id WHERE a.status IN ('pending','cancelled','failed') AND a.owner_run_id IS NULL AND a.error_code IS NOT 'ABANDONED' AND m.acquired_at<?"}).all([before]);
      const abandoned=rows.filter(row=>!protectedContentIds.has(row.content_id));
      for(const row of abandoned)database.prepare({sql:"UPDATE content_analysis SET status='failed',attempts=3,retry_at=NULL,error_code='ABANDONED' WHERE content_id=? AND material_id=? AND owner_run_id IS NULL"}).run([row.content_id,row.material_id]);
      return abandoned.map(row=>row.content_id);
    },
    /** Deletes only Content-owned rows, after reference queries run inside the acquired write lock. */
    cleanup(before:number,references:()=>{contentIds:readonly string[];materialIds:readonly string[]},limit=100) {
      return database.transaction({operation:()=>{
        database.prepare({sql:'UPDATE contents SET updated_at=updated_at WHERE id=?'}).run(['']);
        const protectedIds=references();
        const contentIds=new Set(protectedIds.contentIds);const materialIds=new Set(protectedIds.materialIds);
        const pending=database.prepare<{content_id:string;material_id:string}>({sql:"SELECT content_id,material_id FROM content_analysis WHERE status IN ('pending','running') AND error_code IS NOT 'ABANDONED'"}).all();
        for(const row of pending){contentIds.add(row.content_id);materialIds.add(row.material_id);}
        const obsolete=database.prepare<{id:string}>({sql:'SELECT id FROM contents WHERE updated_at<? ORDER BY updated_at,id'}).all([before]).filter(row=>!contentIds.has(row.id)).slice(0,limit);
        const deleting=new Set(obsolete.map(row=>row.id));
        for(const row of obsolete){
          const peers=database.prepare<{id:string}>({sql:'SELECT id FROM contents WHERE duplicate_group_id=? ORDER BY id'}).all([row.id]);
          const replacement=peers.find(peer=>!deleting.has(peer.id))?.id??null;
          database.prepare({sql:'UPDATE contents SET duplicate_group_id=? WHERE duplicate_group_id=?'}).run([replacement,row.id]);
          database.prepare({sql:'UPDATE contents SET current_material_id=NULL WHERE id=?'}).run([row.id]);
          database.prepare({sql:'DELETE FROM contents WHERE id=?'}).run([row.id]);
        }
        const historical=database.prepare<{id:string}>({sql:'SELECT m.id FROM content_materials m JOIN contents c ON c.id=m.content_id WHERE m.id<>c.current_material_id AND m.acquired_at<? ORDER BY m.acquired_at,m.id'}).all([before]).filter(row=>!materialIds.has(row.id)).slice(0,limit);
        for(const row of historical)database.prepare({sql:'DELETE FROM content_materials WHERE id=?'}).run([row.id]);
        return {contents:obsolete.length,materials:historical.length};
      }});
    },
    /** Reads identities and their current material for local diagnostics and recovery. */
    listIdentities(): readonly {
      contentId: string;
      material?: ContentMaterial;
    }[] {
      return database.prepare<{
        id: string;
        current_material_id: string | null;
      }>({ sql: 'SELECT id,current_material_id FROM contents ORDER BY created_at,id' }).all().map(row => ({ contentId: row.id, ...(row.current_material_id ? { material: readMaterial(row.current_material_id) } : {}) }));
    },
    /** Counts one correction only when the owned input still permits another actual call. */
    /** Extends a live multi-segment analysis without reviving an expired or replaced owner. */
    renewAnalysis(contentId: string, materialId: string, attempt: DiscoveryAttempt, now: number, deadlineAt: number): boolean {
      return database.prepare({
        sql: `UPDATE content_analysis SET attempt_deadline_at=?
        WHERE content_id=? AND material_id=? AND owner_run_id=? AND attempt_token=?
        AND status='running' AND attempt_deadline_at>? AND EXISTS
        (SELECT 1 FROM discovery_runs WHERE id=? AND status='running')`
      }).run([
          deadlineAt, contentId, materialId, attempt.runId, attempt.token, now, attempt.runId
        ]).changes > 0;
    },
    /** Counts one correction only when the owned input still permits another actual call. */
    retryAnalysis(contentId: string, materialId: string, attempt: DiscoveryAttempt, now: number): boolean {
      return database.prepare({ sql: 'UPDATE content_analysis SET attempts=attempts+1 WHERE content_id=? AND material_id=? AND contract_version=? AND owner_run_id=? AND attempt_token=? AND attempts<3 AND attempt_deadline_at>?' }).run([contentId, materialId, ANALYSIS_CONTRACT_VERSION, attempt.runId, attempt.token, now]).changes > 0;
    },
    /** Saves a validated discovered identity even when its material is not yet available. */
    ensureIdentity(input: {
      platform: string;
      externalId?: string;
      canonicalUrl: string;
      title?: string;
      author?: string;
      now: number;
    }): string {
      const canonicalUrl = normalizeContentUrl(input.canonicalUrl);
      if (!canonicalUrl)
        throw new Error('Content identity requires an HTTP or HTTPS URL.');
      const existing = database.prepare<{
        id: string;
      }>({ sql: 'SELECT id FROM contents WHERE canonical_url=? OR (platform=? AND external_id=? AND external_id IS NOT NULL) LIMIT 1' }).get([canonicalUrl, input.platform, input.externalId ?? null]);
      if (existing)
        return existing.id;
      const id = newId();
      database.prepare({ sql: 'INSERT INTO contents(id,platform,external_id,canonical_url,title,author,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)' }).run([id, input.platform, input.externalId ?? null, canonicalUrl, input.title ?? null, input.author ?? null, input.now, input.now]);
      return id;
    },
    /** Lists actual current materials for recovery without another search. */
    listCurrentMaterials(): readonly ContentMaterial[] {
      return database.prepare<{
        current_material_id: string;
      }>({ sql: 'SELECT current_material_id FROM contents WHERE current_material_id IS NOT NULL ORDER BY updated_at,id' }).all().map(row => readMaterial(row.current_material_id)!);
    },
    /** Recovers only ownership attached to interrupted discovery runs. */
    recoverInterrupted(): void {
      database.prepare({ sql: `UPDATE content_analysis SET status='cancelled',owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id IN (SELECT id FROM discovery_runs WHERE status IN ('interrupted','cancelled'))` }).run();
    },
    /** Reports the earliest analysis blocker rather than counting it as inventory. */
    analysisWork(contentId: string, materialId: string, now: number): 'ready' | 'actionable' | 'blocked' | 'running' | 'failed' {
      const row = database.prepare<{
        status: string;
        attempts: number;
        retry_at: number | null;
        attempt_deadline_at: number | null;
      }>({ sql: 'SELECT * FROM content_analysis WHERE content_id=? AND material_id=? AND contract_version=?' }).get([contentId, materialId, ANALYSIS_CONTRACT_VERSION]);
      return row?.status === 'ready' ? 'ready' : (row?.attempt_deadline_at ?? 0) > now ? 'running' : row && row.attempts >= 3 ? 'failed' : (row?.retry_at ?? 0) > now ? 'blocked' : 'actionable';
    },
    /** Claims one material analysis only after its execution budget has been reserved. */
    claimAnalysis(input: {
      contentId: string;
      materialId: string;
      runId: string;
      now: number;
      deadlineAt: number;
    }): DiscoveryAttempt | undefined {
      if (input.deadlineAt <= input.now)
        return undefined;
      const token = newId();
      const changed = database.prepare({
        sql: `INSERT INTO content_analysis(content_id,material_id,contract_version,status,owner_run_id,attempt_token,attempt_started_at,attempt_deadline_at,attempts)
          SELECT ?,?,?,'running',?,?,?, ?,1 WHERE EXISTS(SELECT 1 FROM discovery_runs WHERE id = ? AND status = 'running')
          ON CONFLICT(content_id,material_id,contract_version) DO UPDATE SET status = 'running',owner_run_id = excluded.owner_run_id,
          attempt_token = excluded.attempt_token,attempt_started_at = excluded.attempt_started_at,attempt_deadline_at = excluded.attempt_deadline_at,attempts = content_analysis.attempts + 1
          WHERE content_analysis.status <> 'ready' AND content_analysis.attempts < 3
          AND (content_analysis.retry_at IS NULL OR content_analysis.retry_at <= ?)
          AND (content_analysis.owner_run_id IS NULL OR content_analysis.attempt_deadline_at <= ?)`,
      }).run([input.contentId, input.materialId, ANALYSIS_CONTRACT_VERSION, input.runId, token, input.now, input.deadlineAt, input.runId, input.now, input.now]);
      return changed.changes ? { runId: input.runId, token, startedAt: input.now, deadlineAt: input.deadlineAt } : undefined;
    },
    /** Releases only the attempt named by the caller; a later claimant is never changed. */
    releaseAnalysis(input: {
      contentId: string;
      materialId: string;
      attempt: DiscoveryAttempt;
      now: number;
      errorCode?: string;
    }): boolean {
      return database.prepare({
        sql: `UPDATE content_analysis SET status = ?,error_code = ?,retry_at = ?,owner_run_id = NULL,attempt_token = NULL,attempt_started_at = NULL,attempt_deadline_at = NULL
          WHERE content_id = ? AND material_id = ? AND contract_version = ? AND owner_run_id = ? AND attempt_token = ? AND status = 'running'`,
      }).run([input.errorCode ? 'failed' : 'cancelled', input.errorCode ?? null, input.errorCode ? input.now + 60000 : null, input.contentId, input.materialId, ANALYSIS_CONTRACT_VERSION, input.attempt.runId, input.attempt.token]).changes > 0;
    },
    /** Saves actual acquired text; service metadata is separate from material identity. */
    saveMaterial(input: MaterialInput): {
      status: 'created' | 'unchanged';
      material: ContentMaterial;
    } {
      let material = MaterialInputSchema.parse(input);
      const canonicalUrl = normalizeContentUrl(material.canonicalUrl);
      if (!canonicalUrl)
        throw new Error('Material URL must use HTTP or HTTPS.');
      return database.transaction({
        operation: () => {
          const existing = database.prepare<{
            id: string;
            current_material_id: string | null;
          }>({
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
          if (previous) {
            const evidence = [...previous.publicationEvidence.filter(item => item.kind === 'published'), ...material.publicationEvidence];
            material = { ...material, publicationEvidence: [...new Map(evidence.map(item => [JSON.stringify(item), item])).values()] };
          }
          // Preserve the acquired date-bearing excerpt while retaining the stronger current text.
          const historical = Boolean(previous && previous.kind !== 'excerpt' && material.kind === 'excerpt');
          if (previous && historical && !material.publicationEvidence.length)
            return { status: 'unchanged', material: previous };
          const repeated = historical ? database.prepare<{
            id: string;
          }>({ sql: 'SELECT id FROM content_materials WHERE content_id=? AND kind=? AND text_hash=? ORDER BY revision DESC' }).all([contentId, material.kind, createHash('sha256').update(material.text).digest('hex')]).map(row => readMaterial(row.id)!).find(saved => sameMaterial(saved, material)) : undefined;
          if (repeated)
            return { status: 'unchanged', material: repeated };
          if (previous && sameMaterial(previous, material)) {
            database.prepare({
              sql: 'INSERT INTO material_acquisitions(id,material_id,method,acquired_at) VALUES(?,?,?,?)'
            }).run([newId(), previous.id, material.method, material.acquiredAt]);
            return { status: 'unchanged', material: previous };
          }
          const materialId = newId();
          const revision = (database.prepare<{
            revision: number | null;
          }>({ sql: 'SELECT max(revision) AS revision FROM content_materials WHERE content_id=?' }).get([contentId])?.revision ?? 0) + 1;
          if (!existing)
            database.prepare({
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
            sql: 'INSERT INTO content_materials(id,content_id,revision,title,author,author_id,language,text,text_hash,kind,truncated,range_start,range_end,method,acquired_at,publication_evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          }).run([
            materialId,
            contentId,
            revision,
            material.title ?? null,
            material.author ?? null,
            material.authorId ?? null,
            material.language ?? null,
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
          if (!historical)
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
          const duplicate = database.prepare<{
            id: string;
            duplicate_group_id: string | null;
          }>({ sql: 'SELECT c.id,c.duplicate_group_id FROM contents c JOIN content_materials m ON m.id=c.current_material_id WHERE m.text_hash=? AND c.id<>? ORDER BY c.created_at,c.id LIMIT 1' }).get([createHash('sha256').update(material.text).digest('hex'), contentId]);
          if (!historical)
            database.prepare({ sql: 'UPDATE contents SET duplicate_group_id=? WHERE id=?' }).run([duplicate ? duplicate.duplicate_group_id ?? duplicate.id : null, contentId]);
          return {
            status: 'created',
            material: {
              ...material,
              canonicalUrl,
              id: materialId,
              contentId,
              revision
            }
          };
        }
      });
    },
    /** Saves a material-specific analysis; matching and candidate value are separate facts. */
    saveAnalysis(input: {
      contentId: string;
      materialId: string;
      result: MaterialAnalysis;
      now: number;
      attempt?: DiscoveryAttempt;
    }): {
      status: 'saved' | 'input_changed';
    } {
      return database.transaction({
        operation: () => {
          if (input.attempt && !database.prepare({
            sql: `SELECT 1 FROM content_analysis a JOIN discovery_runs r ON r.id = a.owner_run_id
          WHERE a.content_id = ? AND a.material_id = ? AND a.contract_version = ? AND a.status = 'running'
          AND a.owner_run_id = ? AND a.attempt_token = ? AND a.attempt_deadline_at > ? AND r.status = 'running'`,
          }).get([input.contentId, input.materialId, ANALYSIS_CONTRACT_VERSION, input.attempt.runId, input.attempt.token, input.now]))
            return { status: 'input_changed' };
          const result = MaterialAnalysisSchema.parse(input.result);
          const material = readMaterial(input.materialId);
          if (!material || material.contentId !== input.contentId)
            throw new Error('Analysis material does not belong to this content.');
          validateEvidence(material, [...result.keyPoints.flatMap((point) => point.evidence), ...result.timeScope.evidence]);
          database.prepare({
            sql: "INSERT INTO content_analysis(content_id,material_id,contract_version,status,result,analyzed_at) VALUES(?,?,?,'ready',?,?) ON CONFLICT(content_id,material_id,contract_version) DO UPDATE SET status = 'ready',result = excluded.result,analyzed_at = excluded.analyzed_at,owner_run_id = NULL,attempt_token = NULL,attempt_started_at = NULL,attempt_deadline_at = NULL,retry_at = NULL,error_code = NULL"
          }).run([
            input.contentId,
            input.materialId,
            ANALYSIS_CONTRACT_VERSION,
            JSON.stringify(result),
            input.now
          ]);
          return { status: 'saved' };
        }
      });
    },
    /** Reads only the requested analysis version, never the legacy analysis contract. */
    readAnalysis(contentId: string, materialId: string): MaterialAnalysis | undefined {
      const row = database.prepare<{
        result: string;
      }>({
        sql: "SELECT result FROM content_analysis WHERE content_id = ? AND material_id = ? AND contract_version = ? AND status = 'ready'"
      }).get([contentId, materialId, ANALYSIS_CONTRACT_VERSION]);
      return row ? MaterialAnalysisSchema.parse(JSON.parse(row.result)) : undefined;
    },
    /** Reads the currently acquired version; a known identity may still have no material. */
    readCurrentMaterial(contentId: string): ContentMaterial | undefined {
      const row = database.prepare<{
        current_material_id: string | null;
      }>({ sql: 'SELECT current_material_id FROM contents WHERE id = ?' }).get([contentId]);
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
    material.authorId ?? null,
    material.language ?? null,
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
