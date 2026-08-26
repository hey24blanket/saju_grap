// lib/ragQueryBuilder.js
// SajuGrap Engine Facts v1 -> RAG Query Builder
// -----------------------------------------------------------------------------
// 역할
// - Engine Facts v1에서 RAG 검색에 필요한 Fact만 선택한다.
// - 사주 계산을 새로 하지 않는다.
// - 없는 Fact를 추론하거나 보정하지 않는다.
// - Engine diagnostics 전체를 RAG/LLM에 전달하지 않는다.
// - 특정 Vector DB/Firebase 구현에 종속되지 않는 중립 Query Packet을 만든다.
// -----------------------------------------------------------------------------

export const RAG_QUERY_SCHEMA_VERSION = 'rag_query_v1';
export const RAG_QUERY_BUILDER_VERSION = '1.0.0';

export const RAG_QUERY_STAGE = Object.freeze({
  VALIDATE_INPUT: 'RAG_QUERY_VALIDATE_INPUT',
  SELECT_FACTS: 'RAG_QUERY_SELECT_FACTS',
  SELECT_CYCLE: 'RAG_QUERY_SELECT_CYCLE',
  BUILD_QUERY: 'RAG_QUERY_BUILD',
  VALIDATE_OUTPUT: 'RAG_QUERY_VALIDATE_OUTPUT'
});

export const RAG_QUERY_ERROR = Object.freeze({
  INVALID_ENGINE_FACTS: 'SG-RAG-QUERY-001',
  INVALID_SCHEMA: 'SG-RAG-QUERY-002',
  INVALID_DOMAIN: 'SG-RAG-QUERY-003',
  INVALID_CYCLE: 'SG-RAG-QUERY-004',
  INVALID_CYCLE_INDEX: 'SG-RAG-QUERY-005',
  BUILD_FAILED: 'SG-RAG-QUERY-006',
  OUTPUT_INVALID: 'SG-RAG-QUERY-007'
});

export const DOMAIN_KEYS = Object.freeze([
  'all',
  'career',
  'wealth',
  'mental',
  'love'
]);

export const CYCLE_KEYS = Object.freeze([
  'daewoon',
  'year',
  'month',
  'day',
  'hour'
]);

const DOMAIN_ALIASES = Object.freeze({
  all: 'all',
  total: 'all',
  overall: 'all',
  총운: 'all',

  career: 'career',
  work: 'career',
  business: 'career',
  사업운: 'career',
  직업운: 'career',

  wealth: 'wealth',
  money: 'wealth',
  finance: 'wealth',
  재물운: 'wealth',

  mental: 'mental',
  mind: 'mental',
  wellness: 'mental',
  심신운: 'mental',

  love: 'love',
  relationship: 'love',
  romance: 'love',
  연애운: 'love'
});

const CYCLE_ALIASES = Object.freeze({
  daewoon: 'daewoon',
  대운: 'daewoon',

  year: 'year',
  annual: 'year',
  연운: 'year',

  month: 'month',
  monthly: 'month',
  월운: 'month',

  day: 'day',
  daily: 'day',
  일운: 'day',

  hour: 'hour',
  hourly: 'hour',
  시운: 'hour'
});

const TEN_GOD_GROUPS = Object.freeze([
  'peer',
  'output',
  'wealth',
  'officer',
  'resource'
]);

const USEFUL_GOD_ROLE_KEYS = Object.freeze([
  'yongsin',
  'heesin',
  'gisin',
  'gusin',
  'hansin'
]);

const ALLOWED_STRENGTH_BANDS = new Set([
  'very_weak',
  'weak',
  'balanced',
  'strong',
  'very_strong'
]);

const ALLOWED_TEN_GOD_GROUP_BANDS = new Set([
  'very_weak',
  'weak',
  'moderate',
  'strong',
  'very_strong'
]);

const ALLOWED_ELEMENTS = new Set([
  'wood',
  'fire',
  'earth',
  'metal',
  'water'
]);

const ALLOWED_CYCLE_BALANCE_EFFECTS = new Set([
  'relieves',
  'aggravates',
  'neutral',
  'mixed',
  'uncertain'
]);

const IMPORTANT_RELATION_TYPES = new Set([
  'stem_five_combination',
  'branch_six_harmony',
  'branch_clash',
  'branch_three_harmony',
  'branch_seasonal_meeting',
  'half_harmony',
  'branch_punishment',
  'branch_harm',
  'branch_break'
]);

