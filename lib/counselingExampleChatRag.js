import {
  classifyRagError
} from './counselingRagPolicy.js';

import {
  buildCounselingExampleContext,
  searchCounselingExamples
} from './counselingExampleStore.js';

import {
  mapChatDomainToV2ExampleDomain,
  COUNSELING_EXAMPLE_V2_CANONICAL_DOMAINS
} from './counselingExampleDomainMap.js';

export const COUNSELING_EXAMPLE_CHAT_RAG_VERSION =
  'counseling_example_chat_rag_v1';

const DEFAULT_EXAMPLE_LIMIT =
  Number(
    process.env.COUNSELING_EXAMPLE_RAG_LIMIT ||
    3
  );

const DEFAULT_TIMEOUT_MS =
  Number(
    process.env.COUNSELING_EXAMPLE_RAG_TIMEOUT_MS ||
    process.env.RAG_TIMEOUT_MS ||
    8000
  );

const DOMAIN_LABELS =
  new Set([
    '총운',
    '사업운',
    '재물운',
    '심신운',
    '연애운',
    'all',
    ...COUNSELING_EXAMPLE_V2_CANONICAL_DOMAINS
  ]);

function cleanText(
  value,
  maxLength = 5000
) {
  if (
    typeof value !==
    'string'
  ) {
    return '';
  }

  return (
    value
      .trim()
      .slice(
        0,
        maxLength
      )
  );
}

