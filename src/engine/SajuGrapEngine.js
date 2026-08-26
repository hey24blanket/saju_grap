// src/engine/SajuGrapEngine.js
// SajuGrap Engine Facts v1
// -----------------------------------------------------------------------------
// Source of Truth: this module is the only place that calculates Saju facts.
// Engine Facts contain structural facts only. User-facing interpretation belongs
// to RAG/LLM. Legacy UI projections are exported separately and MUST NOT be sent
// to RAG/LLM as canonical facts.
// -----------------------------------------------------------------------------

import lunarJavascript from 'lunar-javascript';

const { Solar, Lunar } = lunarJavascript;

export const SCHEMA_VERSION = 'engine_facts_v1';
export const ENGINE_VERSION = '1.0.0';
export const METHOD_VERSION = '1.0.0';

export const METHODS = Object.freeze({
  natal: 'lunar_javascript_eightchar_v1',
  hiddenStems: 'sajugrap_hidden_stems_current_table_v1',
  roots: 'sajugrap_roots_v1',
  exposures: 'sajugrap_exposures_v1',
  elementProfile: 'sajugrap_element_profile_v1',
  strength: 'sajugrap_strength_v1',
  yongshin: 'sajugrap_integrated_yongshin_v1',
  tenGod: 'sajugrap_tengod_daymaster_relation_v1',
  tenGodGroup: 'sajugrap_tengod_group_strength_v1',
  tianYi: 'tianyi_common_stem_lookup_v1',
  wenChang: 'wenchang_common_lookup_v1',
  yiMa: 'yima_triad_lookup_v1',
  peachBlossom: 'peach_blossom_triad_lookup_v1',
  huaGai: 'huagai_triad_lookup_v1',
  yangRen: 'yangren_yang_stems_only_v1',
  kuiGang: 'kuigang_four_daypillars_v1',
  xueTang: 'xuetang_daystem_changsheng_v1',
  stemFiveCombination: 'stem_five_combination_standard_v1',
  sixHarmony: 'branch_six_harmony_standard_v1',
  sixClash: 'branch_six_clash_standard_v1',
  threeHarmony: 'branch_three_harmony_standard_v1',
  seasonalMeeting: 'branch_seasonal_meeting_v1',
  halfHarmony: 'half_harmony_requires_cardinal_v1',
  punishment: 'branch_punishment_v1',
  sixHarm: 'branch_six_harm_v1',
  sixBreak: 'branch_six_break_v1',
  transformation: 'sajugrap_transformation_v1',
  twelveStage: 'sajugrap_12stage_yang_forward_yin_reverse_v1',
  cycle: 'sajugrap_cycle_evaluator_v1',
  climate: 'sajugrap_climate_heuristic_v1',
  dominantImbalance: 'sajugrap_dominant_imbalance_v1',
  legacyWaveProjection: 'sajugrap_legacy_wave_projection_v1'
});

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ELEMENTS = ['wood', 'fire', 'earth', 'metal', 'water'];
const POSITIONS = ['year', 'month', 'day', 'hour'];

const STEM_KO = {
  甲: '갑', 乙: '을', 丙: '병', 丁: '정', 戊: '무',
  己: '기', 庚: '경', 辛: '신', 壬: '임', 癸: '계'
};

const BRANCH_KO = {
  子: '자', 丑: '축', 寅: '인', 卯: '묘', 辰: '진', 巳: '사',
  午: '오', 未: '미', 申: '신', 酉: '유', 戌: '술', 亥: '해'
};

const KO_ELEMENT = {
  wood: '목', fire: '화', earth: '토', metal: '금', water: '수'
};

const ELEMENT_KO_LONG = {
  wood: '나무', fire: '불', earth: '흙', metal: '쇠', water: '물'
};

const STEM_META = {
  甲: { element: 'wood', yinYang: 'yang' },
  乙: { element: 'wood', yinYang: 'yin' },
  丙: { element: 'fire', yinYang: 'yang' },
  丁: { element: 'fire', yinYang: 'yin' },
  戊: { element: 'earth', yinYang: 'yang' },
  己: { element: 'earth', yinYang: 'yin' },
  庚: { element: 'metal', yinYang: 'yang' },
  辛: { element: 'metal', yinYang: 'yin' },
  壬: { element: 'water', yinYang: 'yang' },
  癸: { element: 'water', yinYang: 'yin' }
};

const BRANCH_ELEMENT = {
  子: 'water', 丑: 'earth', 寅: 'wood', 卯: 'wood', 辰: 'earth', 巳: 'fire',
  午: 'fire', 未: 'earth', 申: 'metal', 酉: 'metal', 戌: 'earth', 亥: 'water'
};

// Existing SajuGrap table retained as the v1 internal composition table.
// Engine Facts v1 does not prescribe numeric hidden-stem ratios, so provenance
// is explicitly exposed through METHODS.hiddenStems + METHOD_VERSION.
const HIDDEN_STEMS = {
  子: [{ stem: '壬', weight: 0.30 }, { stem: '癸', weight: 0.70 }],
  丑: [{ stem: '癸', weight: 0.25 }, { stem: '辛', weight: 0.20 }, { stem: '己', weight: 0.55 }],
  寅: [{ stem: '戊', weight: 0.24 }, { stem: '丙', weight: 0.24 }, { stem: '甲', weight: 0.52 }],
  卯: [{ stem: '甲', weight: 0.30 }, { stem: '乙', weight: 0.70 }],
  辰: [{ stem: '乙', weight: 0.30 }, { stem: '癸', weight: 0.10 }, { stem: '戊', weight: 0.60 }],
  巳: [{ stem: '戊', weight: 0.24 }, { stem: '庚', weight: 0.24 }, { stem: '丙', weight: 0.52 }],
  午: [{ stem: '丙', weight: 0.30 }, { stem: '己', weight: 0.20 }, { stem: '丁', weight: 0.50 }],
  未: [{ stem: '丁', weight: 0.30 }, { stem: '乙', weight: 0.10 }, { stem: '己', weight: 0.60 }],
  申: [{ stem: '戊', weight: 0.24 }, { stem: '壬', weight: 0.24 }, { stem: '庚', weight: 0.52 }],
  酉: [{ stem: '庚', weight: 0.30 }, { stem: '辛', weight: 0.70 }],
  戌: [{ stem: '辛', weight: 0.30 }, { stem: '丁', weight: 0.20 }, { stem: '戊', weight: 0.50 }],
  亥: [{ stem: '戊', weight: 0.24 }, { stem: '甲', weight: 0.24 }, { stem: '壬', weight: 0.52 }]
};

const GENERATES = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood'
};

const CONTROLS = {
  wood: 'earth',
  fire: 'metal',
  earth: 'water',
  metal: 'wood',
  water: 'fire'
};

const GENERATED_BY = Object.fromEntries(
  Object.entries(GENERATES).map(([a, b]) => [b, a])
);

const CONTROLLED_BY = Object.fromEntries(
  Object.entries(CONTROLS).map(([a, b]) => [b, a])
);

const TEN_GOD_GROUP_KO = {
  peer: '비겁',
  output: '식상',
  wealth: '재성',
  officer: '관살',
  resource: '인성'
};

const TEN_GOD_NAMES = {
  peer_same: '比肩',
  peer_diff: '劫財',
  output_same: '食神',
  output_diff: '傷官',
  wealth_same: '偏財',
  wealth_diff: '正財',
  officer_same: '偏官',
  officer_diff: '正官',
  resource_same: '偏印',
  resource_diff: '正印'
};

const TEN_GOD_KO = {
  比肩: '비견',
  劫財: '겁재',
  食神: '식신',
  傷官: '상관',
  偏財: '편재',
  正財: '정재',
  偏官: '편관',
  正官: '정관',
  偏印: '편인',
  正印: '정인'
};

const STRENGTH_BANDS = [
  'very_weak',
  'weak',
  'balanced',
  'strong',
  'very_strong'
];

const STRENGTH_UI = {
  very_weak: '신약',
  weak: '중화신약',
  balanced: '중화',
  strong: '중화신강',
  very_strong: '신강'
};

const TWELVE_STAGE_ORDER = [
  { stage: '長生', stageKey: 'changsheng' },
  { stage: '沐浴', stageKey: 'muyu' },
  { stage: '冠帶', stageKey: 'guandai' },
  { stage: '臨官', stageKey: 'linguan', aliases: ['임관', '건록'] },
  { stage: '帝旺', stageKey: 'diwang' },
  { stage: '衰', stageKey: 'shuai' },
  { stage: '病', stageKey: 'bing' },
  { stage: '死', stageKey: 'si' },
  { stage: '墓', stageKey: 'mu' },
  { stage: '絶', stageKey: 'jue' },
  { stage: '胎', stageKey: 'tai' },
  { stage: '養', stageKey: 'yang' }
];

// v1: 양간 순행, 음간 역행.
// 戊 = 丙 정책, 己 = 丁 정책.
const CHANGSHENG_START = {
  甲: '亥',
  乙: '午',
  丙: '寅',
  丁: '酉',
  戊: '寅',
  己: '酉',
  庚: '巳',
  辛: '子',
  壬: '申',
  癸: '卯'
};

const TIAN_YI = {
  甲: ['丑', '未'],
  戊: ['丑', '未'],
  庚: ['丑', '未'],
  乙: ['子', '申'],
  己: ['子', '申'],
  丙: ['亥', '酉'],
  丁: ['亥', '酉'],
  辛: ['寅', '午'],
  壬: ['巳', '卯'],
  癸: ['巳', '卯']
};

const WEN_CHANG = {
  甲: '巳',
  乙: '午',
  丙: '申',
  丁: '酉',
  戊: '申',
  己: '酉',
  庚: '亥',
  辛: '子',
  壬: '寅',
  癸: '卯'
};

const XUE_TANG = {
  甲: '亥',
  乙: '午',
  丙: '寅',
  丁: '酉',
  戊: '寅',
  己: '酉',
  庚: '巳',
  辛: '子',
  壬: '申',
  癸: '卯'
};

const YANG_REN = {
  甲: '卯',
  丙: '午',
  戊: '午',
  庚: '酉',
  壬: '子'
};

const KUI_GANG = new Set([
  '庚辰',
  '庚戌',
  '壬辰',
  '戊戌'
]);

const TRIAD_STAR_RULES = [
  {
    bases: ['寅', '午', '戌'],
    yiMa: '申',
    peach: '卯',
    huaGai: '戌'
  },
  {
    bases: ['申', '子', '辰'],
    yiMa: '寅',
    peach: '酉',
    huaGai: '辰'
  },
  {
    bases: ['巳', '酉', '丑'],
    yiMa: '亥',
    peach: '午',
    huaGai: '丑'
  },
  {
    bases: ['亥', '卯', '未'],
    yiMa: '巳',
    peach: '子',
    huaGai: '未'
  }
];

const STEM_FIVE_COMBINATIONS = [
  { pair: ['甲', '己'], targetElement: 'earth' },
  { pair: ['乙', '庚'], targetElement: 'metal' },
  { pair: ['丙', '辛'], targetElement: 'water' },
  { pair: ['丁', '壬'], targetElement: 'wood' },
  { pair: ['戊', '癸'], targetElement: 'fire' }
];

const SIX_HARMONY = [
  ['子', '丑'],
  ['寅', '亥'],
  ['卯', '戌'],
  ['辰', '酉'],
  ['巳', '申'],
  ['午', '未']
];

const SIX_CLASH = [
  ['子', '午'],
  ['丑', '未'],
  ['寅', '申'],
  ['卯', '酉'],
  ['辰', '戌'],
  ['巳', '亥']
];

const SIX_HARM = [
  ['子', '未'],
  ['丑', '午'],
  ['寅', '巳'],
  ['卯', '辰'],
  ['申', '亥'],
  ['酉', '戌']
];

const SIX_BREAK = [
  ['子', '酉'],
  ['卯', '午'],
  ['辰', '丑'],
  ['巳', '申'],
  ['未', '戌'],
  ['寅', '亥']
];

