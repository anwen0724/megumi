/*
 * Cleans recommendation-owned history and exposes the references protecting content materials.
 */
import type { DatabaseConnection } from '../storage/index';
/** Releases expired result relationships before asking Content to delete unreferenced materials. */
export function createRecommendationRetention(database: DatabaseConnection) {
  return {
    /** Only visible results and favorites protect old waiting work from abandonment. */
    displayedContentIds() {
      return database.prepare<{
        content_id: string;
      }>({ sql: 'SELECT content_id FROM daily_feed_items UNION SELECT content_id FROM curated_selection_items UNION SELECT content_id FROM favorites' }).all().map(row => row.content_id);
    },
    cleanup(minDate: string, before: number) {
      database.transaction({
        operation: () => {
          database.prepare({ sql: "UPDATE recommendation_runs SET daily_feed_batch_id=NULL WHERE status NOT IN ('queued','running') AND daily_feed_batch_id IN (SELECT id FROM daily_feed_batches WHERE date<?)" }).run([minDate]);
          database.prepare({ sql: "DELETE FROM daily_feed_batches WHERE date<? AND NOT EXISTS(SELECT 1 FROM recommendation_runs WHERE daily_feed_batch_id=daily_feed_batches.id)" }).run([minDate]);
          database.prepare({ sql: "UPDATE recommendation_runs SET curated_selection_id=NULL WHERE status NOT IN ('queued','running') AND curated_selection_id IN (SELECT id FROM curated_selections WHERE created_at<? AND id<>coalesce((SELECT current_selection_id FROM recommendation_state WHERE id=1),''))" }).run([before]);
          database.prepare({ sql: "DELETE FROM curated_selections WHERE created_at<? AND id<>coalesce((SELECT current_selection_id FROM recommendation_state WHERE id=1),'') AND NOT EXISTS(SELECT 1 FROM recommendation_runs WHERE curated_selection_id=curated_selections.id)" }).run([before]);
          database.prepare({ sql: "UPDATE recommendation_runs SET retry_of_run_id=NULL WHERE retry_of_run_id IN (SELECT id FROM recommendation_runs WHERE status NOT IN ('queued','running') AND finished_at<?)" }).run([before]);
          database.prepare({ sql: "DELETE FROM recommendation_runs WHERE status NOT IN ('queued','running') AND finished_at<? AND NOT EXISTS(SELECT 1 FROM recommendation_run_judgments j WHERE j.owner_run_id=recommendation_runs.id)" }).run([before]);
        }
      });
    },
    /** This owner supplies read-only retained references, including frozen in-flight inputs. */
    references() {
      const rows = database.prepare<{
        content_id: string;
        material_id: string;
      }>({ sql: 'SELECT content_id,material_id FROM daily_feed_items UNION SELECT content_id,material_id FROM curated_selection_items UNION SELECT content_id,material_id FROM favorites UNION SELECT content_id,material_id FROM recommendation_run_judgments' }).all();
      const frozen = database.prepare<{
        content_id: string;
        material_id: string;
      }>({ sql: "SELECT json_extract(c.value,'$.contentId') AS content_id,json_extract(c.value,'$.materialId') AS material_id FROM recommendation_runs r,json_each(r.candidate_snapshot) c WHERE r.status IN ('queued','running')" }).all();
      return { contentIds: [...new Set([...rows, ...frozen].map(row => row.content_id))], materialIds: [...new Set([...rows, ...frozen].map(row => row.material_id))] };
    },
  };
}