const SAFE_USER_QUERY_MAX = 800;


// ============================================================================
// Error
// ============================================================================

export class RagQueryBuilderError extends Error {
  constructor({
    code,
    stage,
    message,
    detail = null,
    field = null
  }) {
    super(message);

    this.name = 'RagQueryBuilderError';
    this.code = code;
    this.stage = stage;
    this.detail = detail;
    this.field = field;
  }
}


// ============================================================================
// Utilities
// ============================================================================

function cleanText(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .filter(
          (value) =>
            typeof value === 'string' &&
            value.trim()
        )
        .map(
          (value) =>
            value.trim()
        )
    )
  ];
}

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function safeObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
    ? value
    : {};
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => {
        if (
          value === null ||
          value === undefined ||
          value === ''
        ) {
          return false;
        }

        if (
          Array.isArray(value) &&
          value.length === 0
        ) {
          return false;
        }

        if (
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0
        ) {
          return false;
        }

        return true;
      })
  );
}

function normalizeDomain(value) {
  const raw =
    cleanText(value, 40);

  if (!raw) {
    return 'all';
  }

  const normalized =
    DOMAIN_ALIASES[raw] ||
    DOMAIN_ALIASES[
      raw.toLowerCase()
    ];

  if (!normalized) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_DOMAIN,

      stage:
        RAG_QUERY_STAGE
          .VALIDATE_INPUT,

      message:
        `지원하지 않는 RAG domain입니다: ${raw}`,

      detail:
        `allowed=${DOMAIN_KEYS.join(', ')}`,

      field:
        'domain'
    });
  }

  return normalized;
}

function normalizeCycleType(value) {
  const raw =
    cleanText(value, 40);

  if (!raw) {
    return null;
  }

  const normalized =
    CYCLE_ALIASES[raw] ||
    CYCLE_ALIASES[
      raw.toLowerCase()
    ];

  if (!normalized) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_CYCLE,

      stage:
        RAG_QUERY_STAGE
          .VALIDATE_INPUT,

      message:
        `지원하지 않는 cycleType입니다: ${raw}`,

      detail:
        `allowed=${CYCLE_KEYS.join(', ')}`,

      field:
        'cycleType'
    });
  }

  return normalized;
}

function normalizeCycleIndex(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_CYCLE_INDEX,

      stage:
        RAG_QUERY_STAGE
          .VALIDATE_INPUT,

      message:
        `cycleIndex가 올바르지 않습니다: ${value}`,

      detail:
        'cycleIndex must be a non-negative integer.',

      field:
        'cycleIndex'
    });
  }

  return parsed;
}

function normalizeUserQuery(value) {
  return cleanText(
    value,
    SAFE_USER_QUERY_MAX
  );
}


// ============================================================================
// Engine Facts validation
// ============================================================================

function assertEngineFacts(engineFacts) {
  if (
    !engineFacts ||
    typeof engineFacts !== 'object' ||
    Array.isArray(engineFacts)
  ) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_ENGINE_FACTS,

      stage:
        RAG_QUERY_STAGE
          .VALIDATE_INPUT,

      message:
        'Engine Facts가 없거나 올바른 객체가 아닙니다.',

      detail:
        'Expected Engine Facts v1 object.'
    });
  }

  if (
    engineFacts.schemaVersion !==
    'engine_facts_v1'
  ) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_SCHEMA,

      stage:
        RAG_QUERY_STAGE
          .VALIDATE_INPUT,

      message:
        '지원하지 않는 Engine Facts schemaVersion입니다.',

      detail:
        `received=${engineFacts.schemaVersion || 'missing'}, expected=engine_facts_v1`,

      field:
        'schemaVersion'
    });
  }

  if (
    !engineFacts.natal ||
    !engineFacts.strength ||
    !engineFacts.usefulGodProfile ||
    !engineFacts.tenGodProfile ||
    !engineFacts.relations ||
    !engineFacts.cycles
  ) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_ENGINE_FACTS,

      stage:
        RAG_QUERY_STAGE
          .VALIDATE_INPUT,

      message:
        'RAG Query Builder에 필요한 Engine Facts 핵심 그룹이 누락되었습니다.',

      detail:
        'Required: natal, strength, usefulGodProfile, tenGodProfile, relations, cycles'
    });
  }
}