const THREE_HARMONY = [
  {
    members: ['申', '子', '辰'],
    targetElement: 'water'
  },
  {
    members: ['亥', '卯', '未'],
    targetElement: 'wood'
  },
  {
    members: ['寅', '午', '戌'],
    targetElement: 'fire'
  },
  {
    members: ['巳', '酉', '丑'],
    targetElement: 'metal'
  }
];

const SEASONAL_MEETING = [
  {
    members: ['寅', '卯', '辰'],
    targetElement: 'wood'
  },
  {
    members: ['巳', '午', '未'],
    targetElement: 'fire'
  },
  {
    members: ['申', '酉', '戌'],
    targetElement: 'metal'
  },
  {
    members: ['亥', '子', '丑'],
    targetElement: 'water'
  }
];

const HALF_HARMONY = [
  {
    pair: ['申', '子'],
    targetElement: 'water'
  },
  {
    pair: ['子', '辰'],
    targetElement: 'water'
  },
  {
    pair: ['亥', '卯'],
    targetElement: 'wood'
  },
  {
    pair: ['卯', '未'],
    targetElement: 'wood'
  },
  {
    pair: ['寅', '午'],
    targetElement: 'fire'
  },
  {
    pair: ['午', '戌'],
    targetElement: 'fire'
  },
  {
    pair: ['巳', '酉'],
    targetElement: 'metal'
  },
  {
    pair: ['酉', '丑'],
    targetElement: 'metal'
  }
];

const THREE_PUNISHMENTS = [
  ['寅', '巳', '申'],
  ['丑', '未', '戌']
];

const SELF_PUNISHMENTS = new Set([
  '辰',
  '午',
  '酉',
  '亥'
]);

const POSITION_LABEL_KO = {
  year: '년',
  month: '월',
  day: '일',
  hour: '시',

  year_stem: '년간',
  month_stem: '월간',
  day_stem: '일간',
  hour_stem: '시간',

  year_branch: '년지',
  month_branch: '월지',
  day_branch: '일지',
  hour_branch: '시지'
};


// ============================================================================
// Utility
// ============================================================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function unique(values) {
  return [...new Set(values)];
}

function pairMatches(a, b, pair) {
  return (
    (a === pair[0] && b === pair[1]) ||
    (a === pair[1] && b === pair[0])
  );
}

function parseGanzhi(ganzhi) {
  if (!ganzhi || ganzhi.length < 2) {
    return {
      stem: null,
      branch: null,
      ganzhi: ganzhi || ''
    };
  }

  return {
    stem: ganzhi.charAt(0),
    branch: ganzhi.charAt(1),
    ganzhi
  };
}

function pillarObject(ganzhi) {
  const { stem, branch } = parseGanzhi(ganzhi);

  return {
    stem,
    branch,
    ganzhi,
    stemKo: STEM_KO[stem] || stem,
    branchKo: BRANCH_KO[branch] || branch
  };
}

function normalizeGender(gender) {
  if (
    gender === 'male' ||
    gender === 'M' ||
    gender === 'm' ||
    Number(gender) === 1
  ) {
    return 'male';
  }

  if (
    gender === 'female' ||
    gender === 'F' ||
    gender === 'f' ||
    Number(gender) === 2 ||
    Number(gender) === 0
  ) {
    return 'female';
  }

  return 'male';
}

function parseBirthDateTimeString(value) {
  if (typeof value !== 'string') return null;

  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):?(\d{2})?(?::?(\d{2}))?)?/
  );

  if (!m) return null;

  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 12),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0)
  };
}

function validateDateParts({
  year,
  month,
  day,
  hour,
  minute,
  second
}) {
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999
  ) {
    throw new Error(
      'year must be an integer between 1 and 9999'
    );
  }

  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error(
      'month must be an integer between 1 and 12'
    );
  }

  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    throw new Error(
      'day must be an integer between 1 and 31'
    );
  }

  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    throw new Error(
      'hour must be an integer between 0 and 23'
    );
  }

  if (
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(
      'minute must be an integer between 0 and 59'
    );
  }

  if (
    !Number.isInteger(second) ||
    second < 0 ||
    second > 59
  ) {
    throw new Error(
      'second must be an integer between 0 and 59'
    );
  }
}

function normalizeInput(input = {}) {
  const parsed = parseBirthDateTimeString(
    input.birthDateTime
  );

  const parts = {
    year: Number(
      input.year ?? parsed?.year
    ),
    month: Number(
      input.month ?? parsed?.month
    ),
    day: Number(
      input.day ?? parsed?.day
    ),
    hour: Number(
      input.hour ?? parsed?.hour ?? 12
    ),
    minute: Number(
      input.minute ?? parsed?.minute ?? 0
    ),
    second: Number(
      input.second ?? parsed?.second ?? 0
    )
  };

  validateDateParts(parts);

  const gender = normalizeGender(
    input.gender
  );

  const calendarType =
    input.calendarType === 'lunar'
      ? 'lunar'
      : 'solar';

  const timezone =
    input.timezone ||
    'Asia/Seoul';

  const name =
    typeof input.name === 'string' &&
    input.name.trim()
      ? input.name.trim()
      : '사용자';

  const offset =
    timezone === 'Asia/Seoul'
      ? '+09:00'
      : '';

  return {
    ...parts,
    name,
    gender,
    calendarType,
    timezone,

    birthDateTime:
      `${parts.year}-` +
      `${pad2(parts.month)}-` +
      `${pad2(parts.day)}T` +
      `${pad2(parts.hour)}:` +
      `${pad2(parts.minute)}:` +
      `${pad2(parts.second)}` +
      offset,

    referenceDateTime:
      input.referenceDateTime || null
  };
}

function createCalendarObjects(input) {
  if (input.calendarType === 'lunar') {
    const lunar = Lunar.fromYmdHms(
      input.year,
      input.month,
      input.day,
      input.hour,
      input.minute,
      input.second
    );

    return {
      lunar,
      solar: lunar.getSolar()
    };
  }

  const solar = Solar.fromYmdHms(
    input.year,
    input.month,
    input.day,
    input.hour,
    input.minute,
    input.second
  );

  return {
    solar,
    lunar: solar.getLunar()
  };
}


// ============================================================================
// Ten Gods
// ============================================================================

function getTenGodRelation(
  dayStem,
  targetStem
) {
  const dm = STEM_META[dayStem];
  const target = STEM_META[targetStem];

  if (!dm || !target) {
    return null;
  }

  let group;

  if (
    target.element === dm.element
  ) {
    group = 'peer';
  } else if (
    GENERATES[dm.element] ===
    target.element
  ) {
    group = 'output';
  } else if (
    CONTROLS[dm.element] ===
    target.element
  ) {
    group = 'wealth';
  } else if (
    CONTROLS[target.element] ===
    dm.element
  ) {
    group = 'officer';
  } else {
    group = 'resource';
  }

  const polarityKey =
    target.yinYang === dm.yinYang
      ? 'same'
      : 'diff';

  const tenGod =
    TEN_GOD_NAMES[
      `${group}_${polarityKey}`
    ];

  return {
    tenGod,
    tenGodKo:
      TEN_GOD_KO[tenGod],
    group,
    groupKo:
      TEN_GOD_GROUP_KO[group]
  };
}

function getTenGodGroupForElement(
  dayStem,
  targetElement
) {
  const dm =
    STEM_META[dayStem];

  if (!dm) return null;

  if (
    targetElement === dm.element
  ) {
    return 'peer';
  }

  if (
    GENERATES[dm.element] ===
    targetElement
  ) {
    return 'output';
  }

  if (
    CONTROLS[dm.element] ===
    targetElement
  ) {
    return 'wealth';
  }

  if (
    CONTROLS[targetElement] ===
    dm.element
  ) {
    return 'officer';
  }

  return 'resource';
}


// ============================================================================
// EF-02 Composition
// ============================================================================

function hiddenStemObjects(
  branch,
  branchPosition
) {
  const raw =
    HIDDEN_STEMS[branch] || [];

  const sorted =
    [...raw].sort(
      (a, b) =>
        b.weight - a.weight
    );

  return raw.map((item) => {
    const rank =
      sorted.findIndex(
        (x) =>
          x.stem === item.stem
      );

    const role =
      rank === 0
        ? 'main'
        : (
          raw.length >= 3 &&
          rank === 1
            ? 'middle'
            : 'residual'
        );

    const weightClass =
      rank === 0
        ? 'primary'
        : (
          rank === 1
            ? 'secondary'
            : 'tertiary'
        );

    return {
      branch,
      branchPosition,
      stem: item.stem,
      role,
      weightClass,
      weight: item.weight,

      methodId:
        METHODS.hiddenStems,

      methodVersion:
        METHOD_VERSION
    };
  });
}

function seasonalSupportBand(
  monthBranch,
  element
) {
  const entries =
    HIDDEN_STEMS[
      monthBranch
    ] || [];

  const ratio =
    entries.reduce(
      (sum, x) =>
        sum +
        (
          STEM_META[x.stem]
            ?.element ===
          element
            ? x.weight
            : 0
        ),
      0
    );

  if (ratio >= 0.5) {
    return 'strong';
  }

  if (ratio >= 0.25) {
    return 'moderate';
  }

  if (ratio > 0) {
    return 'weak';
  }

  return 'none';
}

function effectiveElementBand(
  score,
  maxScore
) {
  const ratio =
    maxScore > 0
      ? score / maxScore
      : 0;

  if (ratio >= 0.8) {
    return 'very_strong';
  }

  if (ratio >= 0.6) {
    return 'strong';
  }

  if (ratio >= 0.35) {
    return 'moderate';
  }

  if (ratio >= 0.15) {
    return 'weak';
  }

  return 'very_weak';
}

function buildComposition(
  natal
) {
  const pillars =
    POSITIONS.map(
      (position) => ({
        position,
        ...natal[position]
      })
    );

  const hiddenStems = {};

  for (const p of pillars) {
    hiddenStems[
      `${p.position}Branch`
    ] =
      hiddenStemObjects(
        p.branch,
        p.position
      );
  }

  const roots = [];

  for (
    const visible of pillars
  ) {
    for (
      const branchPillar of pillars
    ) {
      const hidden =
        HIDDEN_STEMS[
          branchPillar.branch
        ] || [];

      const exact =
        hidden.find(
          (x) =>
            x.stem ===
            visible.stem
        );

      const sameElement =
        hidden.filter(
          (x) =>
            STEM_META[x.stem]
              ?.element ===
            STEM_META[
              visible.stem
            ]?.element
        );

      let rootLevel =
        'none';

      if (
        exact?.weight >= 0.5
      ) {
        rootLevel = 'strong';
      } else if (
        exact?.weight >= 0.25
      ) {
        rootLevel =
          'moderate';
      } else if (
        exact ||
        sameElement.length > 0
      ) {
        rootLevel = 'weak';
      }

      roots.push({
        targetStem:
          visible.stem,

        targetPosition:
          visible.position,

        branchPosition:
          branchPillar.position,

        branch:
          branchPillar.branch,

        rootLevel,

        methodId:
          METHODS.roots,

        methodVersion:
          METHOD_VERSION
      });
    }
  }

  const exposures = [];

  for (
    const branchPillar of pillars
  ) {
    for (
      const hidden of
      HIDDEN_STEMS[
        branchPillar.branch
      ] || []
    ) {
      for (
        const visible of pillars
      ) {
        if (
          hidden.stem ===
          visible.stem
        ) {
          exposures.push({
            stem:
              hidden.stem,

            source:
              'hidden_stem',

            sourceBranch:
              branchPillar.branch,

            sourceBranchPosition:
              branchPillar.position,

            visiblePosition:
              visible.position,

            methodId:
              METHODS.exposures,

            methodVersion:
              METHOD_VERSION
          });
        }
      }
    }
  }

  const rawCount =
    Object.fromEntries(
      ELEMENTS.map(
        (e) => [e, 0]
      )
    );

  const effectiveScore =
    Object.fromEntries(
      ELEMENTS.map(
        (e) => [e, 0]
      )
    );

  const branchWeights = {
    year: 10,
    month: 30,
    day: 15,
    hour: 20
  };

  const stemWeights = {
    year: 7,
    month: 9,
    day: 12,
    hour: 9
  };

  for (
    const p of pillars
  ) {
    const stemElement =
      STEM_META[
        p.stem
      ].element;

    const branchElement =
      BRANCH_ELEMENT[
        p.branch
      ];

    rawCount[
      stemElement
    ] += 1;

    rawCount[
      branchElement
    ] += 1;

    effectiveScore[
      stemElement
    ] +=
      stemWeights[
        p.position
      ];

    for (
      const h of
      HIDDEN_STEMS[
        p.branch
      ] || []
    ) {
      effectiveScore[
        STEM_META[
          h.stem
        ].element
      ] +=
        branchWeights[
          p.position
        ] *
        h.weight;
    }
  }

  const maxScore =
    Math.max(
      ...Object.values(
        effectiveScore
      ),
      1
    );

  const elementProfile = {};

  for (
    const element of ELEMENTS
  ) {
    const elementStems =
      STEMS.filter(
        (s) =>
          STEM_META[s]
            .element ===
          element
      );

    const rooted =
      roots.some(
        (r) =>
          elementStems.includes(
            r.targetStem
          ) &&
          r.rootLevel !==
            'none'
      );

    const exposed =
      exposures.some(
        (e) =>
          elementStems.includes(
            e.stem
          )
      );

    elementProfile[
      element
    ] = {
      rawCount:
        rawCount[element],

      seasonalSupport:
        seasonalSupportBand(
          natal.month.branch,
          element
        ),

      rooted,
      exposed,

      effectiveStrength:
        effectiveElementBand(
          effectiveScore[
            element
          ],
          maxScore
        ),

      effectiveScore:
        round(
          effectiveScore[
            element
          ],
          2
        ),

      methodId:
        METHODS.elementProfile,

      methodVersion:
        METHOD_VERSION
    };
  }

  return {
    hiddenStems,
    roots,
    exposures,
    elementProfile
  };
}


