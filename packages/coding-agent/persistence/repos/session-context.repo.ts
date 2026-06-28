// Owns session context persistence transactions that span compactions and active path facts.
import type { MegumiDatabase } from '../connection';
import type {
  SessionActiveLeaf,
  SessionCompactionEntry,
  SessionSourceEntry,
} from '@megumi/shared/session';
import { SessionActiveLeafSchema } from '@megumi/shared/session';
import { SessionActivePathRepository } from './session-active-path.repo';
import { SessionCompactionRepository } from './session-compaction.repo';

export interface SaveSessionCompactionWithActivePathInput {
  compaction: SessionCompactionEntry;
  sourceEntry: SessionSourceEntry;
  activeLeaf: SessionActiveLeaf;
  expectedCurrentLeafSourceEntryId?: string;
}

export interface SaveSessionCompactionWithActivePathResult {
  sourceEntry: SessionSourceEntry;
  activeLeafAdvanced: boolean;
}

export class SessionContextRepository {
  private readonly activePathRepository: SessionActivePathRepository;
  private readonly compactionRepository: SessionCompactionRepository;

  constructor(private readonly database: MegumiDatabase) {
    this.activePathRepository = new SessionActivePathRepository(database);
    this.compactionRepository = new SessionCompactionRepository(database);
  }

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    this.compactionRepository.saveSessionCompaction(entry);
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    return this.compactionRepository.getSessionCompaction(compactionId);
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return this.compactionRepository.listSessionCompactionsBySession(sessionId);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    return this.compactionRepository.getLatestCompletedSessionCompaction(sessionId);
  }

  saveSessionCompactionWithActivePath(
    input: SaveSessionCompactionWithActivePathInput,
  ): SaveSessionCompactionWithActivePathResult {
    const persist = this.database.transaction((
      compaction: SessionCompactionEntry,
      sourceEntry: SessionSourceEntry,
      activeLeaf: SessionActiveLeaf,
      expectedCurrentLeafSourceEntryId: string | undefined,
    ) => {
      this.compactionRepository.saveSessionCompaction(compaction);
      const parsedSourceEntry = this.activePathRepository.appendSourceEntry(sourceEntry);
      const parsedActiveLeaf = SessionActiveLeafSchema.parse(activeLeaf);
      const currentLeaf = this.activePathRepository.getActiveLeaf(parsedActiveLeaf.sessionId);
      const expectedLeaf = expectedCurrentLeafSourceEntryId ?? null;
      let activeLeafAdvanced = false;

      if ((currentLeaf?.leafSourceEntryId ?? null) === expectedLeaf) {
        this.activePathRepository.setActiveLeaf(parsedActiveLeaf);
        activeLeafAdvanced = true;
      }

      return {
        sourceEntry: parsedSourceEntry,
        activeLeafAdvanced,
      };
    });

    return persist(
      input.compaction,
      input.sourceEntry,
      input.activeLeaf,
      input.expectedCurrentLeafSourceEntryId,
    );
  }
}
