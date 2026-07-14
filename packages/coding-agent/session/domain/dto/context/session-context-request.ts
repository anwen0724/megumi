/* Defines Session requests used by Context history and compaction. */
export type GetActiveHistoryRequest = {
  session_id: string;
  through_entry_id?: string | null;
};

export type SaveCompactionSummaryRequest = {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: string;
  first_kept_entry_id?: string;
  expected_active_entry_id?: string | null;
  created_at: string;
  append_to_active_path?: boolean;
};