// ============================================================================
// EF-05 Ten Gods
// ============================================================================

function buildTenGodProfile(
  natal,
  composition
) {
  const dayStem =
    natal.dayMaster.stem;

  const visible = [];
  const hidden = [];

  for (
    const position of POSITIONS
  ) {
    if (
      position === 'day'
    ) {
      continue;
    }

    const stem =
      natal[
        position
      ].stem;

    const rel =
      getTenGodRelation(
        dayStem,
        stem
      );

    visible.push({
      position:
        `${position}_stem`,

      stem,

      tenGod:
        rel.tenGod,

      tenGodKo:
        rel.tenGodKo,

      group:
        rel.group,

      visible: true,

      methodId:
        METHODS.tenGod,

      methodVersion:
        METHOD_VERSION
    });
  }

  for (
    const position of POSITIONS
  ) {
    const branch =
      natal[
        position
      ].branch;

    for (
      const h of
      HIDDEN_STEMS[
        branch
      ] || []
    ) {
      const rel =
        getTenGodRelation(
          dayStem,
          h.stem
        );

      hidden.push({
        position:
          `${position}_branch_hidden`,

        branch,
        stem:
          h.stem,

        tenGod:
          rel.tenGod,

        tenGodKo:
          rel.tenGodKo,

        group:
          rel.group,

        visible: false,

        weight:
          h.weight,

        methodId:
          METHODS.tenGod,

        methodVersion:
          METHOD_VERSION
      });
    }
  }

  const groupScores = {
    peer: 0,
    output: 0,
    wealth: 0,
    officer: 0,
    resource: 0
  };

  const visibleCounts = {
    peer: 0,
    output: 0,
    wealth: 0,
    officer: 0,
    resource: 0
  };

  const hiddenCounts = {
    peer: 0,
    output: 0,
    wealth: 0,
    officer: 0,
    resource: 0
  };

  for (
    const item of visible
  ) {
    groupScores[
      item.group
    ] += 1;

    visibleCounts[
      item.group
    ] += 1;
  }

  for (
    const item of hidden
  ) {
    groupScores[
      item.group
    ] +=
      item.weight *
      0.85;

    hiddenCounts[
      item.group
    ] += 1;
  }

  // Day Master itself is not emitted as
  // a Ten God item, but it contributes
  // structural peer support.
  groupScores.peer += 0.75;

  const max =
    Math.max(
      ...Object.values(
        groupScores
      ),
      1
    );

  const monthMain =
    [
      ...(
        HIDDEN_STEMS[
          natal.month.branch
        ] || []
      )
    ]
      .sort(
        (a, b) =>
          b.weight -
          a.weight
      )[0]
      ?.stem;

  const monthMainGroup =
    monthMain
      ? getTenGodRelation(
          dayStem,
          monthMain
        )?.group
      : null;

  const groups = {};

  for (
    const group of
    Object.keys(
      groupScores
    )
  ) {
    const ratio =
      groupScores[group] /
      max;

    let strengthBand =
      'very_weak';

    if (ratio >= 0.8) {
      strengthBand =
        'very_strong';
    } else if (
      ratio >= 0.6
    ) {
      strengthBand =
        'strong';
    } else if (
      ratio >= 0.35
    ) {
      strengthBand =
        'moderate';
    } else if (
      ratio >= 0.15
    ) {
      strengthBand =
        'weak';
    }

    groups[group] = {
      strengthBand,

      visibleCount:
        visibleCounts[group],

      hiddenCount:
        hiddenCounts[group],

      rooted:
        hiddenCounts[
          group
        ] > 0,

      monthCommandSupport:
        monthMainGroup ===
        group,

      relativeScore:
        round(
          groupScores[
            group
          ],
          3
        ),

      methodId:
        METHODS.tenGodGroup,

      methodVersion:
        METHOD_VERSION
    };
  }

  return {
    visible,
    hidden,
    groups
  };
}


// ============================================================================
// EF-03 Strength
// ============================================================================

function strengthBandFromScore(
  score
) {
  if (score < 40) {
    return 'very_weak';
  }

  if (score < 46) {
    return 'weak';
  }

  if (score < 51) {
    return 'balanced';
  }

  if (score < 58) {
    return 'strong';
  }

  return 'very_strong';
}

function buildStrength(
  natal,
  composition,
  tenGodProfile
) {
  const dayElement =
    natal.dayMaster.element;

  const supportElements =
    new Set([
      dayElement,
      GENERATED_BY[
        dayElement
      ]
    ]);

  const monthBranch =
    natal.month.branch;

  const dayBranch =
    natal.day.branch;

  const hourBranch =
    natal.hour.branch;

  const yearBranch =
    natal.year.branch;

  const allyRatio =
    (branch) =>
      (
        HIDDEN_STEMS[
          branch
        ] || []
      ).reduce(
        (sum, x) =>
          sum +
          (
            supportElements.has(
              STEM_META[
                x.stem
              ].element
            )
              ? x.weight
              : 0
          ),
        0
      );

  let monthRatio =
    allyRatio(
      monthBranch
    );

  // Existing SajuGrap v1 heuristic retained.
  if (
    dayElement ===
      'fire' &&
    [
      '戌',
      '未'
    ].includes(
      monthBranch
    )
  ) {
    monthRatio =
      Math.max(
        monthRatio,
        0.25
      );
  }

  const deungRyeong =
    Math.round(
      30 *
      monthRatio
    );

  let deungJi =
    Math.round(
      15 *
      allyRatio(
        dayBranch
      )
    );

  const dayStem =
    natal.dayMaster.stem;

  const rokWangDay =
    (
      dayStem === '甲' &&
      dayBranch === '寅'
    ) ||
    (
      dayStem === '乙' &&
      dayBranch === '卯'
    ) ||
    (
      dayStem === '丙' &&
      dayBranch === '午'
    ) ||
    (
      dayStem === '丁' &&
      dayBranch === '巳'
    ) ||
    (
      dayStem === '庚' &&
      dayBranch === '申'
    ) ||
    (
      dayStem === '辛' &&
      dayBranch === '酉'
    ) ||
    (
      dayStem === '壬' &&
      dayBranch === '子'
    ) ||
    (
      dayStem === '癸' &&
      dayBranch === '亥'
    );

  if (rokWangDay) {
    deungJi += 5;
  }

  let deungSe =
    Math.round(
      20 *
      allyRatio(
        hourBranch
      )
    ) +
    Math.round(
      10 *
      allyRatio(
        yearBranch
      )
    );

  const branchList =
    POSITIONS.map(
      (p) =>
        natal[p].branch
    );

  for (
    const position of [
      'month',
      'hour',
      'year'
    ]
  ) {
    const stem =
      natal[
        position
      ].stem;

    const element =
      STEM_META[
        stem
      ].element;

    if (
      !supportElements.has(
        element
      )
    ) {
      continue;
    }

    const base =
      position === 'year'
        ? 7
        : 9;

    const hasRoot =
      branchList.some(
        (b) =>
          (
            HIDDEN_STEMS[
              b
            ] || []
          ).some(
            (h) =>
              STEM_META[
                h.stem
              ].element ===
              element
          )
      );

    deungSe +=
      hasRoot
        ? base
        : Math.round(
            base * 0.6
          );
  }

  const score =
    clamp(
      deungRyeong +
      deungJi +
      deungSe,
      0,
      100
    );

  const band =
    strengthBandFromScore(
      score
    );

  const outputBand =
    tenGodProfile
      .groups
      .output
      .strengthBand;

  const wealthBand =
    tenGodProfile
      .groups
      .wealth
      .strengthBand;

  const officerBand =
    tenGodProfile
      .groups
      .officer
      .strengthBand;

  const drainPressure =
    [
      'strong',
      'very_strong'
    ].includes(
      outputBand
    ) ||
    [
      'strong',
      'very_strong'
    ].includes(
      wealthBand
    );

  const controlPressure =
    [
      'strong',
      'very_strong'
    ].includes(
      officerBand
    );

  const dayStemRoots =
    composition
      .roots
      .filter(
        (r) =>
          r.targetStem ===
            dayStem &&
          r.rootLevel !==
            'none'
      );

  let specialStructureCandidate = {
    detected: false,
    type: null,
    confidence: 0.12,
    evidence: []
  };

  if (
    band === 'very_weak' &&
    dayStemRoots.length === 0
  ) {
    const opposingGroups = [
      'output',
      'wealth',
      'officer'
    ];

    const dominant =
      opposingGroups
        .map(
          (group) => ({
            group,
            score:
              tenGodProfile
                .groups[
                  group
                ]
                .relativeScore
          })
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )[0];

    if (
      dominant &&
      dominant.score >= 1.5
    ) {
      const typeMap = {
        output:
          'follow_output',
        wealth:
          'follow_wealth',
        officer:
          'follow_officer'
      };

      specialStructureCandidate = {
        detected: true,

        type:
          typeMap[
            dominant.group
          ],

        confidence:
          0.55,

        evidence: [
          {
            type:
              'strength_band',
            value:
              'very_weak'
          },
          {
            type:
              'day_master_root',
            value:
              'none'
          },
          {
            type:
              'dominant_ten_god_group',
            value:
              dominant.group
          }
        ]
      };
    }
  }

  return {
    status: band,
    band,
    score,

    factors: {
      season: {
        score:
          deungRyeong,

        maxScore: 30,

        supportRatio:
          round(
            monthRatio,
            3
          )
      },

      root: {
        score:
          deungJi,

        maxScore: 20,

        dayMasterRootCount:
          dayStemRoots.length
      },

      support: {
        score:
          deungSe,

        maxScore: 50
      },

      drain: {
        pressure:
          drainPressure
            ? 'high'
            : 'normal',

        tenGodGroups: {
          output:
            outputBand,

          wealth:
            wealthBand
        }
      },

      control: {
        pressure:
          controlPressure
            ? 'high'
            : 'normal',

        tenGodGroup:
          officerBand
      }
    },

    specialStructureCandidate,

    methodId:
      METHODS.strength,

    methodVersion:
      METHOD_VERSION,

    confidence:
      band ===
        'balanced'
        ? 0.72
        : 0.8,

    evidence: [
      {
        type:
          'seasonal_support',
        value:
          deungRyeong
      },
      {
        type:
          'root',
        value:
          deungJi
      },
      {
        type:
          'support',
        value:
          deungSe
      },
      {
        type:
          'drain_pressure',
        value:
          drainPressure
            ? 'high'
            : 'normal'
      },
      {
        type:
          'control_pressure',
        value:
          controlPressure
            ? 'high'
            : 'normal'
      }
    ]
  };
}