// ============================================================================
// Fact selectors
// ============================================================================

function selectStrength(engineFacts) {
  const strength =
    safeObject(
      engineFacts.strength
    );

  const band =
    ALLOWED_STRENGTH_BANDS.has(
      strength.band
    )
      ? strength.band
      : null;

  return compactObject({
    band,

    specialStructureCandidate:
      strength
        .specialStructureCandidate
        ?.detected
        ? compactObject({
            detected: true,

            type:
              strength
                .specialStructureCandidate
                .type ||
              null,

            confidence:
              strength
                .specialStructureCandidate
                .confidence ??
              null
          })
        : null,

    methodId:
      strength.methodId ||
      null,

    methodVersion:
      strength.methodVersion ||
      null,

    confidence:
      strength.confidence ??
      null
  });
}

function selectUsefulGodRole(
  usefulGodProfile,
  roleKey
) {
  const raw =
    usefulGodProfile[
      roleKey
    ];

  const role =
    Array.isArray(raw)
      ? raw[0]
      : raw;

  if (
    !role ||
    typeof role !== 'object'
  ) {
    return null;
  }

  return compactObject({
    element:
      ALLOWED_ELEMENTS.has(
        role.element
      )
        ? role.element
        : null,

    tenGodGroup:
      TEN_GOD_GROUPS.includes(
        role.tenGodGroup
      )
        ? role.tenGodGroup
        : null,

    mechanisms:
      uniqueStrings(
        safeArray(
          role.mechanisms
        )
      ),

    need:
      role.need ||
      null,

    currentAvailability:
      role
        .currentAvailability ||
      null,

    confidence:
      role.confidence ??
      null
  });
}

function selectUsefulGodProfile(
  engineFacts
) {
  const profile =
    safeObject(
      engineFacts
        .usefulGodProfile
    );

  const roles = {};

  for (
    const roleKey of
    USEFUL_GOD_ROLE_KEYS
  ) {
    const role =
      selectUsefulGodRole(
        profile,
        roleKey
      );

    if (role) {
      roles[roleKey] =
        role;
    }
  }

  return compactObject({
    dominantImbalance:
      profile
        .dominantImbalance
        ?.type ||
      null,

    dominantImbalanceSeverity:
      profile
        .dominantImbalance
        ?.severity ||
      null,

    climate:
      compactObject({
        coldHeat:
          profile
            .climate
            ?.coldHeat ||
          null,

        dryWet:
          profile
            .climate
            ?.dryWet ||
          null
      }),

    roles,

    methodId:
      profile.methodId ||
      null,

    methodVersion:
      profile.methodVersion ||
      null,

    confidence:
      profile.confidence ??
      null
  });
}

function selectTenGodGroups(
  engineFacts
) {
  const groups =
    safeObject(
      engineFacts
        .tenGodProfile
        ?.groups
    );

  const selected = {};

  for (
    const group of
    TEN_GOD_GROUPS
  ) {
    const item =
      safeObject(
        groups[group]
      );

    if (
      !ALLOWED_TEN_GOD_GROUP_BANDS.has(
        item.strengthBand
      )
    ) {
      continue;
    }

    selected[group] =
      compactObject({
        strengthBand:
          item.strengthBand,

        rooted:
          typeof item.rooted ===
            'boolean'
            ? item.rooted
            : null,

        monthCommandSupport:
          typeof item
            .monthCommandSupport ===
            'boolean'
            ? item
                .monthCommandSupport
            : null
      });
  }

  return selected;
}

function selectDetectedStars(
  engineFacts
) {
  return safeArray(
    engineFacts.stars
  )
    .filter(
      (star) =>
        star &&
        star.detected === true &&
        typeof star.starId ===
          'string'
    )
    .map(
      (star) =>
        compactObject({
          starId:
            star.starId,

          canonicalName:
            star
              .canonicalName ||
            null,

          basisType:
            star
              .basisType ||
            null,

          matchPositions:
            uniqueStrings(
              safeArray(
                star.matches
              )
                .map(
                  (match) =>
                    match?.position
                )
            ),

          methodId:
            star.methodId ||
            null,

          confidence:
            star.confidence ??
            null
        })
    );
}