function sanitizeForExampleQuery(
  value,
  profileName = ''
) {
  let text =
    cleanText(
      value,
      800
    )
      .replace(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
        '[이메일]'
      )
      .replace(
        /(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g,
        '[전화번호]'
      );

  if (
    profileName.length >=
    2
  ) {
    text =
      text
        .split(
          profileName
        )
        .join(
          '[사용자]'
        );
  }

  return text;
}

export function resolveCounselingExampleCategory(
  normalized,
  counselingFactContext = null
) {
  const fromIntent =
    cleanText(
      counselingFactContext
        ?.intent
        ?.domain,
      80
    );

  const fromRequest =
    cleanText(
      normalized
        ?.domain,
      80
    );

  const label =
    fromIntent ||
    fromRequest ||
    '';

  if (!label) {
    return null;
  }

  const canonical =
    mapChatDomainToV2ExampleDomain(
      label
    );

  if (canonical) {
    return canonical;
  }

  if (
    label ===
      '총운' ||
    label ===
      'all'
  ) {
    return null;
  }

  if (
    DOMAIN_LABELS.has(
      label
    )
  ) {
    return null;
  }

  return null;
}

export function buildCounselingExampleSearchQuery(
  normalized,
  counselingFactContext = null
) {
  const profileName =
    cleanText(
      normalized
        ?.sajuContext
        ?.name,
      80
    );

  const domainLabel =
    resolveCounselingExampleCategory(
      normalized,
      counselingFactContext
    ) ||
    mapChatDomainToV2ExampleDomain(
      cleanText(
        normalized
          ?.domain,
        80
      )
    ) ||
    cleanText(
      normalized
        ?.domain,
      80
    ) ||
    '총운';

  const recentTurns =
    Array.isArray(
      normalized
        ?.history
    )
      ? normalized
          .history
          .slice(
            -4
          )
          .map(
            (
              item
            ) => {
              if (
                !item ||
                typeof item !==
                  'object'
              ) {
                return null;
              }

              const role =
                item.role ===
                'user'
                  ? 'user'
                  : 'assistant';

              const text =
                sanitizeForExampleQuery(
                  item.text,
                  profileName
                );

              if (
                !text
              ) {
                return null;
              }

              return (
                `${role}: ${text}`
              );
            }
          )
          .filter(
            Boolean
          )
      : [];

  const currentUser =
    sanitizeForExampleQuery(
      normalized
        ?.userMessage,
      profileName
    );

  return (
    cleanText(
      [
        `domain: ${domainLabel}`,
        recentTurns.length
          ? `recent:\n${recentTurns.join('\n')}`
          : '',
        currentUser
          ? `question: ${currentUser}`
          : ''
      ]
        .filter(
          Boolean
        )
        .join(
          '\n'
        ),
      2500
    )
  );
}

function withTimeout(
  promise,
  timeoutMs
) {
  if (
    !Number.isFinite(
      timeoutMs
    ) ||
    timeoutMs <=
      0
  ) {
    return promise;
  }

  let timer;

  const timeout =
    new Promise(
      (
        _,
        reject
      ) => {
        timer =
          setTimeout(
            () => {
              const error =
                new Error(
                  `Counseling example RAG exceeded ${timeoutMs}ms`
                );

              error.code =
                'SG-CE-CHAT-TIMEOUT';

              reject(
                error
              );
            },
            timeoutMs
          );
      }
    );

  return (
    Promise
      .race([
        promise,
        timeout
      ])
      .finally(
        () =>
          clearTimeout(
            timer
          )
      )
  );
}

function summarizeExampleRetrieval(
  searchResult
) {
  if (
    !searchResult ||
    typeof searchResult !==
      'object'
  ) {
    return null;
  }

  return {
    preferredSchema:
      searchResult
        .preferredSchema ||
      null,

    category:
      searchResult
        .category ||
      null,

    resultCount:
      Array.isArray(
        searchResult
          ?.results
      )
        ? searchResult
            .results
            .length
        : 0,

    resultIds:
      Array.isArray(
        searchResult
          .results
      )
        ? searchResult
            .results
            .map(
              (
                item
              ) =>
                item
                  .exampleId
            )
            .filter(
              Boolean
            )
        : [],

    count:
      Array.isArray(
        searchResult
          .results
      )
        ? searchResult
            .results
            .length
        : 0
  };
}

export async function executeCounselingExampleRag({
  needed = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  limit = DEFAULT_EXAMPLE_LIMIT,
  query = '',
  category = null,
  search = searchCounselingExamples,
  buildContext = buildCounselingExampleContext
} = {}) {
  const targetLimit =
    Math.max(
      2,
      Math.min(
        3,
        Number(
          limit
        ) ||
          DEFAULT_EXAMPLE_LIMIT
      )
    );

  const baseRuntime = {
    status:
      'not_started',

    required:
      false,

    query:
      null,

    retrieval:
      null,

    contextText:
      '',

    fallbackUsed:
      false
  };

  if (
    !needed
  ) {
    return {
      ...baseRuntime,

      status:
        'skipped_not_needed'
    };
  }

  const semanticQuery =
    cleanText(
      query,
      2500
    );

  if (
    !semanticQuery
  ) {
    return {
      ...baseRuntime,

      status:
        'skipped_empty_query',

      fallbackUsed:
        true
    };
  }

  try {
    const searchResult =
      await withTimeout(
        search({
          query:
            semanticQuery,

          category,

          limit:
            targetLimit,

          includeInactive:
            false,

          v2Only:
            true
        }),
        timeoutMs
      );

    const results =
      Array.isArray(
        searchResult
          ?.results
      )
        ? searchResult
            .results
        : [];

    const retrievalSummary =
      summarizeExampleRetrieval(
        searchResult
      );

    if (
      !results.length
    ) {
      return {
        ...baseRuntime,

        status:
          'no_relevant_results',

        query:
          semanticQuery,

        retrieval:
          retrievalSummary,

        fallbackUsed:
          true
      };
    }

    const contextText =
      buildContext(
        results,
        {
          maxExamples:
            targetLimit
        }
      );

    return {
      status:
        'used',

      required:
        false,

      query:
        semanticQuery,

      retrieval:
        retrievalSummary,

      contextText:
        cleanText(
          contextText,
          14000
        ),

      fallbackUsed:
        false
    };
  } catch (
    error
  ) {
    return {
      ...baseRuntime,

      status:
        classifyRagError(
          error
        ),

      query:
        semanticQuery,

      fallbackUsed:
        true,

      errorCode:
        typeof error?.code ===
          'string'
          ? error
              .code
              .slice(
                0,
                120
              )
          : null
    };
  }
}

export default Object.freeze({
  COUNSELING_EXAMPLE_CHAT_RAG_VERSION,
  buildCounselingExampleSearchQuery,
  resolveCounselingExampleCategory,
  executeCounselingExampleRag
});