// ============================================================================
// Climate / Dominant Imbalance
// ============================================================================

function buildClimate(
  monthBranch
) {
  let coldHeat =
    'balanced';

  if (
    monthBranch === '子'
  ) {
    coldHeat =
      'very_cold';
  } else if (
    [
      '亥',
      '丑'
    ].includes(
      monthBranch
    )
  ) {
    coldHeat =
      'cold';
  } else if (
    monthBranch === '午'
  ) {
    coldHeat =
      'very_hot';
  } else if (
    [
      '巳',
      '未'
    ].includes(
      monthBranch
    )
  ) {
    coldHeat =
      'hot';
  }

  let dryWet =
    'balanced';

  if (
    [
      '亥',
      '子'
    ].includes(
      monthBranch
    )
  ) {
    dryWet =
      'very_wet';
  } else if (
    [
      '丑',
      '辰'
    ].includes(
      monthBranch
    )
  ) {
    dryWet =
      'wet';
  } else if (
    [
      '巳',
      '午'
    ].includes(
      monthBranch
    )
  ) {
    dryWet =
      'very_dry';
  } else if (
    [
      '未',
      '戌'
    ].includes(
      monthBranch
    )
  ) {
    dryWet =
      'dry';
  }

  return {
    coldHeat,
    dryWet,

    methodId:
      METHODS.climate,

    methodVersion:
      METHOD_VERSION
  };
}

function buildDominantImbalance(
  tenGodProfile
) {
  const ordered =
    Object.entries(
      tenGodProfile.groups
    )
      .map(
        ([group, value]) => ({
          group,
          ...value
        })
      )
      .sort(
        (a, b) =>
          b.relativeScore -
          a.relativeScore
      );

  const top =
    ordered[0];

  const second =
    ordered[1];

  const gap =
    (
      top?.relativeScore ||
      0
    ) -
    (
      second?.relativeScore ||
      0
    );

  const excessType = {
    resource:
      'resource_accumulation_excess',

    peer:
      'peer_concentration_excess',

    output:
      'output_expression_excess',

    wealth:
      'wealth_activation_excess',

    officer:
      'officer_control_excess'
  };

  if (
    !top ||
    ![
      'strong',
      'very_strong'
    ].includes(
      top.strengthBand
    ) ||
    gap < 0.25
  ) {
    return {
      type:
        'balanced_or_mixed_distribution',

      severity:
        'low',

      methodId:
        METHODS.dominantImbalance,

      methodVersion:
        METHOD_VERSION
    };
  }

  return {
    type:
      excessType[
        top.group
      ],

    severity:
      top.strengthBand ===
        'very_strong' &&
      gap >= 0.75
        ? 'high'
        : 'moderate',

    sourceGroup:
      top.group,

    methodId:
      METHODS.dominantImbalance,

    methodVersion:
      METHOD_VERSION
  };
}


// ============================================================================
// EF-04 Useful Gods
// ============================================================================

function availabilityFromElementProfile(
  profile
) {
  if (
    [
      'very_strong',
      'strong'
    ].includes(
      profile
        .effectiveStrength
    )
  ) {
    return 'high';
  }

  if (
    profile
      .effectiveStrength ===
    'moderate'
  ) {
    return 'moderate';
  }

  return 'low';
}

function needFromScore(
  score
) {
  if (score >= 70) {
    return 'high';
  }

  if (score >= 45) {
    return 'moderate';
  }

  return 'low';
}