function selectRelations(
  engineFacts
) {
  const items =
    safeArray(
      engineFacts
        .relations
        ?.items
    );

  const selected =
    items
      .filter(
        (relation) =>
          relation &&
          IMPORTANT_RELATION_TYPES.has(
            relation.relationType
          )
      )
      .map(
        (relation) =>
          compactObject({
            relationId:
              relation
                .relationId ||
              null,

            relationType:
              relation
                .relationType,

            complete:
              typeof relation
                .complete ===
                'boolean'
                ? relation.complete
                : null,

            punishmentType:
              relation
                .punishmentType ||
              null,

            transformation:
              relation
                .transformation
                ? compactObject({
                    status:
                      relation
                        .transformation
                        .status ||
                      null,

                    targetElement:
                      relation
                        .transformation
                        .targetElement ||
                      null,

                    confidence:
                      relation
                        .transformation
                        .confidence ??
                      null
                  })
                : null,

            methodId:
              relation
                .methodId ||
              null
          })
      );

  return {
    dominantRelationId:
      engineFacts
        .relations
        ?.dominantRelationId ??
      null,

    items:
      selected
  };
}

function selectActiveCycle({
  engineFacts,
  cycleType,
  cycleIndex
}) {
  if (
    !cycleType ||
    cycleIndex === null
  ) {
    return null;
  }

  const list =
    engineFacts
      .cycles
      ?.[cycleType];

  if (
    !Array.isArray(list)
  ) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_CYCLE,

      stage:
        RAG_QUERY_STAGE
          .SELECT_CYCLE,

      message:
        `Engine Facts에 cycles.${cycleType} 배열이 없습니다.`,

      detail:
        `cycleType=${cycleType}`
    });
  }

  if (
    cycleIndex >= list.length
  ) {
    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .INVALID_CYCLE_INDEX,

      stage:
        RAG_QUERY_STAGE
          .SELECT_CYCLE,

      message:
        '선택한 cycleIndex가 Engine cycle 범위를 벗어났습니다.',

      detail:
        `cycleType=${cycleType}, cycleIndex=${cycleIndex}, length=${list.length}`
    });
  }

  const cycle =
    safeObject(
      list[cycleIndex]
    );

  if (
    Object.keys(cycle).length ===
    0
  ) {
    return null;
  }

  const natalRelations =
    safeArray(
      cycle
        .relationsWithNatal
    )
      .map(
        (relation) =>
          compactObject({
            relationType:
              relation
                ?.relationType ||
              null,

            complete:
              typeof relation
                ?.complete ===
                'boolean'
                ? relation.complete
                : null,

            transformationStatus:
              relation
                ?.transformation
                ?.status ||
              null,

            targetElement:
              relation
                ?.transformation
                ?.targetElement ||
              null
          })
      )
      .filter(
        (relation) =>
          relation.relationType
      );

  const parentRelations =
    safeArray(
      cycle
        .relationsWithParentCycles
    )
      .map(
        (relation) =>
          compactObject({
            relationType:
              relation
                ?.relationType ||
              null,

            complete:
              typeof relation
                ?.complete ===
                'boolean'
                ? relation.complete
                : null,

            transformationStatus:
              relation
                ?.transformation
                ?.status ||
              null,

            targetElement:
              relation
                ?.transformation
                ?.targetElement ||
              null
          })
      )
      .filter(
        (relation) =>
          relation.relationType
      );

  const balanceEffect =
    cycle
      .balanceImpact
      ?.effect;

  return compactObject({
    cycleType,

    cycleIndex,

    ganzhi:
      cycle.ganzhi ||
      null,

    tenGod:
      compactObject({
        tenGod:
          cycle
            .tenGod
            ?.tenGod ||
          null,

        tenGodKo:
          cycle
            .tenGod
            ?.tenGodKo ||
          null,

        group:
          TEN_GOD_GROUPS.includes(
            cycle
              .tenGod
              ?.group
          )
            ? cycle
                .tenGod
                .group
            : null
      }),

    twelveStage:
      compactObject({
        stage:
          cycle
            .twelveStage
            ?.stage ||
          null,

        stageKey:
          cycle
            .twelveStage
            ?.stageKey ||
          null
      }),

    relationsWithNatal:
      natalRelations,

    relationsWithParentCycles:
      parentRelations,

    usefulGodImpact:
      compactObject({
        yongsinAvailability:
          cycle
            .usefulGodImpact
            ?.yongsinImpact
            ?.availability ||
          null,

        yongsinBlocked:
          typeof cycle
            .usefulGodImpact
            ?.yongsinImpact
            ?.blocked ===
            'boolean'
            ? cycle
                .usefulGodImpact
                .yongsinImpact
                .blocked
            : null,

        yongsinOverloaded:
          typeof cycle
            .usefulGodImpact
            ?.yongsinImpact
            ?.overloaded ===
            'boolean'
            ? cycle
                .usefulGodImpact
                .yongsinImpact
                .overloaded
            : null,

        gisinActivated:
          typeof cycle
            .usefulGodImpact
            ?.gisinImpact
            ?.activated ===
            'boolean'
            ? cycle
                .usefulGodImpact
                .gisinImpact
                .activated
            : null
      }),

    balanceImpact:
      compactObject({
        dominantImbalance:
          cycle
            .balanceImpact
            ?.dominantImbalance ||
          null,

        effect:
          ALLOWED_CYCLE_BALANCE_EFFECTS.has(
            balanceEffect
          )
            ? balanceEffect
            : null,

        confidence:
          cycle
            .balanceImpact
            ?.confidence ??
          null
      }),

    wavePhase:
      cycle.wavePhase ??
      null
  });
}


