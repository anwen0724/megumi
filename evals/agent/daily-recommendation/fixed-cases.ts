/*
 * Defines replayable Daily Recommendation behavior Cases with fixed context,
 * expected Tool interactions, and final business-table facts.
 */
import type {
  DailyRecommendationEvaluationCandidate,
  DailyRecommendationEvaluationCase,
} from './evaluation-metrics';

const fixedNow = '2026-08-27T08:00:00.000Z';

export const DAILY_RECOMMENDATION_FIXED_CASES = [
  {
    caseId: 'mixed-relevance-interest-and-feedback',
    description: 'Balances direct, adjacent, and exploration material across Interests while avoiding recent and negative topics.',
    fixedNow,
    activeInterestIds: ['interest:agents', 'interest:typescript'],
    windowCandidates: [
      candidate('candidate:agent-runtime', 'direct', ['interest:agents'], 'agent-runtime'),
      candidate('candidate:typed-contracts', 'adjacent', ['interest:typescript'], 'typed-contracts'),
      candidate('candidate:local-first', 'exploration', [], 'local-first'),
      candidate('candidate:recent-runtime', 'direct', ['interest:agents'], 'recent-runtime'),
      candidate('candidate:disliked-framework', 'direct', ['interest:agents'], 'disliked-framework'),
      candidate('candidate:hidden-boilerplate', 'adjacent', ['interest:typescript'], 'hidden-boilerplate'),
    ],
    recentTopicKeys: ['recent-runtime'],
    stablePreferences: [{
      scopeKey: 'interest:interest:typescript', revision: 1,
      directions: [{
        directionId: 'direction:typed-contracts', polarity: 'positive',
        statement: 'Prefer concrete examples of typed contracts.',
      }],
    }],
    pendingFeedback: [
      { topicKey: 'typed-contracts', reaction: 'liked' },
      { topicKey: 'disliked-framework', reaction: 'disliked' },
    ],
    observation: {
      batch: { requestedCount: 3, actualTarget: 3 },
      modelCallCount: 1,
      toolCalls: [{
        name: 'publish_daily_recommendations',
        candidateIds: [
          'candidate:agent-runtime',
          'candidate:typed-contracts',
          'candidate:local-first',
        ],
        status: 'published',
      }],
      recommendations: [
        recommendation('candidate:agent-runtime', '直接回应你持续关注的 Agent Runtime 设计。'),
        recommendation('candidate:typed-contracts', '把你喜欢的类型化边界延伸到工具契约实践。'),
        recommendation('candidate:local-first', '提供一个与当前主题不同但相关的本地优先视角。'),
      ],
    },
    expected: {
      selectedCandidateIds: [
        'candidate:agent-runtime',
        'candidate:typed-contracts',
        'candidate:local-first',
      ],
      excludedCandidateIds: [
        'candidate:recent-runtime',
        'candidate:disliked-framework',
        'candidate:hidden-boilerplate',
      ],
      readCandidateIds: [],
      publicationStatuses: ['published'],
    },
  },
  {
    caseId: 'read-full-content-on-demand',
    description: 'Reads one locally persisted full article only when its compact summary is insufficient for selection.',
    fixedNow,
    activeInterestIds: ['interest:agents'],
    windowCandidates: [
      candidate('candidate:ambiguous-paper', 'direct', ['interest:agents'], 'ambiguous-paper', false),
      candidate('candidate:runtime-guide', 'adjacent', ['interest:agents'], 'runtime-guide'),
      candidate('candidate:shallow-listicle', 'direct', ['interest:agents'], 'shallow-listicle'),
    ],
    recentTopicKeys: [],
    stablePreferences: [],
    pendingFeedback: [],
    observation: {
      batch: { requestedCount: 2, actualTarget: 2 },
      modelCallCount: 1,
      toolCalls: [
        { name: 'read_pool_candidate', candidateId: 'candidate:ambiguous-paper', status: 'succeeded' },
        {
          name: 'publish_daily_recommendations',
          candidateIds: ['candidate:ambiguous-paper', 'candidate:runtime-guide'],
          status: 'published',
        },
      ],
      recommendations: [
        recommendation('candidate:ambiguous-paper', '阅读全文后确认其包含可复用的 Agent 调度实验。'),
        recommendation('candidate:runtime-guide', '补充更易落地的 Runtime 实现路径。'),
      ],
    },
    expected: {
      selectedCandidateIds: ['candidate:ambiguous-paper', 'candidate:runtime-guide'],
      excludedCandidateIds: ['candidate:shallow-listicle'],
      readCandidateIds: ['candidate:ambiguous-paper'],
      publicationStatuses: ['published'],
    },
  },
  {
    caseId: 'publication-conflict-replacement',
    description: 'Replaces a Candidate that became unavailable after the first atomic publication attempt.',
    fixedNow,
    activeInterestIds: ['interest:agents', 'interest:typescript'],
    windowCandidates: [
      candidate('candidate:stable', 'direct', ['interest:agents'], 'stable'),
      candidate('candidate:conflicted', 'direct', ['interest:typescript'], 'conflicted'),
      candidate('candidate:replacement', 'adjacent', ['interest:typescript'], 'replacement'),
    ],
    recentTopicKeys: [],
    stablePreferences: [],
    pendingFeedback: [],
    observation: {
      batch: { requestedCount: 2, actualTarget: 2 },
      modelCallCount: 2,
      toolCalls: [
        {
          name: 'publish_daily_recommendations',
          candidateIds: ['candidate:stable', 'candidate:conflicted'],
          status: 'selection_conflict',
        },
        {
          name: 'publish_daily_recommendations',
          candidateIds: ['candidate:stable', 'candidate:replacement'],
          status: 'published',
        },
      ],
      recommendations: [
        recommendation('candidate:stable', '保留未发生冲突且价值最高的核心候选。'),
        recommendation('candidate:replacement', '替代已不可用候选并维持跨兴趣覆盖。'),
      ],
    },
    expected: {
      selectedCandidateIds: ['candidate:stable', 'candidate:replacement'],
      excludedCandidateIds: ['candidate:conflicted'],
      readCandidateIds: [],
      publicationStatuses: ['selection_conflict', 'published'],
    },
  },
  {
    caseId: 'candidate-shortage',
    description: 'Publishes the available Pool count when it is lower than the dynamic user target.',
    fixedNow,
    activeInterestIds: ['interest:agents'],
    windowCandidates: [
      candidate('candidate:only-direct', 'direct', ['interest:agents'], 'only-direct'),
      candidate('candidate:only-exploration', 'exploration', [], 'only-exploration'),
    ],
    recentTopicKeys: [],
    stablePreferences: [],
    pendingFeedback: [],
    observation: {
      batch: { requestedCount: 5, actualTarget: 2 },
      modelCallCount: 1,
      toolCalls: [{
        name: 'publish_daily_recommendations',
        candidateIds: ['candidate:only-direct', 'candidate:only-exploration'],
        status: 'published',
      }],
      recommendations: [
        recommendation('candidate:only-direct', '当前 Pool 中最直接相关的内容。'),
        recommendation('candidate:only-exploration', '在候选不足时保留一个有依据的探索项。'),
      ],
    },
    expected: {
      selectedCandidateIds: ['candidate:only-direct', 'candidate:only-exploration'],
      readCandidateIds: [],
      publicationStatuses: ['published'],
    },
  },
] as const satisfies readonly DailyRecommendationEvaluationCase[];

function candidate(
  candidateId: string,
  relevance: DailyRecommendationEvaluationCandidate['relevance'],
  matchedInterestIds: readonly string[],
  topicKey: string,
  summarySufficient = true,
): DailyRecommendationEvaluationCandidate {
  return {
    candidateId,
    contentIdentity: `identity:${candidateId}`,
    topicKey,
    relevance,
    matchedInterestIds,
    summarySufficient,
  };
}

function recommendation(candidateId: string, recommendationReason: string) {
  return { candidateId, recommendationReason };
}