function buildUsefulGodProfile(
  natal,
  composition,
  strength,
  tenGodProfile
) {
  const dayStem =
    natal.dayMaster.stem;

  const dayElement =
    natal.dayMaster.element;

  const climate =
    buildClimate(
      natal.month.branch
    );

  const dominantImbalance =
    buildDominantImbalance(
      tenGodProfile
    );

  const candidates = [];

  const regulationPreference = {};

  for (
    const element of ELEMENTS
  ) {
    regulationPreference[
      element
    ] = 0;
  }

  if (
    [
      'very_strong',
      'strong'
    ].includes(
      strength.band
    )
  ) {
    // output
    regulationPreference[
      GENERATES[
        dayElement
      ]
    ] += 40;

    // wealth
    regulationPreference[
      CONTROLS[
        dayElement
      ]
    ] += 34;

    // officer
    regulationPreference[
      CONTROLLED_BY[
        dayElement
      ]
    ] += 24;

    // peer
    regulationPreference[
      dayElement
    ] -= 25;

    // resource
    regulationPreference[
      GENERATED_BY[
        dayElement
      ]
    ] -= 32;
  } else if (
    [
      'very_weak',
      'weak'
    ].includes(
      strength.band
    )
  ) {
    // resource
    regulationPreference[
      GENERATED_BY[
        dayElement
      ]
    ] += 42;

    // peer
    regulationPreference[
      dayElement
    ] += 34;

    // output
    regulationPreference[
      GENERATES[
        dayElement
      ]
    ] -= 15;

    // wealth
    regulationPreference[
      CONTROLS[
        dayElement
      ]
    ] -= 24;

    // officer
    regulationPreference[
      CONTROLLED_BY[
        dayElement
      ]
    ] -= 34;
  } else {
    // Balanced:
    // prefer missing/weak elements
    // and circulation.
    for (
      const element of ELEMENTS
    ) {
      const band =
        composition
          .elementProfile[
            element
          ]
          .effectiveStrength;

      regulationPreference[
        element
      ] +=
        band ===
          'very_weak'
          ? 24
          : band ===
              'weak'
            ? 16
            : band ===
                'moderate'
              ? 8
              : 0;
    }

    regulationPreference[
      GENERATES[
        dayElement
      ]
    ] += 10;
  }

  const climatePreference =
    Object.fromEntries(
      ELEMENTS.map(
        (e) => [e, 0]
      )
    );

  if (
    [
      'very_cold',
      'cold'
    ].includes(
      climate.coldHeat
    )
  ) {
    climatePreference.fire +=
      climate.coldHeat ===
        'very_cold'
        ? 28
        : 18;
  }

  if (
    [
      'very_hot',
      'hot'
    ].includes(
      climate.coldHeat
    )
  ) {
    climatePreference.water +=
      climate.coldHeat ===
        'very_hot'
        ? 28
        : 18;
  }

  if (
    [
      'very_dry',
      'dry'
    ].includes(
      climate.dryWet
    )
  ) {
    climatePreference.water +=
      climate.dryWet ===
        'very_dry'
        ? 18
        : 10;
  }

  if (
    [
      'very_wet',
      'wet'
    ].includes(
      climate.dryWet
    )
  ) {
    climatePreference.fire +=
      climate.dryWet ===
        'very_wet'
        ? 18
        : 10;
  }

  for (
    const element of ELEMENTS
  ) {
    const mechanisms = [];

    if (
      regulationPreference[
        element
      ] > 0
    ) {
      mechanisms.push(
        'regulation'
      );
    }

    if (
      climatePreference[
        element
      ] > 0
    ) {
      mechanisms.push(
        'climate'
      );
    }

    if (
      mechanisms.length === 0
    ) {
      mechanisms.push(
        'mixed'
      );
    }

    const currentAvailability =
      availabilityFromElementProfile(
        composition
          .elementProfile[
            element
          ]
      );

    const availabilityPenalty =
      currentAvailability ===
        'high'
        ? 10
        : currentAvailability ===
            'moderate'
          ? 3
          : 0;

    const rawScore =
      50 +
      regulationPreference[
        element
      ] +
      climatePreference[
        element
      ] -
      availabilityPenalty;

    const score =
      clamp(
        Math.round(
          rawScore
        ),
        0,
        100
      );

    candidates.push({
      element,

      tenGodGroup:
        getTenGodGroupForElement(
          dayStem,
          element
        ),

      mechanisms:
        unique(
          mechanisms
        ),

      need:
        needFromScore(
          score
        ),

      currentAvailability,

      score,

      confidence:
        strength
          .specialStructureCandidate
          .detected
          ? 0.64
          : 0.76,

      evidence: [
        {
          type:
            'strength_band',
          value:
            strength.band
        },
        {
          type:
            'climate_cold_heat',
          value:
            climate.coldHeat
        },
        {
          type:
            'climate_dry_wet',
          value:
            climate.dryWet
        },
        {
          type:
            'element_effective_strength',
          element,
          value:
            composition
              .elementProfile[
                element
              ]
              .effectiveStrength
        }
      ]
    });
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const y =
    candidates[0];

  const h =
    candidates[1];

  const coldest =
    [...candidates].sort(
      (a, b) =>
        a.score -
        b.score
    );

  const gi =
    coldest[0];

  const gu =
    coldest[1];

  const used =
    new Set([
      y.element,
      h.element,
      gi.element,
      gu.element
    ]);

  const han =
    candidates.find(
      (x) =>
        !used.has(
          x.element
        )
    ) ||
    candidates[2];

  const roleObject =
    (candidate) => ({
      element:
        candidate.element,

      tenGodGroup:
        candidate.tenGodGroup,

      mechanisms:
        candidate.mechanisms,

      need:
        candidate.need,

      currentAvailability:
        candidate
          .currentAvailability,

      confidence:
        candidate.confidence
    });

  return {
    dominantImbalance,
    climate,
    candidates,

    yongsin:
      roleObject(y),

    heesin: [
      roleObject(h)
    ],

    gisin: [
      roleObject(gi)
    ],

    gusin: [
      roleObject(gu)
    ],

    hansin: [
      roleObject(han)
    ],

    methodId:
      METHODS.yongshin,

    methodVersion:
      METHOD_VERSION,

    confidence:
      strength
        .specialStructureCandidate
        .detected
        ? 0.62
        : 0.76,

    evidence: [
      {
        type:
          'strength',
        value:
          strength.band
      },
      {
        type:
          'dominant_imbalance',
        value:
          dominantImbalance.type
      },
      {
        type:
          'climate',
        coldHeat:
          climate.coldHeat,
        dryWet:
          climate.dryWet
      }
    ]
  };
}


// ============================================================================
// EF-06 Stars
// ============================================================================

function findTriadRule(
  baseBranch
) {
  return (
    TRIAD_STAR_RULES.find(
      (rule) =>
        rule.bases.includes(
          baseBranch
        )
    )
  );
}

function branchPositions(
  natal
) {
  return POSITIONS.map(
    (position) => ({
      position,
      branch:
        natal[
          position
        ].branch
    })
  );
}

function buildLookupStar({
  starId,
  canonicalName,

  primaryBasisType,
  primaryBasisValue,

  secondaryBasisType = null,
  secondaryBasisValue = null,

  targets = [],

  methodId,
  confidence = 1.0,

  natal
}) {
  const positions =
    branchPositions(
      natal
    );

  const matches = [];

  const addMatches = (
    basisType,
    basisValue,
    targetBranches
  ) => {
    for (
      const p of positions
    ) {
      if (
        targetBranches.includes(
          p.branch
        )
      ) {
        matches.push({
          basisType,
          basisValue,

          position:
            p.position,

          branch:
            p.branch
        });
      }
    }
  };

  addMatches(
    primaryBasisType,
    primaryBasisValue,
    targets[0] || []
  );

  if (
    secondaryBasisType &&
    secondaryBasisValue
  ) {
    addMatches(
      secondaryBasisType,
      secondaryBasisValue,
      targets[1] || []
    );
  }

  return {
    starId,
    canonicalName,

    detected:
      matches.length > 0,

    basisType:
      primaryBasisType,

    basisValue:
      primaryBasisValue,

    secondaryBasis:
      secondaryBasisType
        ? {
            basisType:
              secondaryBasisType,

            basisValue:
              secondaryBasisValue
          }
        : null,

    matches,

    methodId,
    methodVersion:
      METHOD_VERSION,

    confidence
  };
}

function buildStars(
  natal
) {
  const dayStem =
    natal.day.stem;

  const yearStem =
    natal.year.stem;

  const dayBranch =
    natal.day.branch;

  const yearBranch =
    natal.year.branch;

  const dayTriad =
    findTriadRule(
      dayBranch
    );

  const yearTriad =
    findTriadRule(
      yearBranch
    );

  const stars = [];

  // 천을귀인
  stars.push(
    buildLookupStar({
      starId:
        'TIAN_YI',

      canonicalName:
        '천을귀인',

      primaryBasisType:
        'day_stem',

      primaryBasisValue:
        dayStem,

      secondaryBasisType:
        'year_stem',

      secondaryBasisValue:
        yearStem,

      targets: [
        TIAN_YI[
          dayStem
        ] || [],

        TIAN_YI[
          yearStem
        ] || []
      ],

      methodId:
        METHODS.tianYi,

      natal
    })
  );

  // 문창귀인
  stars.push(
    buildLookupStar({
      starId:
        'WEN_CHANG',

      canonicalName:
        '문창귀인',

      primaryBasisType:
        'day_stem',

      primaryBasisValue:
        dayStem,

      secondaryBasisType:
        'year_stem',

      secondaryBasisValue:
        yearStem,

      targets: [
        [
          WEN_CHANG[
            dayStem
          ]
        ].filter(Boolean),

        [
          WEN_CHANG[
            yearStem
          ]
        ].filter(Boolean)
      ],

      methodId:
        METHODS.wenChang,

      natal
    })
  );

  // 역마
  stars.push(
    buildLookupStar({
      starId:
        'YIMA',

      canonicalName:
        '역마',

      primaryBasisType:
        'day_branch',

      primaryBasisValue:
        dayBranch,

      secondaryBasisType:
        'year_branch',

      secondaryBasisValue:
        yearBranch,

      targets: [
        [
          dayTriad?.yiMa
        ].filter(Boolean),

        [
          yearTriad?.yiMa
        ].filter(Boolean)
      ],

      methodId:
        METHODS.yiMa,

      natal
    })
  );

  // 도화
  stars.push(
    buildLookupStar({
      starId:
        'PEACH_BLOSSOM',

      canonicalName:
        '도화',

      primaryBasisType:
        'day_branch',

      primaryBasisValue:
        dayBranch,

      secondaryBasisType:
        'year_branch',

      secondaryBasisValue:
        yearBranch,

      targets: [
        [
          dayTriad?.peach
        ].filter(Boolean),

        [
          yearTriad?.peach
        ].filter(Boolean)
      ],

      methodId:
        METHODS.peachBlossom,

      natal
    })
  );

  // 화개
  stars.push(
    buildLookupStar({
      starId:
        'HUA_GAI',

      canonicalName:
        '화개',

      primaryBasisType:
        'day_branch',

      primaryBasisValue:
        dayBranch,

      secondaryBasisType:
        'year_branch',

      secondaryBasisValue:
        yearBranch,

      targets: [
        [
          dayTriad?.huaGai
        ].filter(Boolean),

        [
          yearTriad?.huaGai
        ].filter(Boolean)
      ],

      methodId:
        METHODS.huaGai,

      natal
    })
  );

  // 양인: 양간 5개만
  stars.push(
    buildLookupStar({
      starId:
        'YANG_REN',

      canonicalName:
        '양인',

      primaryBasisType:
        'day_stem',

      primaryBasisValue:
        dayStem,

      targets: [
        [
          YANG_REN[
            dayStem
          ]
        ].filter(Boolean)
      ],

      methodId:
        METHODS.yangRen,

      natal
    })
  );

  // 괴강: 일주만
  const dayPillar =
    natal.day.ganzhi;

  stars.push({
    starId:
      'KUI_GANG',

    canonicalName:
      '괴강',

    detected:
      KUI_GANG.has(
        dayPillar
      ),

    basisType:
      'day_pillar',

    basisValue:
      dayPillar,

    matches:
      KUI_GANG.has(
        dayPillar
      )
        ? [
            {
              position:
                'day',

              ganzhi:
                dayPillar
            }
          ]
        : [],

    methodId:
      METHODS.kuiGang,

    methodVersion:
      METHOD_VERSION,

    confidence:
      1.0
  });

  // 학당귀인
  stars.push(
    buildLookupStar({
      starId:
        'XUE_TANG',

      canonicalName:
        '학당귀인',

      primaryBasisType:
        'day_stem',

      primaryBasisValue:
        dayStem,

      targets: [
        [
          XUE_TANG[
            dayStem
          ]
        ].filter(Boolean)
      ],

      methodId:
        METHODS.xueTang,

      confidence:
        0.7,

      natal
    })
  );

  return stars;
}


// ============================================================================
// EF-07 Relations
// ============================================================================

function relationMember(
  position,
  value
) {
  return {
    position,
    value
  };
}

function makeTransformation(
  status = 'none',
  targetElement = null,
  confidence = null
) {
  return {
    status,
    targetElement,
    confidence,

    methodId:
      METHODS.transformation,

    methodVersion:
      METHOD_VERSION
  };
}

function buildRelationsFromPositions(
  stemPositions,
  branchPositionsInput
) {
  const raw = [];

  // 천간 오합
  for (
    let i = 0;
    i < stemPositions.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < stemPositions.length;
      j++
    ) {
      const a =
        stemPositions[i];

      const b =
        stemPositions[j];

      const combo =
        STEM_FIVE_COMBINATIONS.find(
          (x) =>
            pairMatches(
              a.value,
              b.value,
              x.pair
            )
        );

      if (combo) {
        raw.push({
          relationType:
            'stem_five_combination',

          members: [
            relationMember(
              a.position,
              a.value
            ),
            relationMember(
              b.position,
              b.value
            )
          ],

          complete: true,

          transformation:
            makeTransformation(
              'candidate',
              combo.targetElement,
              0.55
            ),

          methodId:
            METHODS
              .stemFiveCombination,

          methodVersion:
            METHOD_VERSION
        });
      }
    }
  }

  // 지지 pair relations
  for (
    let i = 0;
    i <
    branchPositionsInput.length;
    i++
  ) {
    for (
      let j = i + 1;
      j <
      branchPositionsInput.length;
      j++
    ) {
      const a =
        branchPositionsInput[i];

      const b =
        branchPositionsInput[j];

      const memberPair = [
        relationMember(
          a.position,
          a.value
        ),
        relationMember(
          b.position,
          b.value
        )
      ];

      // 육합
      if (
        SIX_HARMONY.some(
          (pair) =>
            pairMatches(
              a.value,
              b.value,
              pair
            )
        )
      ) {
        raw.push({
          relationType:
            'branch_six_harmony',

          members:
            memberPair,

          complete: true,

          transformation:
            makeTransformation(),

          methodId:
            METHODS.sixHarmony,

          methodVersion:
            METHOD_VERSION
        });
      }

      // 육충
      if (
        SIX_CLASH.some(
          (pair) =>
            pairMatches(
              a.value,
              b.value,
              pair
            )
        )
      ) {
        raw.push({
          relationType:
            'branch_clash',

          members:
            memberPair,

          complete: true,

          transformation:
            makeTransformation(),

          methodId:
            METHODS.sixClash,

          methodVersion:
            METHOD_VERSION
        });
      }

      // 육해
      if (
        SIX_HARM.some(
          (pair) =>
            pairMatches(
              a.value,
              b.value,
              pair
            )
        )
      ) {
        raw.push({
          relationType:
            'branch_harm',

          members:
            memberPair,

          complete: true,

          transformation:
            makeTransformation(),

          methodId:
            METHODS.sixHarm,

          methodVersion:
            METHOD_VERSION
        });
      }

      // 육파
      if (
        SIX_BREAK.some(
          (pair) =>
            pairMatches(
              a.value,
              b.value,
              pair
            )
        )
      ) {
        raw.push({
          relationType:
            'branch_break',

          members:
            memberPair,

          complete: true,

          transformation:
            makeTransformation(),

          methodId:
            METHODS.sixBreak,

          methodVersion:
            METHOD_VERSION
        });
      }

      // 반합: 왕지 포함 조합만
      const half =
        HALF_HARMONY.find(
          (x) =>
            pairMatches(
              a.value,
              b.value,
              x.pair
            )
        );

      if (half) {
        raw.push({
          relationType:
            'half_harmony',

          members:
            memberPair,

          complete: true,

          transformation:
            makeTransformation(
              'partial',
              half.targetElement,
              0.5
            ),

          methodId:
            METHODS.halfHarmony,

          methodVersion:
            METHOD_VERSION
        });
      }

      // 子卯형
      if (
        pairMatches(
          a.value,
          b.value,
          ['子', '卯']
        )
      ) {
        raw.push({
          relationType:
            'branch_punishment',

          punishmentType:
            'mutual_punishment',

          members:
            memberPair,

          complete: true,

          directional: false,

          transformation:
            makeTransformation(),

          methodId:
            METHODS.punishment,

          methodVersion:
            METHOD_VERSION
        });
      }

      // 자형
      if (
        a.value === b.value &&
        SELF_PUNISHMENTS.has(
          a.value
        )
      ) {
        raw.push({
          relationType:
            'branch_punishment',

          punishmentType:
            'self_punishment',

          members:
            memberPair,

          complete: true,

          directional: false,

          transformation:
            makeTransformation(),

          methodId:
            METHODS.punishment,

          methodVersion:
            METHOD_VERSION
        });
      }
    }
  }

  const branchValues =
    branchPositionsInput.map(
      (x) => x.value
    );

  // 삼합
  for (
    const rule of
    THREE_HARMONY
  ) {
    if (
      rule.members.every(
        (m) =>
          branchValues.includes(
            m
          )
      )
    ) {
      raw.push({
        relationType:
          'branch_three_harmony',

        members:
          rule.members.map(
            (value) =>
              relationMember(
                branchPositionsInput
                  .find(
                    (x) =>
                      x.value ===
                      value
                  )
                  .position,

                value
              )
          ),

        complete:
          true,

        transformation:
          makeTransformation(
            'candidate',
            rule.targetElement,
            0.62
          ),

        methodId:
          METHODS.threeHarmony,

        methodVersion:
          METHOD_VERSION
      });
    }
  }

  // 삼회
  for (
    const rule of
    SEASONAL_MEETING
  ) {
    if (
      rule.members.every(
        (m) =>
          branchValues.includes(
            m
          )
      )
    ) {
      raw.push({
        relationType:
          'branch_seasonal_meeting',

        members:
          rule.members.map(
            (value) =>
              relationMember(
                branchPositionsInput
                  .find(
                    (x) =>
                      x.value ===
                      value
                  )
                  .position,

                value
              )
          ),

        complete:
          true,

        transformation:
          makeTransformation(
            'candidate',
            rule.targetElement,
            0.62
          ),

        methodId:
          METHODS
            .seasonalMeeting,

        methodVersion:
          METHOD_VERSION
      });
    }
  }

  // 寅巳申 / 丑未戌 형
  for (
    const trio of
    THREE_PUNISHMENTS
  ) {
    const present =
      trio.filter(
        (m) =>
          branchValues.includes(
            m
          )
      );

    if (
      present.length === 3
    ) {
      raw.push({
        relationType:
          'branch_punishment',

        punishmentType:
          'three_punishment',

        members:
          present.map(
            (value) =>
              relationMember(
                branchPositionsInput
                  .find(
                    (x) =>
                      x.value ===
                      value
                  )
                  .position,

                value
              )
          ),

        complete:
          true,

        directional:
          false,

        transformation:
          makeTransformation(),

        methodId:
          METHODS.punishment,

        methodVersion:
          METHOD_VERSION
      });
    } else if (
      present.length === 2
    ) {
      raw.push({
        relationType:
          'branch_punishment',

        punishmentType:
          'three_punishment',

        members:
          present.map(
            (value) =>
              relationMember(
                branchPositionsInput
                  .find(
                    (x) =>
                      x.value ===
                      value
                  )
                  .position,

                value
              )
          ),

        complete:
          false,

        directional:
          false,

        transformation:
          makeTransformation(),

        methodId:
          METHODS.punishment,

        methodVersion:
          METHOD_VERSION
      });
    }
  }

  return raw.map(
    (
      relation,
      index
    ) => ({
      relationId:
        `REL-${String(
          index + 1
        ).padStart(
          3,
          '0'
        )}`,

      ...relation
    })
  );
}