// ============================================================================
// Search token generation
// ============================================================================

function buildFactTokens({
  domain,
  strength,
  usefulGodProfile,
  tenGodGroups,
  stars,
  relations,
  activeCycle
}) {
  const tokens = [];

  tokens.push(
    `domain=${domain}`
  );

  if (
    strength.band
  ) {
    tokens.push(
      `strength=${strength.band}`
    );
  }

  if (
    usefulGodProfile
      .dominantImbalance
  ) {
    tokens.push(
      `dominantImbalance=${usefulGodProfile.dominantImbalance}`
    );
  }

  if (
    usefulGodProfile
      .dominantImbalanceSeverity
  ) {
    tokens.push(
      `imbalanceSeverity=${usefulGodProfile.dominantImbalanceSeverity}`
    );
  }

  const yongsin =
    usefulGodProfile
      .roles
      ?.yongsin;

  if (
    yongsin?.element
  ) {
    tokens.push(
      `yongsin=${yongsin.element}`
    );
  }

  for (
    const mechanism of
    safeArray(
      yongsin
        ?.mechanisms
    )
  ) {
    tokens.push(
      `mechanism=${mechanism}`
    );
  }

  if (
    yongsin?.need
  ) {
    tokens.push(
      `yongsinNeed=${yongsin.need}`
    );
  }

  if (
    yongsin
      ?.currentAvailability
  ) {
    tokens.push(
      `yongsinAvailability=${yongsin.currentAvailability}`
    );
  }

  for (
    const group of
    TEN_GOD_GROUPS
  ) {
    const band =
      tenGodGroups
        ?.[group]
        ?.strengthBand;

    if (band) {
      tokens.push(
        `${group}=${band}`
      );
    }
  }

  for (
    const star of stars
  ) {
    tokens.push(
      `star=${star.starId}`
    );
  }

  for (
    const relationType of
    uniqueStrings(
      safeArray(
        relations.items
      )
        .map(
          (relation) =>
            relation.relationType
        )
    )
  ) {
    tokens.push(
      `relation=${relationType}`
    );
  }

  if (activeCycle) {
    tokens.push(
      `cycle=${activeCycle.cycleType}`
    );

    if (
      activeCycle
        .tenGod
        ?.group
    ) {
      tokens.push(
        `cycleTenGodGroup=${activeCycle.tenGod.group}`
      );
    }

    if (
      activeCycle
        .twelveStage
        ?.stageKey
    ) {
      tokens.push(
        `twelveStage=${activeCycle.twelveStage.stageKey}`
      );
    }

    if (
      activeCycle
        .balanceImpact
        ?.effect
    ) {
      tokens.push(
        `balanceEffect=${activeCycle.balanceImpact.effect}`
      );
    }

    if (
      activeCycle
        .usefulGodImpact
        ?.yongsinAvailability
    ) {
      tokens.push(
        `cycleYongsinAvailability=${activeCycle.usefulGodImpact.yongsinAvailability}`
      );
    }

    for (
      const relationType of
      uniqueStrings([
        ...safeArray(
          activeCycle
            .relationsWithNatal
        ).map(
          (relation) =>
            relation.relationType
        ),

        ...safeArray(
          activeCycle
            .relationsWithParentCycles
        ).map(
          (relation) =>
            relation.relationType
        )
      ])
    ) {
      tokens.push(
        `cycleRelation=${relationType}`
      );
    }
  }

  return uniqueStrings(
    tokens
  );
}


// ============================================================================
// Generic metadata packet
// ----------------------------------------------------------------------------
// Firebase/Vector DB adapter will later decide which fields become:
// - exact equality filters
// - array-contains / array-contains-any
// - ranking boosts
//
// Query Builder itself remains DB-neutral.
// ============================================================================

function buildMetadataPacket({
  domain,
  strength,
  usefulGodProfile,
  tenGodGroups,
  stars,
  relations,
  activeCycle
}) {
  const yongsin =
    usefulGodProfile
      .roles
      ?.yongsin;

  return compactObject({
    domain,

    strengthBand:
      strength.band ||
      null,

    dominantImbalance:
      usefulGodProfile
        .dominantImbalance ||
      null,

    imbalanceSeverity:
      usefulGodProfile
        .dominantImbalanceSeverity ||
      null,

    yongsinElement:
      yongsin?.element ||
      null,

    yongsinMechanisms:
      uniqueStrings(
        safeArray(
          yongsin
            ?.mechanisms
        )
      ),

    yongsinNeed:
      yongsin?.need ||
      null,

    yongsinAvailability:
      yongsin
        ?.currentAvailability ||
      null,

    tenGodGroupBands:
      Object.fromEntries(
        TEN_GOD_GROUPS
          .map(
            (group) => [
              group,
              tenGodGroups
                ?.[group]
                ?.strengthBand ||
              null
            ]
          )
          .filter(
            ([, band]) =>
              Boolean(band)
          )
      ),

    starIds:
      uniqueStrings(
        stars.map(
          (star) =>
            star.starId
        )
      ),

    relationTypes:
      uniqueStrings(
        safeArray(
          relations.items
        ).map(
          (relation) =>
            relation.relationType
        )
      ),

    cycleType:
      activeCycle
        ?.cycleType ||
      null,

    cycleTenGodGroup:
      activeCycle
        ?.tenGod
        ?.group ||
      null,

    twelveStageKey:
      activeCycle
        ?.twelveStage
        ?.stageKey ||
      null,

    balanceEffect:
      activeCycle
        ?.balanceImpact
        ?.effect ||
      null,

    cycleRelationTypes:
      activeCycle
        ? uniqueStrings([
            ...safeArray(
              activeCycle
                .relationsWithNatal
            ).map(
              (relation) =>
                relation.relationType
            ),

            ...safeArray(
              activeCycle
                .relationsWithParentCycles
            ).map(
              (relation) =>
                relation.relationType
            )
          ])
        : []
  });
}


// ============================================================================
// Retrieval policy
// ----------------------------------------------------------------------------
// hardFilters:
//   문서가 반드시 맞아야 하는 높은 수준의 분류.
//
// softFilters:
//   semantic search / ranking에서 우선순위를 높일 값.
//
// 실제 Firestore 제약에 따라 다음 adapter에서 변환한다.
// ============================================================================