function buildRelations(
  natal
) {
  const stems =
    POSITIONS.map(
      (position) => ({
        position:
          `${position}_stem`,

        value:
          natal[
            position
          ].stem
      })
    );

  const branches =
    POSITIONS.map(
      (position) => ({
        position:
          `${position}_branch`,

        value:
          natal[
            position
          ].branch
      })
    );

  const items =
    buildRelationsFromPositions(
      stems,
      branches
    );

  return {
    items,

    dominantRelationId:
      null,

    confidence:
      null
  };
}


// ============================================================================
// 12운성
// ============================================================================

function getTwelveStage(
  dayStem,
  branch
) {
  const meta =
    STEM_META[
      dayStem
    ];

  const startBranch =
    CHANGSHENG_START[
      dayStem
    ];

  const startIndex =
    BRANCHES.indexOf(
      startBranch
    );

  const branchIndex =
    BRANCHES.indexOf(
      branch
    );

  if (
    !meta ||
    startIndex < 0 ||
    branchIndex < 0
  ) {
    return null;
  }

  const offset =
    meta.yinYang ===
      'yang'
      ? (
          branchIndex -
          startIndex +
          12
        ) % 12
      : (
          startIndex -
          branchIndex +
          12
        ) % 12;

  const stage =
    TWELVE_STAGE_ORDER[
      offset
    ];

  return {
    stage:
      stage.stage,

    stageKey:
      stage.stageKey,

    aliases:
      stage.aliases || [],

    methodId:
      METHODS.twelveStage,

    tableVersion:
      METHOD_VERSION,

    yinDirectionPolicy:
      'reverse',

    earthStemPolicy:
      'wu_like_bing_ji_like_ding'
  };
}


// ============================================================================
// EF-08 Cycle Relations
// ============================================================================

function cycleRelationsWithNatal(
  cycleStem,
  cycleBranch,
  natal
) {
  const stems = [
    ...POSITIONS.map(
      (position) => ({
        position:
          `natal_${position}_stem`,

        value:
          natal[
            position
          ].stem
      })
    ),

    {
      position:
        'cycle_stem',

      value:
        cycleStem
    }
  ];

  const branches = [
    ...POSITIONS.map(
      (position) => ({
        position:
          `natal_${position}_branch`,

        value:
          natal[
            position
          ].branch
      })
    ),

    {
      position:
        'cycle_branch',

      value:
        cycleBranch
    }
  ];

  return (
    buildRelationsFromPositions(
      stems,
      branches
    )
      .filter(
        (r) =>
          r.members.some(
            (m) =>
              String(
                m.position
              ).startsWith(
                'cycle_'
              )
          )
      )
      .map(
        (
          r,
          index
        ) => ({
          ...r,

          relationId:
            `CNR-${String(
              index + 1
            ).padStart(
              3,
              '0'
            )}`
        })
      )
  );
}

function cycleRelationsWithParents(
  cycleStem,
  cycleBranch,
  parentCycles = []
) {
  if (
    !parentCycles.length
  ) {
    return [];
  }

  const stems = [
    {
      position:
        'cycle_stem',

      value:
        cycleStem
    }
  ];

  const branches = [
    {
      position:
        'cycle_branch',

      value:
        cycleBranch
    }
  ];

  parentCycles.forEach(
    (p, i) => {
      stems.push({
        position:
          `parent_${i + 1}_stem`,

        value:
          p.stem
      });

      branches.push({
        position:
          `parent_${i + 1}_branch`,

        value:
          p.branch
      });
    }
  );

  return (
    buildRelationsFromPositions(
      stems,
      branches
    )
      .filter(
        (r) =>
          r.members.some(
            (m) =>
              String(
                m.position
              ).startsWith(
                'cycle_'
              )
          ) &&
          r.members.some(
            (m) =>
              String(
                m.position
              ).startsWith(
                'parent_'
              )
          )
      )
      .map(
        (
          r,
          index
        ) => ({
          ...r,

          relationId:
            `CPR-${String(
              index + 1
            ).padStart(
              3,
              '0'
            )}`
        })
      )
  );
}


// ============================================================================
// EF-08 Cycle useful-god impact
// ============================================================================

function evaluateUsefulGodImpact(
  stem,
  branch,
  usefulGodProfile
) {
  const stemElement =
    STEM_META[
      stem
    ]?.element;

  const branchElement =
    BRANCH_ELEMENT[
      branch
    ];

  const yongsinElement =
    usefulGodProfile
      .yongsin
      ?.element;

  const gisinElements =
    new Set(
      (
        usefulGodProfile
          .gisin || []
      ).map(
        (x) =>
          x.element
      )
    );

  const yongsinActive =
    stemElement ===
      yongsinElement ||
    branchElement ===
      yongsinElement;

  const gisinActive =
    gisinElements.has(
      stemElement
    ) ||
    gisinElements.has(
      branchElement
    );

  return {
    yongsinImpact: {
      availability:
        yongsinActive
          ? 'increased'
          : 'unchanged',

      blocked:
        false,

      overloaded:
        yongsinActive &&
        stemElement ===
          yongsinElement &&
        branchElement ===
          yongsinElement
    },

    gisinImpact: {
      activated:
        gisinActive
    }
  };
}

function evaluateBalanceImpact(
  usefulGodImpact,
  usefulGodProfile
) {
  const y =
    usefulGodImpact
      .yongsinImpact
      .availability ===
    'increased';

  const g =
    usefulGodImpact
      .gisinImpact
      .activated;

  let effect =
    'neutral';

  if (
    y &&
    g
  ) {
    effect =
      'mixed';
  } else if (y) {
    effect =
      'relieves';
  } else if (g) {
    effect =
      'aggravates';
  }

  return {
    dominantImbalance:
      usefulGodProfile
        .dominantImbalance
        .type,

    effect,

    confidence:
      effect ===
        'neutral'
        ? 0.62
        : 0.72
  };
}


// ============================================================================
// Common Cycle Evaluator
// ============================================================================

function evaluateCycle({
  natal,
  usefulGodProfile,

  parentCycles = [],

  stem,
  branch,

  cycleType,
  ganzhi,

  extra = {}
}) {
  const tenGod =
    getTenGodRelation(
      natal.dayMaster.stem,
      stem
    );

  const hiddenTenGods =
    (
      HIDDEN_STEMS[
        branch
      ] || []
    ).map(
      (h) => ({
        stem:
          h.stem,

        weight:
          h.weight,

        ...getTenGodRelation(
          natal.dayMaster.stem,
          h.stem
        )
      })
    );

  const usefulGodImpact =
    evaluateUsefulGodImpact(
      stem,
      branch,
      usefulGodProfile
    );

  return {
    cycleType,

    ganzhi:
      ganzhi ||
      `${stem}${branch}`,

    stem,
    branch,

    tenGod: {
      stem,

      tenGod:
        tenGod.tenGod,

      tenGodKo:
        tenGod.tenGodKo,

      group:
        tenGod.group
    },

    hiddenTenGods,

    twelveStage:
      getTwelveStage(
        natal.dayMaster.stem,
        branch
      ),

    relationsWithNatal:
      cycleRelationsWithNatal(
        stem,
        branch,
        natal
      ),

    relationsWithParentCycles:
      cycleRelationsWithParents(
        stem,
        branch,
        parentCycles
      ),

    usefulGodImpact,

    balanceImpact:
      evaluateBalanceImpact(
        usefulGodImpact,
        usefulGodProfile
      ),

    // Engine Facts does not directly
    // convert 12운성 into Wave Score.
    wavePhase:
      null,

    methodId:
      METHODS.cycle,

    methodVersion:
      METHOD_VERSION,

    ...extra
  };
}


// ============================================================================
// Calendar Point Resolver
// ============================================================================

function solarEightCharAt(
  year,
  month,
  day,
  hour = 12,
  minute = 0
) {
  const solar =
    Solar.fromYmdHms(
      year,
      month,
      day,
      hour,
      minute,
      0
    );

  const eightChar =
    solar
      .getLunar()
      .getEightChar();

  return {
    solar,
    eightChar,

    year:
      parseGanzhi(
        eightChar.getYear()
      ),

    month:
      parseGanzhi(
        eightChar.getMonth()
      ),

    day:
      parseGanzhi(
        eightChar.getDay()
      ),

    hour:
      parseGanzhi(
        eightChar.getTime()
      )
  };
}

function resolveReferenceParts(
  input
) {
  const parsed =
    parseBirthDateTimeString(
      input.referenceDateTime
    );

  if (parsed) {
    return parsed;
  }

  const now =
    new Date();

  try {
    const parts =
      new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone:
            input.timezone ||
            'Asia/Seoul',

          year:
            'numeric',

          month:
            '2-digit',

          day:
            '2-digit',

          hour:
            '2-digit',

          minute:
            '2-digit',

          second:
            '2-digit',

          hourCycle:
            'h23'
        }
      ).formatToParts(
        now
      );

    const value =
      (type) =>
        Number(
          parts.find(
            (p) =>
              p.type ===
              type
          )?.value
        );

    return {
      year:
        value('year'),

      month:
        value('month'),

      day:
        value('day'),

      hour:
        value('hour'),

      minute:
        value('minute'),

      second:
        value('second')
    };
  } catch {
    return {
      year:
        now.getUTCFullYear(),

      month:
        now.getUTCMonth() +
        1,

      day:
        now.getUTCDate(),

      hour:
        now.getUTCHours(),

      minute:
        now.getUTCMinutes(),

      second:
        now.getUTCSeconds()
    };
  }
}

function solarDateString(
  solar
) {
  if (!solar) {
    return null;
  }

  return (
    `${solar.getYear()}-` +
    `${pad2(
      solar.getMonth()
    )}-` +
    `${pad2(
      solar.getDay()
    )}`
  );
}

function findParentDaewoonForYear(
  daewoon,
  year
) {
  return (
    daewoon.find(
      (x) =>
        Number.isFinite(
          x.startYear
        ) &&
        Number.isFinite(
          x.endYear
        ) &&
        year >=
          x.startYear &&
        year <=
          x.endYear
    ) ||
    null
  );
}


// ============================================================================
// EF-08 Cycles
// ============================================================================