function buildRetrievalPolicy(
  metadata
) {
  const hardFilters = [
    {
      field:
        'domain',

      op:
        'in',

      value:
        metadata.domain ===
          'all'
          ? [
              'all',
              'shared'
            ]
          : [
              metadata.domain,
              'all',
              'shared'
            ]
    }
  ];

  if (
    metadata.cycleType
  ) {
    hardFilters.push({
      field:
        'cycleType',

      op:
        'in',

      value: [
        metadata.cycleType,
        'natal',
        'shared'
      ]
    });
  }

  const softFilters = [];

  const pushSoft =
    (
      field,
      value,
      weight
    ) => {
      if (
        value === null ||
        value === undefined ||
        value === ''
      ) {
        return;
      }

      if (
        Array.isArray(value) &&
        value.length === 0
      ) {
        return;
      }

      softFilters.push({
        field,
        value,
        weight
      });
    };

  pushSoft(
    'strengthBand',
    metadata.strengthBand,
    1.0
  );

  pushSoft(
    'dominantImbalance',
    metadata.dominantImbalance,
    1.0
  );

  pushSoft(
    'yongsinElement',
    metadata.yongsinElement,
    0.85
  );

  pushSoft(
    'yongsinMechanisms',
    metadata.yongsinMechanisms,
    1.0
  );

  pushSoft(
    'tenGodGroupBands',
    metadata.tenGodGroupBands,
    0.9
  );

  pushSoft(
    'starIds',
    metadata.starIds,
    0.55
  );

  pushSoft(
    'relationTypes',
    metadata.relationTypes,
    0.75
  );

  pushSoft(
    'cycleTenGodGroup',
    metadata.cycleTenGodGroup,
    0.75
  );

  pushSoft(
    'twelveStageKey',
    metadata.twelveStageKey,
    0.45
  );

  pushSoft(
    'balanceEffect',
    metadata.balanceEffect,
    0.9
  );

  pushSoft(
    'cycleRelationTypes',
    metadata.cycleRelationTypes,
    0.8
  );

  return {
    hardFilters,
    softFilters,

    rankingPolicy: {
      semanticWeight:
        1.0,

      metadataBoostEnabled:
        true,

      minimumResults:
        4,

      targetResults:
        6,

      maximumResults:
        10
    }
  };
}


// ============================================================================
// Semantic query
// ============================================================================

function buildSemanticQuery({
  tokens,
  userQuery
}) {
  const parts = [
    ...tokens
  ];

  if (userQuery) {
    parts.push(
      `userQuestion=${userQuery}`
    );
  }

  return parts.join(' ');
}


// ============================================================================
// Public Builder
// ============================================================================

export function buildRagQuery(
  engineFacts,
  options = {}
) {
  let stage =
    RAG_QUERY_STAGE
      .VALIDATE_INPUT;

  try {
    assertEngineFacts(
      engineFacts
    );

    const domain =
      normalizeDomain(
        options.domain
      );

    const cycleType =
      normalizeCycleType(
        options.cycleType
      );

    const cycleIndex =
      normalizeCycleIndex(
        options.cycleIndex
      );

    const userQuery =
      normalizeUserQuery(
        options.userQuery
      );

    stage =
      RAG_QUERY_STAGE
        .SELECT_FACTS;

    const strength =
      selectStrength(
        engineFacts
      );

    const usefulGodProfile =
      selectUsefulGodProfile(
        engineFacts
      );

    const tenGodGroups =
      selectTenGodGroups(
        engineFacts
      );

    const stars =
      selectDetectedStars(
        engineFacts
      );

    const relations =
      selectRelations(
        engineFacts
      );

    stage =
      RAG_QUERY_STAGE
        .SELECT_CYCLE;

    const activeCycle =
      selectActiveCycle({
        engineFacts,
        cycleType,
        cycleIndex
      });

    stage =
      RAG_QUERY_STAGE
        .BUILD_QUERY;

    const tokens =
      buildFactTokens({
        domain,
        strength,
        usefulGodProfile,
        tenGodGroups,
        stars,
        relations,
        activeCycle
      });

    const metadata =
      buildMetadataPacket({
        domain,
        strength,
        usefulGodProfile,
        tenGodGroups,
        stars,
        relations,
        activeCycle
      });

    const retrieval =
      buildRetrievalPolicy(
        metadata
      );

    const semanticQuery =
      buildSemanticQuery({
        tokens,
        userQuery
      });

    const result = {
      schemaVersion:
        RAG_QUERY_SCHEMA_VERSION,

      builderVersion:
        RAG_QUERY_BUILDER_VERSION,

      source: {
        schemaVersion:
          engineFacts.schemaVersion,

        engineVersion:
          engineFacts.engineVersion ||
          null,

        factAuthority:
          'SajuGrapEngine'
      },

      context: {
        domain,
        cycleType,
        cycleIndex,
        userQuery:
          userQuery ||
          null
      },

      facts: {
        strength,
        usefulGodProfile,
        tenGodGroups,
        stars,
        relations,
        activeCycle
      },

      query: {
        semanticQuery,
        tokens,
        metadata,

        hardFilters:
          retrieval.hardFilters,

        softFilters:
          retrieval.softFilters,

        rankingPolicy:
          retrieval.rankingPolicy
      },

      policy: {
        recalculateEngineFacts:
          false,

        includeEngineDiagnostics:
          false,

        inferMissingFacts:
          false,

        databaseNeutral:
          true
      }
    };

    stage =
      RAG_QUERY_STAGE
        .VALIDATE_OUTPUT;

    const validation =
      validateRagQuery(
        result
      );

    if (
      !validation.valid
    ) {
      throw new RagQueryBuilderError({
        code:
          RAG_QUERY_ERROR
            .OUTPUT_INVALID,

        stage,

        message:
          '생성된 RAG Query Packet 검증에 실패했습니다.',

        detail:
          validation
            .errors
            .join(', ')
      });
    }

    return result;
  } catch (error) {
    if (
      error instanceof
      RagQueryBuilderError
    ) {
      throw error;
    }

    throw new RagQueryBuilderError({
      code:
        RAG_QUERY_ERROR
          .BUILD_FAILED,

      stage,

      message:
        'RAG Query Builder 실행 중 오류가 발생했습니다.',

      detail:
        error?.message ||
        String(error)
    });
  }
}