function buildCycles(
  eightChar,
  input,
  natal,
  usefulGodProfile
) {
  const genderCode =
    input.gender ===
      'male'
      ? 1
      : 0;

  const yun =
    eightChar.getYun(
      genderCode
    );

  const daYunList =
    yun.getDaYun();

  const daewoon = [];

  for (
    let i = 1;
    i <
    Math.min(
      9,
      daYunList.length
    );
    i++
  ) {
    const d =
      daYunList[i];

    const ganzhi =
      d.getGanZhi();

    if (
      !ganzhi ||
      ganzhi.length < 2
    ) {
      continue;
    }

    const {
      stem,
      branch
    } =
      parseGanzhi(
        ganzhi
      );

    const startYear =
      Number(
        d.getStartYear()
      );

    const startAge =
      Number(
        d.getStartAge()
      );

    const endAge =
      typeof d.getEndAge ===
        'function'
        ? Number(
            d.getEndAge()
          )
        : startAge + 9;

    const endYear =
      typeof d.getEndYear ===
        'function'
        ? Number(
            d.getEndYear()
          )
        : startYear + 9;

    daewoon.push(
      evaluateCycle({
        natal,
        usefulGodProfile,

        stem,
        branch,
        ganzhi,

        cycleType:
          'daewoon',

        extra: {
          index:
            i,

          startYear,
          endYear,

          ageRange: {
            start:
              startAge,

            end:
              endAge
          }
        }
      })
    );
  }

  const ref =
    resolveReferenceParts(
      input
    );

  // --------------------------------------------------------------------------
  // Year cycles
  // --------------------------------------------------------------------------

  const yearCycles = [];

  for (
    let year =
      ref.year - 4;
    year <=
      ref.year + 5;
    year++
  ) {
    // Date after Ipchun resolves
    // the Bazi year pillar.
    const point =
      solarEightCharAt(
        year,
        2,
        15,
        12,
        0
      );

    const previousJie =
      point
        .solar
        .getLunar()
        .getPrevJie();

    const parent =
      findParentDaewoonForYear(
        daewoon,
        year
      );

    yearCycles.push(
      evaluateCycle({
        natal,
        usefulGodProfile,

        parentCycles:
          parent
            ? [parent]
            : [],

        stem:
          point.year.stem,

        branch:
          point.year.branch,

        ganzhi:
          point.year.ganzhi,

        cycleType:
          'year',

        extra: {
          year,

          referenceSolarDate:
            `${year}-02-15`,

          startSolarDate:
            solarDateString(
              previousJie
                ?.getSolar?.()
            ),

          boundaryPolicy:
            'jie_boundary'
        }
      })
    );
  }

  const selectedYear =
    yearCycles.find(
      (x) =>
        x.year ===
        ref.year
    ) ||
    yearCycles[4];

  // --------------------------------------------------------------------------
  // Month cycles
  // --------------------------------------------------------------------------

  const monthCycles = [];

  for (
    let month = 1;
    month <= 12;
    month++
  ) {
    // The 15th safely identifies the current
    // solar-term month. Actual start boundary
    // is obtained from getPrevJie().
    const point =
      solarEightCharAt(
        ref.year,
        month,
        15,
        12,
        0
      );

    const previousJie =
      point
        .solar
        .getLunar()
        .getPrevJie();

    const parentDaewoon =
      findParentDaewoonForYear(
        daewoon,
        ref.year
      );

    monthCycles.push(
      evaluateCycle({
        natal,
        usefulGodProfile,

        parentCycles: [
          parentDaewoon,
          selectedYear
        ].filter(Boolean),

        stem:
          point.month.stem,

        branch:
          point.month.branch,

        ganzhi:
          point.month.ganzhi,

        cycleType:
          'month',

        extra: {
          year:
            ref.year,

          month,

          referenceSolarDate:
            `${ref.year}-` +
            `${pad2(month)}-15`,

          startSolarDate:
            solarDateString(
              previousJie
                ?.getSolar?.()
            ),

          boundaryPolicy:
            'jie_boundary'
        }
      })
    );
  }

  // --------------------------------------------------------------------------
  // Day cycles
  // --------------------------------------------------------------------------

  const daysInMonth =
    new Date(
      Date.UTC(
        ref.year,
        ref.month,
        0
      )
    ).getUTCDate();

  const requestedDays =
    unique([
      1,
      5,
      10,
      15,
      20,
      25,
      Math.min(
        30,
        daysInMonth
      )
    ]).filter(
      (d) =>
        d <=
        daysInMonth
    );

  const selectedMonth =
    monthCycles[
      ref.month - 1
    ];

  const dayCycles =
    requestedDays.map(
      (day) => {
        const point =
          solarEightCharAt(
            ref.year,
            ref.month,
            day,
            12,
            0
          );

        const parentDaewoon =
          findParentDaewoonForYear(
            daewoon,
            ref.year
          );

        return evaluateCycle({
          natal,
          usefulGodProfile,

          parentCycles: [
            parentDaewoon,
            selectedYear,
            selectedMonth
          ].filter(Boolean),

          stem:
            point.day.stem,

          branch:
            point.day.branch,

          ganzhi:
            point.day.ganzhi,

          cycleType:
            'day',

          extra: {
            year:
              ref.year,

            month:
              ref.month,

            day,

            referenceSolarDate:
              `${ref.year}-` +
              `${pad2(
                ref.month
              )}-` +
              `${pad2(day)}`
          }
        });
      }
    );

  // --------------------------------------------------------------------------
  // Hour cycles
  // --------------------------------------------------------------------------

  const refDay =
    clamp(
      ref.day,
      1,
      daysInMonth
    );

  const selectedDayPoint =
    solarEightCharAt(
      ref.year,
      ref.month,
      refDay,
      12,
      0
    );

  const selectedDay =
    evaluateCycle({
      natal,
      usefulGodProfile,

      parentCycles: [],

      stem:
        selectedDayPoint
          .day
          .stem,

      branch:
        selectedDayPoint
          .day
          .branch,

      ganzhi:
        selectedDayPoint
          .day
          .ganzhi,

      cycleType:
        'day',

      extra: {
        year:
          ref.year,

        month:
          ref.month,

        day:
          refDay
      }
    });

  const hourCycles = [];

  for (
    let index = 0;
    index < 12;
    index++
  ) {
    const hour =
      index === 0
        ? 0
        : index * 2;

    const point =
      solarEightCharAt(
        ref.year,
        ref.month,
        refDay,
        hour,
        0
      );

    const parentDaewoon =
      findParentDaewoonForYear(
        daewoon,
        ref.year
      );

    hourCycles.push(
      evaluateCycle({
        natal,
        usefulGodProfile,

        parentCycles: [
          parentDaewoon,
          selectedYear,
          selectedMonth,
          selectedDay
        ].filter(Boolean),

        stem:
          point.hour.stem,

        branch:
          point.hour.branch,

        ganzhi:
          point.hour.ganzhi,

        cycleType:
          'hour',

        extra: {
          year:
            ref.year,

          month:
            ref.month,

          day:
            refDay,

          hour,

          branchLabel:
            `${BRANCH_KO[
              point.hour.branch
            ]}시`
        }
      })
    );
  }

  const alignment =
    (a, b) => {
      if (
        !a ||
        !b
      ) {
        return 'uncertain';
      }

      const ea =
        a.balanceImpact.effect;

      const eb =
        b.balanceImpact.effect;

      if (ea === eb) {
        return 'aligned';
      }

      if (
        (
          ea === 'relieves' &&
          eb === 'aggravates'
        ) ||
        (
          ea === 'aggravates' &&
          eb === 'relieves'
        )
      ) {
        return 'divergent';
      }

      return 'mixed';
    };

  const parentDaewoon =
    findParentDaewoonForYear(
      daewoon,
      ref.year
    );

  return {
    daewoon,
    year:
      yearCycles,

    month:
      monthCycles,

    day:
      dayCycles,

    hour:
      hourCycles,

    cycleAlignment: {
      daewoonVsYear:
        alignment(
          parentDaewoon,
          selectedYear
        ),

      yearVsMonth:
        alignment(
          selectedYear,
          selectedMonth
        )
    },

    reference: {
      year:
        ref.year,

      month:
        ref.month,

      day:
        refDay,

      hour:
        ref.hour,

      timezone:
        input.timezone
    }
  };
}


// ============================================================================
// EF-01 Natal
// ============================================================================

function buildNatal(
  eightChar
) {
  const natal = {
    year:
      pillarObject(
        eightChar.getYear()
      ),

    month:
      pillarObject(
        eightChar.getMonth()
      ),

    day:
      pillarObject(
        eightChar.getDay()
      ),

    hour:
      pillarObject(
        eightChar.getTime()
      )
  };

  const dayStem =
    natal.day.stem;

  natal.dayMaster = {
    stem:
      dayStem,

    element:
      STEM_META[
        dayStem
      ].element,

    yinYang:
      STEM_META[
        dayStem
      ].yinYang
  };

  natal.methodId =
    METHODS.natal;

  natal.methodVersion =
    METHOD_VERSION;

  return natal;
}


// ============================================================================
// Diagnostics
// ============================================================================

function buildDiagnostics(
  input,
  facts
) {
  const warnings = [];
  const conflicts = [];
  const lowConfidenceFacts = [];
  const calculationTrace = [];

  if (
    input.timezone !==
    'Asia/Seoul'
  ) {
    warnings.push({
      code:
        'TIMEZONE_WALL_CLOCK_POLICY',

      message:
        'lunar-javascript receives normalized wall-clock fields; timezone conversion is not performed inside Engine v1.'
    });
  }

  if (
    facts
      .strength
      .specialStructureCandidate
      .detected &&
    facts
      .strength
      .specialStructureCandidate
      .confidence <
      0.7
  ) {
    warnings.push({
      code:
        'LOW_CONFIDENCE_SPECIAL_STRUCTURE',

      message:
        'specialStructureCandidate confidence below threshold'
    });

    lowConfidenceFacts.push(
      'strength.specialStructureCandidate'
    );
  }

  const relationPairKey =
    (r) =>
      r.members
        .map(
          (m) =>
            `${m.position}:${m.value}`
        )
        .sort()
        .join('|');

  const byPair =
    new Map();

  for (
    const relation of
    facts.relations.items
  ) {
    const key =
      relationPairKey(
        relation
      );

    if (
      !byPair.has(key)
    ) {
      byPair.set(
        key,
        []
      );
    }

    byPair
      .get(key)
      .push(
        relation.relationId
      );
  }

  for (
    const ids of
    byPair.values()
  ) {
    if (
      ids.length > 1
    ) {
      conflicts.push({
        code:
          'MULTIPLE_RELATIONS_SAME_PAIR',

        relationIds:
          ids
      });
    }
  }

  calculationTrace.push({
    step:
      'natal',

    methodId:
      METHODS.natal,

    result:
      'ok'
  });

  calculationTrace.push({
    step:
      'strength_eval',

    factor:
      'season',

    result:
      facts
        .strength
        .factors
        .season
        .score
  });

  calculationTrace.push({
    step:
      'strength_eval',

    factor:
      'root',

    result:
      facts
        .strength
        .factors
        .root
        .score
  });

  calculationTrace.push({
    step:
      'strength_eval',

    factor:
      'support',

    result:
      facts
        .strength
        .factors
        .support
        .score
  });

  calculationTrace.push({
    step:
      'useful_god',

    methodId:
      METHODS.yongshin,

    result:
      facts
        .usefulGodProfile
        .yongsin
        .element
  });

  return {
    warnings,
    conflicts,
    lowConfidenceFacts,
    calculationTrace
  };
}


// ============================================================================
// Schema Validation
// ============================================================================

export function validateEngineFacts(
  facts
) {
  const errors = [];

  if (
    facts.schemaVersion !==
    SCHEMA_VERSION
  ) {
    errors.push(
      'schemaVersion'
    );
  }

  if (
    !facts
      .natal
      ?.dayMaster
      ?.stem
  ) {
    errors.push(
      'natal.dayMaster'
    );
  }

  if (
    !STRENGTH_BANDS.includes(
      facts
        .strength
        ?.band
    )
  ) {
    errors.push(
      'strength.band'
    );
  }

  if (
    !facts
      .usefulGodProfile
      ?.methodId
  ) {
    errors.push(
      'usefulGodProfile.methodId'
    );
  }

  if (
    !Array.isArray(
      facts.stars
    ) ||
    facts.stars.some(
      (s) =>
        !s.methodId
    )
  ) {
    errors.push(
      'stars[].methodId'
    );
  }

  if (
    !Array.isArray(
      facts
        .relations
        ?.items
    )
  ) {
    errors.push(
      'relations.items'
    );
  }

  const cycleGroups = [
    'daewoon',
    'year',
    'month',
    'day',
    'hour'
  ];

  for (
    const group of
    cycleGroups
  ) {
    const list =
      facts
        .cycles
        ?.[group];

    if (
      !Array.isArray(
        list
      )
    ) {
      errors.push(
        `cycles.${group}`
      );
    } else if (
      list.some(
        (c) =>
          c
            .twelveStage
            ?.methodId !==
          METHODS
            .twelveStage
      )
    ) {
      errors.push(
        `cycles.${group}.twelveStage.methodId`
      );
    }
  }

  return {
    valid:
      errors.length === 0,

    errors
  };
}


// ============================================================================
// Master Calculation
// ============================================================================

export function calculateSajuGrap(
  rawInput = {}
) {
  const input =
    normalizeInput(
      rawInput
    );

  const {
    lunar
  } =
    createCalendarObjects(
      input
    );

  const eightChar =
    lunar.getEightChar();

  const natal =
    buildNatal(
      eightChar
    );

  const composition =
    buildComposition(
      natal
    );

  const tenGodProfile =
    buildTenGodProfile(
      natal,
      composition
    );

  const strength =
    buildStrength(
      natal,
      composition,
      tenGodProfile
    );

  const usefulGodProfile =
    buildUsefulGodProfile(
      natal,
      composition,
      strength,
      tenGodProfile
    );

  const stars =
    buildStars(
      natal
    );

  const relations =
    buildRelations(
      natal
    );

  const cycles =
    buildCycles(
      eightChar,
      input,
      natal,
      usefulGodProfile
    );

  const facts = {
    schemaVersion:
      SCHEMA_VERSION,

    engineVersion:
      ENGINE_VERSION,

    input: {
      name:
        input.name,

      birthDateTime:
        input.birthDateTime,

      calendarType:
        input.calendarType,

      gender:
        input.gender,

      timezone:
        input.timezone
    },

    natal,
    composition,
    strength,
    usefulGodProfile,
    tenGodProfile,
    stars,
    relations,
    cycles,

    diagnostics: {}
  };

  facts.diagnostics =
    buildDiagnostics(
      input,
      facts
    );

  const validation =
    validateEngineFacts(
      facts
    );

  if (
    !validation.valid
  ) {
    facts
      .diagnostics
      .warnings
      .push({
        code:
          'ENGINE_FACT_SCHEMA_VALIDATION_FAILED',

        message:
          validation
            .errors
            .join(', ')
      });

    throw new Error(
      'Engine Facts v1 schema validation failed: ' +
      validation
        .errors
        .join(', ')
    );
  }

  return facts;
}


// ============================================================================
// Legacy UI compatibility projection
// -----------------------------------------------------------------------------
// IMPORTANT
// - Not canonical Engine Facts.
// - Not RAG input.
// - Not LLM fact source.
// - Exists only to avoid breaking the current index.html while the frontend
//   is migrated.
// ============================================================================

function roleLegacyText(
  role
) {
  if (
    !role?.element
  ) {
    return '';
  }

  const groupKo =
    TEN_GOD_GROUP_KO[
      role.tenGodGroup
    ] ||
    role.tenGodGroup ||
    '';

  return (
    `${KO_ELEMENT[
      role.element
    ]}` +
    `(${groupKo})`
  );
}

function legacyStarName(
  star
) {
  const hanja = {
    TIAN_YI:
      '天乙貴人',

    WEN_CHANG:
      '文昌貴人',

    YIMA:
      '驛馬',

    PEACH_BLOSSOM:
      '桃花',

    HUA_GAI:
      '華蓋',

    YANG_REN:
      '陽刃',

    KUI_GANG:
      '魁罡',

    XUE_TANG:
      '學堂貴人'
  }[
    star.starId
  ];

  return hanja
    ? `${star.canonicalName}(${hanja})`
    : star.canonicalName;
}

function legacyRelationName(
  relation
) {
  const values =
    relation
      .members
      .map(
        (m) =>
          BRANCH_KO[
            m.value
          ] ||
          STEM_KO[
            m.value
          ] ||
          m.value
      )
      .join('');

  const label = {
    stem_five_combination:
      '합',

    branch_six_harmony:
      '육합',

    branch_clash:
      '충',

    branch_three_harmony:
      '삼합',

    branch_seasonal_meeting:
      '삼회',

    half_harmony:
      '반합',

    branch_punishment:
      '형',

    branch_harm:
      '해',

    branch_break:
      '파'
  }[
    relation.relationType
  ] ||
  relation.relationType;

  return `${values}${label}`;
}

function legacyWaveScore(
  cycle
) {
  // Compatibility-only projection.
  //
  // Deliberately NOT:
  // 十二運星 -> +/-100.
  //
  // It is not an Engine Fact and must
  // not be given to RAG as a source
  // for recalculating facts.

  let score = 0;

  if (
    cycle
      .balanceImpact
      .effect ===
    'relieves'
  ) {
    score += 45;
  } else if (
    cycle
      .balanceImpact
      .effect ===
    'aggravates'
  ) {
    score -= 45;
  } else if (
    cycle
      .balanceImpact
      .effect ===
    'mixed'
  ) {
    score += 0;
  }

  if (
    cycle
      .usefulGodImpact
      .yongsinImpact
      .overloaded
  ) {
    score -= 10;
  }

  // 충 등 관계 자체를 길흉 점수로
  // 자동 변환하지 않는다.
  if (
    cycle
      .relationsWithNatal
      .some(
        (r) =>
          r.relationType ===
          'branch_clash'
      )
  ) {
    score += 0;
  }

  return clamp(
    score,
    -100,
    100
  );
}

function legacyDomainScores(
  cycle
) {
  const total =
    legacyWaveScore(
      cycle
    );

  const group =
    cycle
      .tenGod
      ?.group;

  // Only five official domains.
  // growth is intentionally absent.
  const adjust = {
    career: 0,
    wealth: 0,
    mental: 0,
    love: 0
  };

  if (
    group === 'officer'
  ) {
    adjust.career += 12;
  }

  if (
    group === 'wealth'
  ) {
    adjust.wealth += 12;
  }

  if (
    group === 'resource'
  ) {
    adjust.mental += 12;
  }

  if (
    group === 'peer'
  ) {
    adjust.love += 5;
  }

  if (
    group === 'output'
  ) {
    adjust.career += 6;
    adjust.love += 6;
  }

  return {
    total,

    career:
      clamp(
        total +
        adjust.career,
        -100,
        100
      ),

    wealth:
      clamp(
        total +
        adjust.wealth,
        -100,
        100
      ),

    mental:
      clamp(
        total +
        adjust.mental,
        -100,
        100
      ),

    love:
      clamp(
        total +
        adjust.love,
        -100,
        100
      )
  };
}

function cycleSeries(
  list,
  labelFn
) {
  const rows =
    list.map(
      (cycle) => ({
        cycle,

        scores:
          legacyDomainScores(
            cycle
          )
      })
    );

  return {
    labels:
      rows.map(
        ({
          cycle
        }) =>
          labelFn(
            cycle
          )
      ),

    total:
      rows.map(
        ({
          scores
        }) =>
          scores.total
      ),

    career:
      rows.map(
        ({
          scores
        }) =>
          scores.career
      ),

    wealth:
      rows.map(
        ({
          scores
        }) =>
          scores.wealth
      ),

    mental:
      rows.map(
        ({
          scores
        }) =>
          scores.mental
      ),

    love:
      rows.map(
        ({
          scores
        }) =>
          scores.love
      )
  };
}


// ============================================================================
// Current index.html compatibility packet
// ============================================================================

export function toLegacyApiData(
  facts
) {
  const y =
    facts
      .usefulGodProfile;

  const yongsinProfile = {
    yongsin:
      roleLegacyText(
        y.yongsin
      ),

    heesin:
      roleLegacyText(
        y.heesin?.[0]
      ),

    hansin:
      roleLegacyText(
        y.hansin?.[0]
      ),

    gusin:
      roleLegacyText(
        y.gusin?.[0]
      ),

    gisin:
      roleLegacyText(
        y.gisin?.[0]
      )
  };

  const detectedStars =
    facts
      .stars
      .filter(
        (s) =>
          s.detected
      )
      .flatMap(
        (star) => {
          if (
            star.matches.length ===
            0
          ) {
            return [
              {
                name:
                  legacyStarName(
                    star
                  ),

                pos:
                  POSITION_LABEL_KO[
                    star.basisType
                  ] ||
                  star.basisType,

                starId:
                  star.starId
              }
            ];
          }

          return (
            star
              .matches
              .map(
                (match) => ({
                  name:
                    legacyStarName(
                      star
                    ),

                  pos:
                    POSITION_LABEL_KO[
                      `${match.position}_branch`
                    ] ||
                    POSITION_LABEL_KO[
                      match.position
                    ] ||
                    match.position,

                  starId:
                    star.starId
                })
              )
          );
        }
      );

  const legacyInteractions =
    facts
      .relations
      .items
      .map(
        (relation) => ({
          type:
            relation
              .relationType,

          name:
            legacyRelationName(
              relation
            ),

          relationId:
            relation
              .relationId,

          complete:
            relation
              .complete
        })
      );

  const daewoonWaves =
    facts
      .cycles
      .daewoon
      .map(
        (cycle) => {
          const scores =
            legacyDomainScores(
              cycle
            );

          return {
            step:
              cycle.index,

            ganZhi:
              `${STEM_KO[
                cycle.stem
              ]}` +
              `${BRANCH_KO[
                cycle.branch
              ]}`,

            hanja:
              cycle.ganzhi,

            ageRange:
              cycle.ageRange,

            startAge:
              cycle
                .ageRange
                ?.start,

            startYear:
              cycle.startYear,

            scores
          };
        }
      );

  const cyclesData = {
    daewoon:
      cycleSeries(
        facts
          .cycles
          .daewoon,

        (c) =>
          `${STEM_KO[
            c.stem
          ]}` +
          `${BRANCH_KO[
            c.branch
          ]}` +
          `(${c.ageRange?.start ?? ''}세)`
      ),

    year:
      cycleSeries(
        facts
          .cycles
          .year,

        (c) =>
          `${c.year}년`
      ),

    month:
      cycleSeries(
        facts
          .cycles
          .month,

        (c) =>
          `${c.month}월`
      ),

    day:
      cycleSeries(
        facts
          .cycles
          .day,

        (c) =>
          `${c.day}일`
      ),

    hour:
      cycleSeries(
        facts
          .cycles
          .hour,

        (c) =>
          c.branchLabel ||
          `${BRANCH_KO[
            c.branch
          ]}시`
      )
  };

  const firstDaewoon =
    facts
      .cycles
      .daewoon[0];

  const isYangYear =
    STEM_META[
      facts
        .natal
        .year
        .stem
    ].yinYang ===
    'yang';

  const isMale =
    facts
      .input
      .gender ===
    'male';

  const isForward =
    (
      isYangYear &&
      isMale
    ) ||
    (
      !isYangYear &&
      !isMale
    );

  return {
    pillars: {
      year:
        `${STEM_KO[
          facts
            .natal
            .year
            .stem
        ]}` +
        `${BRANCH_KO[
          facts
            .natal
            .year
            .branch
        ]}`,

      yearHanja:
        facts
          .natal
          .year
          .ganzhi,

      month:
        `${STEM_KO[
          facts
            .natal
            .month
            .stem
        ]}` +
        `${BRANCH_KO[
          facts
            .natal
            .month
            .branch
        ]}`,

      monthHanja:
        facts
          .natal
          .month
          .ganzhi,

      day:
        `${STEM_KO[
          facts
            .natal
            .day
            .stem
        ]}` +
        `${BRANCH_KO[
          facts
            .natal
            .day
            .branch
        ]}`,

      dayHanja:
        facts
          .natal
          .day
          .ganzhi,

      hour:
        `${STEM_KO[
          facts
            .natal
            .hour
            .stem
        ]}` +
        `${BRANCH_KO[
          facts
            .natal
            .hour
            .branch
        ]}`,

      hourHanja:
        facts
          .natal
          .hour
          .ganzhi
    },

    dayGanHanja:
      facts
        .natal
        .dayMaster
        .stem,

    dayElemKor:
      ELEMENT_KO_LONG[
        facts
          .natal
          .dayMaster
          .element
      ],

    analysis: {
      status:
        STRENGTH_UI[
          facts
            .strength
            .band
        ],

      strengthScore:
        facts
          .strength
          .score,

      scores: {
        deungRyeong:
          facts
            .strength
            .factors
            .season
            .score,

        deungJi:
          facts
            .strength
            .factors
            .root
            .score,

        deungSe:
          facts
            .strength
            .factors
            .support
            .score
      },

      yongsinProfile,

      metaStars: {
        stars:
          detectedStars,

        interactions:
          legacyInteractions
      }
    },

    metaStars: {
      stars:
        detectedStars,

      interactions:
        legacyInteractions
    },

    daewoonWaves,
    cyclesData,

    meta: {
      isForward,

      startAge:
        firstDaewoon
          ?.ageRange
          ?.start ??
        null
    },

    // Canonical Engine Facts.
    engineFacts:
      facts,

    compatibility: {
      methodId:
        METHODS
          .legacyWaveProjection,

      methodVersion:
        METHOD_VERSION,

      note:
        'Legacy UI projection only; do not use as canonical Engine Facts or RAG input.'
    }
  };
}


// ============================================================================
// Public Engine Interface
// ============================================================================

export const SajuGrapEngine =
  Object.freeze({
    analyze:
      calculateSajuGrap,

    validate:
      validateEngineFacts,

    toLegacyApiData,

    schemaVersion:
      SCHEMA_VERSION,

    engineVersion:
      ENGINE_VERSION,

    methods:
      METHODS
  });

export default SajuGrapEngine;