// ============================================================================
// Validation
// ============================================================================

export function validateRagQuery(
  packet
) {
  const errors = [];

  if (
    !packet ||
    typeof packet !==
      'object'
  ) {
    return {
      valid:
        false,

      errors: [
        'packet'
      ]
    };
  }

  if (
    packet.schemaVersion !==
    RAG_QUERY_SCHEMA_VERSION
  ) {
    errors.push(
      'schemaVersion'
    );
  }

  if (
    packet.source
      ?.schemaVersion !==
    'engine_facts_v1'
  ) {
    errors.push(
      'source.schemaVersion'
    );
  }

  if (
    !DOMAIN_KEYS.includes(
      packet.context?.domain
    )
  ) {
    errors.push(
      'context.domain'
    );
  }

  if (
    packet.context
      ?.cycleType !==
      null &&
    packet.context
      ?.cycleType !==
      undefined &&
    !CYCLE_KEYS.includes(
      packet.context
        .cycleType
    )
  ) {
    errors.push(
      'context.cycleType'
    );
  }

  if (
    typeof packet
      .query
      ?.semanticQuery !==
      'string'
  ) {
    errors.push(
      'query.semanticQuery'
    );
  }

  if (
    !Array.isArray(
      packet.query
        ?.tokens
    )
  ) {
    errors.push(
      'query.tokens'
    );
  }

  if (
    !packet.query
      ?.metadata ||
    typeof packet
      .query
      .metadata !==
      'object'
  ) {
    errors.push(
      'query.metadata'
    );
  }

  if (
    !Array.isArray(
      packet.query
        ?.hardFilters
    )
  ) {
    errors.push(
      'query.hardFilters'
    );
  }

  if (
    !Array.isArray(
      packet.query
        ?.softFilters
    )
  ) {
    errors.push(
      'query.softFilters'
    );
  }

  if (
    packet.policy
      ?.recalculateEngineFacts !==
      false
  ) {
    errors.push(
      'policy.recalculateEngineFacts'
    );
  }

  if (
    packet.policy
      ?.includeEngineDiagnostics !==
      false
  ) {
    errors.push(
      'policy.includeEngineDiagnostics'
    );
  }

  return {
    valid:
      errors.length === 0,

    errors
  };
}


// ============================================================================
// Compact packet for retrieval logs / debugging
// ----------------------------------------------------------------------------
// 민감한 원국 전체를 로그에 남기지 않고 검색 조건만 확인할 때 사용.
// ============================================================================

export function summarizeRagQuery(
  packet
) {
  if (
    !packet ||
    typeof packet !==
      'object'
  ) {
    return null;
  }

  return {
    schemaVersion:
      packet.schemaVersion,

    builderVersion:
      packet.builderVersion,

    context:
      packet.context,

    semanticQuery:
      packet
        .query
        ?.semanticQuery ||
      '',

    metadata:
      packet
        .query
        ?.metadata ||
      {},

    hardFilters:
      packet
        .query
        ?.hardFilters ||
      [],

    softFilterCount:
      packet
        .query
        ?.softFilters
        ?.length ||
      0
  };
}


// ============================================================================
// Default export
// ============================================================================

export default Object.freeze({
  schemaVersion:
    RAG_QUERY_SCHEMA_VERSION,

  builderVersion:
    RAG_QUERY_BUILDER_VERSION,

  build:
    buildRagQuery,

  validate:
    validateRagQuery,

  summarize:
    summarizeRagQuery
});
