#!/usr/bin/env node
// scripts/buildRagCorpus.js
// SajuGrap RAG Corpus Builder v1
// -----------------------------------------------------------------------------
// 역할
// - rag-source/ 아래의 Markdown / TXT / JSON 원천 문서를 읽는다.
// - 의미 단위(section / paragraph)를 기준으로 chunk를 만든다.
// - lib/ragDocumentSchema.js 계약으로 모든 chunk를 검증한다.
// - embedding 전 단계의 JSONL corpus + manifest를 생성한다.
//
// 중요한 원칙
// - 본문을 보고 명리 Fact metadata를 임의 추론하지 않는다.
// - 문서에 명시된 metadata 또는 안전한 default만 사용한다.
// - 사주 계산을 하지 않는다.
// - negative corpus와 production corpus를 섞지 않는다.
// - embedding vector는 이 단계에서 만들지 않는다.
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createRagDocument,
  validateRagDocument,
  RAG_CORPUS,
  RAG_DOCUMENT_STATUS
} from '../lib/ragDocumentSchema.js';

const SCRIPT_VERSION = '1.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULTS = Object.freeze({
  input: path.join(PROJECT_ROOT, 'rag-source'),
  output: path.join(PROJECT_ROOT, 'data', 'rag-corpus.jsonl'),
  manifest: path.join(PROJECT_ROOT, 'data', 'rag-corpus.manifest.json'),

  sourceId: 'sajugrap-rag-v1',
  sourceVersion: '1.0.0',
  sourceType: 'manual',

  corpus: RAG_CORPUS.PRODUCTION,
  status: RAG_DOCUMENT_STATUS.DRAFT,

  locale: 'ko-KR',
  domain: 'all',
  cycleType: 'shared',
  factType: 'general',

  targetTokens: 500,
  minTokens: 220,
  maxTokens: 750
});

const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json'
]);


// ============================================================================
// CLI
// ============================================================================

function printHelp() {
  console.log(`
SajuGrap RAG Corpus Builder v${SCRIPT_VERSION}

사용법:
  node scripts/buildRagCorpus.js [options]

주요 옵션:
  --input <dir>               원천 문서 폴더
  --output <file>             JSONL 출력 파일
  --manifest <file>           manifest JSON 출력 파일

  --source-id <id>            기본 sourceId
  --source-version <version>  기본 sourceVersion
  --source-type <type>        기본 sourceType

  --corpus <value>            production | evaluation_negative
  --status <value>            draft | active | inactive

  --locale <value>            기본 locale
  --domain <value>            기본 domain
  --cycle-type <value>        기본 cycleType
  --fact-type <value>         기본 factType

  --target-tokens <number>    목표 chunk 크기 (기본 ${DEFAULTS.targetTokens})
  --min-tokens <number>       최소 권장 chunk 크기 (기본 ${DEFAULTS.minTokens})
  --max-tokens <number>       최대 chunk 크기 (기본 ${DEFAULTS.maxTokens})

  --dry-run                   파일을 저장하지 않고 결과만 검사
  --help                      도움말

예:
  node scripts/buildRagCorpus.js \\
    --input ./rag-source \\
    --output ./data/rag-corpus.jsonl \\
    --source-id sajugrap-rag-v1 \\
    --source-version 1.0.0
`);
}

function parseArgs(argv) {
  const config = {
    ...DEFAULTS,
    dryRun: false
  };

  const getValue = (index, flag) => {
    const value = argv[index + 1];

    if (
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(`${flag} 뒤에 값이 필요합니다.`);
    }

    return value;
  };

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const arg = argv[index];

    switch (arg) {
      case '--help':
        printHelp();
        process.exit(0);
        break;

      case '--dry-run':
        config.dryRun = true;
        break;

      case '--input':
        config.input = path.resolve(
          PROJECT_ROOT,
          getValue(index, arg)
        );
        index += 1;
        break;

      case '--output':
        config.output = path.resolve(
          PROJECT_ROOT,
          getValue(index, arg)
        );
        index += 1;
        break;

      case '--manifest':
        config.manifest = path.resolve(
          PROJECT_ROOT,
          getValue(index, arg)
        );
        index += 1;
        break;

      case '--source-id':
        config.sourceId =
          getValue(index, arg);
        index += 1;
        break;

      case '--source-version':
        config.sourceVersion =
          getValue(index, arg);
        index += 1;
        break;

      case '--source-type':
        config.sourceType =
          getValue(index, arg);
        index += 1;
        break;

      case '--corpus':
        config.corpus =
          getValue(index, arg);
        index += 1;
        break;

      case '--status':
        config.status =
          getValue(index, arg);
        index += 1;
        break;

      case '--locale':
        config.locale =
          getValue(index, arg);
        index += 1;
        break;

      case '--domain':
        config.domain =
          getValue(index, arg);
        index += 1;
        break;

      case '--cycle-type':
        config.cycleType =
          getValue(index, arg);
        index += 1;
        break;

      case '--fact-type':
        config.factType =
          getValue(index, arg);
        index += 1;
        break;

      case '--target-tokens':
        config.targetTokens =
          Number(getValue(index, arg));
        index += 1;
        break;

      case '--min-tokens':
        config.minTokens =
          Number(getValue(index, arg));
        index += 1;
        break;

      case '--max-tokens':
        config.maxTokens =
          Number(getValue(index, arg));
        index += 1;
        break;

      default:
        throw new Error(
          `알 수 없는 옵션입니다: ${arg}`
        );
    }
  }

  validateConfig(config);

  return config;
}

function validateConfig(config) {
  const numericKeys = [
    'targetTokens',
    'minTokens',
    'maxTokens'
  ];

  for (
    const key of numericKeys
  ) {
    if (
      !Number.isFinite(config[key]) ||
      config[key] <= 0
    ) {
      throw new Error(
        `${key}는 양수여야 합니다.`
      );
    }
  }

  if (
    config.minTokens >
    config.targetTokens
  ) {
    throw new Error(
      'minTokens는 targetTokens보다 클 수 없습니다.'
    );
  }

  if (
    config.targetTokens >
    config.maxTokens
  ) {
    throw new Error(
      'targetTokens는 maxTokens보다 클 수 없습니다.'
    );
  }

  if (
    !Object
      .values(RAG_CORPUS)
      .includes(config.corpus)
  ) {
    throw new Error(
      `corpus 값이 올바르지 않습니다: ${config.corpus}`
    );
  }

  if (
    !Object
      .values(RAG_DOCUMENT_STATUS)
      .includes(config.status)
  ) {
    throw new Error(
      `status 값이 올바르지 않습니다: ${config.status}`
    );
  }
}


// ============================================================================
// File discovery
// ============================================================================

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectSourceFiles(rootDirectory) {
  if (
    !(await pathExists(rootDirectory))
  ) {
    throw new Error(
      `입력 폴더가 없습니다: ${rootDirectory}`
    );
  }

  const result = [];

  async function walk(currentDirectory) {
    const entries =
      await fs.readdir(
        currentDirectory,
        {
          withFileTypes: true
        }
      );

    for (
      const entry of entries
    ) {
      const fullPath =
        path.join(
          currentDirectory,
          entry.name
        );

      if (
        entry.isDirectory()
      ) {
        await walk(fullPath);
        continue;
      }

      if (
        !entry.isFile()
      ) {
        continue;
      }

      const extension =
        path.extname(
          entry.name
        ).toLowerCase();

      if (
        SUPPORTED_EXTENSIONS.has(
          extension
        )
      ) {
        result.push(
          fullPath
        );
      }
    }
  }

  await walk(rootDirectory);

  return result.sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


// ============================================================================
// Text helpers
// ============================================================================

function normalizeNewlines(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function cleanContent(value) {
  return normalizeNewlines(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanSingleLine(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function mergeObjects(base, override) {
  const left =
    (
      base &&
      typeof base === 'object' &&
      !Array.isArray(base)
    )
      ? base
      : {};

  const right =
    (
      override &&
      typeof override === 'object' &&
      !Array.isArray(override)
    )
      ? override
      : {};

  const merged = {
    ...left,
    ...right
  };

  if (
    left.metadata ||
    right.metadata
  ) {
    merged.metadata = {
      ...(left.metadata || {}),
      ...(right.metadata || {})
    };
  }

  if (
    left.interpretationPolicy ||
    right.interpretationPolicy
  ) {
    merged.interpretationPolicy = {
      ...(left.interpretationPolicy || {}),
      ...(right.interpretationPolicy || {})
    };
  }

  if (
    left.source ||
    right.source
  ) {
    merged.source = {
      ...(left.source || {}),
      ...(right.source || {})
    };
  }

  return merged;
}


// ============================================================================
// Token estimate
// ----------------------------------------------------------------------------
// tokenizer dependency를 추가하지 않기 위한 빌드용 근사치.
// 실제 embedding model token count가 아니다.
// ============================================================================

function estimateTokens(text) {
  const normalized =
    cleanContent(text);

  if (!normalized) {
    return 0;
  }

  const hangulCount =
    (
      normalized.match(
        /[가-힣ㄱ-ㅎㅏ-ㅣ]/g
      ) ||
      []
    ).length;

  const cjkCount =
    (
      normalized.match(
        /[\u3400-\u9FFF]/g
      ) ||
      []
    ).length;

  const latinWords =
    (
      normalized.match(
        /[A-Za-z]+(?:['’-][A-Za-z]+)*/g
      ) ||
      []
    ).length;

  const numberGroups =
    (
      normalized.match(
        /\d+(?:[.,]\d+)*/g
      ) ||
      []
    ).length;

  const punctuation =
    (
      normalized.match(
        /[.,!?;:()[\]{}"'“”‘’/\\|+=*_#<>~-]/g
      ) ||
      []
    ).length;

  return Math.max(
    1,
    Math.ceil(
      hangulCount * 0.78 +
      cjkCount * 0.95 +
      latinWords * 1.25 +
      numberGroups * 0.75 +
      punctuation * 0.18
    )
  );
}


// ============================================================================
// RAG directives
// ----------------------------------------------------------------------------
// Markdown에서 명시적으로 metadata를 지정한다.
//
// 파일 기본값:
// <!-- rag-defaults: {"domain":"all","cycleType":"shared","factType":"general"} -->
//
// section metadata:
// <!-- rag: {"domain":"career","factType":"strategy","metadata":{"strategyModes":["expansion"]}} -->
//
// Builder는 본문 내용으로 metadata를 추론하지 않는다.
// ============================================================================

function parseJsonDirective(rawJson, contextLabel) {
  try {
    const parsed =
      JSON.parse(rawJson);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        'JSON object가 필요합니다.'
      );
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `${contextLabel} RAG directive JSON 오류: ${error.message}`
    );
  }
}

function extractFileDefaults(text, filePath) {
  const pattern =
    /<!--\s*rag-defaults\s*:\s*({[\s\S]*?})\s*-->/i;

  const match =
    text.match(pattern);

  if (!match) {
    return {
      text,
      defaults: {}
    };
  }

  const defaults =
    parseJsonDirective(
      match[1],
      `${filePath} rag-defaults`
    );

  return {
    text:
      text.replace(
        match[0],
        ''
      ),

    defaults
  };
}

function extractSectionDirective(
  text,
  contextLabel
) {
  const pattern =
    /^\s*<!--\s*rag\s*:\s*({[\s\S]*?})\s*-->\s*/i;

  const match =
    text.match(pattern);

  if (!match) {
    return {
      text,
      metadata: {}
    };
  }

  const metadata =
    parseJsonDirective(
      match[1],
      contextLabel
    );

  return {
    text:
      text.slice(
        match[0].length
      ),

    metadata
  };
}


// ============================================================================
// Markdown sections
// ============================================================================

function parseMarkdownSections(
  text,
  filePath
) {
  const normalized =
    normalizeNewlines(text);

  const headingPattern =
    /^(#{1,4})[ \t]+(.+?)\s*$/gm;

  const matches =
    [
      ...normalized.matchAll(
        headingPattern
      )
    ];

  if (
    matches.length === 0
  ) {
    return [
      {
        heading:
          path.basename(
            filePath,
            path.extname(filePath)
          ),

        headingLevel:
          null,

        sectionPath: [],

        content:
          cleanContent(
            normalized
          )
      }
    ];
  }

  const sections = [];
  const headingStack = [];

  const preamble =
    cleanContent(
      normalized.slice(
        0,
        matches[0].index
      )
    );

  if (preamble) {
    sections.push({
      heading:
        path.basename(
          filePath,
          path.extname(filePath)
        ),

      headingLevel:
        null,

      sectionPath: [],

      content:
        preamble
    });
  }

  for (
    let index = 0;
    index < matches.length;
    index += 1
  ) {
    const match =
      matches[index];

    const level =
      match[1].length;

    const heading =
      cleanSingleLine(
        match[2]
      );

    const contentStart =
      match.index +
      match[0].length;

    const contentEnd =
      index + 1 <
        matches.length
        ? matches[index + 1].index
        : normalized.length;

    headingStack[
      level - 1
    ] = heading;

    headingStack.length =
      level;

    sections.push({
      heading,
      headingLevel:
        level,

      sectionPath:
        [...headingStack],

      content:
        cleanContent(
          normalized.slice(
            contentStart,
            contentEnd
          )
        )
    });
  }

  return sections.filter(
    (section) =>
      section.content
  );
}


// ============================================================================
// Semantic splitting
// ============================================================================

function splitIntoParagraphs(text) {
  return cleanContent(text)
    .split(/\n\s*\n+/)
    .map(
      (paragraph) =>
        paragraph.trim()
    )
    .filter(Boolean);
}

function splitIntoSentences(text) {
  const normalized =
    cleanSingleLine(text);

  if (!normalized) {
    return [];
  }

  const sentences =
    normalized
      .split(
        /(?<=[.!?。！？])\s+|(?<=다\.)\s+/
      )
      .map(
        (sentence) =>
          sentence.trim()
      )
      .filter(Boolean);

  return sentences.length > 0
    ? sentences
    : [normalized];
}

function splitOversizedSentence(
  sentence,
  maxTokens
) {
  const result = [];

  const approximateChars =
    Math.max(
      200,
      Math.floor(
        maxTokens * 1.75
      )
    );

  let cursor = 0;

  while (
    cursor <
    sentence.length
  ) {
    const end =
      Math.min(
        sentence.length,
        cursor +
          approximateChars
      );

    result.push(
      sentence
        .slice(
          cursor,
          end
        )
        .trim()
    );

    cursor = end;
  }

  return result.filter(Boolean);
}

function splitOversizedParagraph(
  paragraph,
  maxTokens
) {
  if (
    estimateTokens(
      paragraph
    ) <= maxTokens
  ) {
    return [paragraph];
  }

  const sentences =
    splitIntoSentences(
      paragraph
    );

  const pieces = [];
  let current = '';

  const flush =
    () => {
      const cleaned =
        current.trim();

      if (cleaned) {
        pieces.push(cleaned);
      }

      current = '';
    };

  for (
    const sentence of sentences
  ) {
    if (
      estimateTokens(
        sentence
      ) > maxTokens
    ) {
      flush();

      pieces.push(
        ...splitOversizedSentence(
          sentence,
          maxTokens
        )
      );

      continue;
    }

    const candidate =
      current
        ? `${current} ${sentence}`
        : sentence;

    if (
      estimateTokens(
        candidate
      ) > maxTokens
    ) {
      flush();
      current =
        sentence;
    } else {
      current =
        candidate;
    }
  }

  flush();

  return pieces;
}

function semanticChunk(
  text,
  {
    targetTokens,
    minTokens,
    maxTokens
  }
) {
  const paragraphs =
    splitIntoParagraphs(
      text
    )
      .flatMap(
        (paragraph) =>
          splitOversizedParagraph(
            paragraph,
            maxTokens
          )
      );

  if (
    paragraphs.length === 0
  ) {
    return [];
  }

  const chunks = [];
  let current = [];

  const currentText =
    () =>
      current.join('\n\n');

  const flush =
    () => {
      const text =
        cleanContent(
          currentText()
        );

      if (text) {
        chunks.push(text);
      }

      current = [];
    };

  for (
    const paragraph of paragraphs
  ) {
    if (
      current.length === 0
    ) {
      current.push(
        paragraph
      );
      continue;
    }

    const candidate =
      [
        ...current,
        paragraph
      ].join('\n\n');

    const candidateTokens =
      estimateTokens(
        candidate
      );

    const currentTokens =
      estimateTokens(
        currentText()
      );

    if (
      candidateTokens <=
      targetTokens
    ) {
      current.push(
        paragraph
      );

      continue;
    }

    if (
      currentTokens <
        minTokens &&
      candidateTokens <=
        maxTokens
    ) {
      current.push(
        paragraph
      );

      continue;
    }

    flush();
    current.push(
      paragraph
    );
  }

  flush();

  // 마지막 chunk가 지나치게 작고 앞 chunk와 합쳐도 max 이하면 병합.
  if (
    chunks.length >= 2
  ) {
    const last =
      chunks[
        chunks.length - 1
      ];

    const previous =
      chunks[
        chunks.length - 2
      ];

    if (
      estimateTokens(last) <
        minTokens
    ) {
      const combined =
        `${previous}\n\n${last}`;

      if (
        estimateTokens(
          combined
        ) <= maxTokens
      ) {
        chunks.splice(
          chunks.length - 2,
          2,
          combined
        );
      }
    }
  }

  return chunks;
}


// ============================================================================
// Raw source normalization
// ============================================================================

function defaultSourceForFile(
  filePath,
  config
) {
  const relative =
    path.relative(
      config.input,
      filePath
    );

  const sourceIdPart =
    relative
      .replace(
        path.extname(relative),
        ''
      )
      .replace(
        /[\\/]+/g,
        '_'
      )
      .replace(
        /[^a-zA-Z0-9가-힣_-]+/g,
        '_'
      );

  return {
    sourceId:
      `${config.sourceId}:${sourceIdPart}`,

    sourceVersion:
      config.sourceVersion,

    title:
      path.basename(
        filePath,
        path.extname(filePath)
      ),

    sourceType:
      config.sourceType,

    sourceUri:
      relative
        .split(path.sep)
        .join('/')
  };
}

function baseDefaultsForFile(
  filePath,
  config
) {
  return {
    corpus:
      config.corpus,

    status:
      config.status,

    locale:
      config.locale,

    domain:
      config.domain,

    cycleType:
      config.cycleType,

    factType:
      config.factType,

    source:
      defaultSourceForFile(
        filePath,
        config
      ),

    interpretationPolicy: {
      factMeaning:
        true,

      strengthStateMeaning:
        true,

      combinationMeaning:
        true,

      timeAxisMeaning:
        true,

      actionStrategy:
        true,

      domainStrategy:
        true,

      prohibitedInterpretation:
        true,

      uncertaintyExpression:
        true
    }
  };
}


// ============================================================================
// Markdown / TXT ingestion
// ============================================================================

async function buildFromTextFile(
  filePath,
  config
) {
  const rawText =
    await fs.readFile(
      filePath,
      'utf8'
    );

  const fileDirective =
    extractFileDefaults(
      rawText,
      filePath
    );

  const defaults =
    mergeObjects(
      baseDefaultsForFile(
        filePath,
        config
      ),
      fileDirective.defaults
    );

  const extension =
    path.extname(
      filePath
    ).toLowerCase();

  const sections =
    extension === '.md' ||
    extension === '.markdown'
      ? parseMarkdownSections(
          fileDirective.text,
          filePath
        )
      : [
          {
            heading:
              defaults.source?.title ||
              path.basename(
                filePath,
                extension
              ),

            headingLevel:
              null,

            sectionPath: [],

            content:
              cleanContent(
                fileDirective.text
              )
          }
        ];

  const documents = [];

  for (
    const [
      sectionIndex,
      section
    ] of sections.entries()
  ) {
    const directive =
      extractSectionDirective(
        section.content,
        `${filePath} / ${section.heading}`
      );

    const sectionConfig =
      mergeObjects(
        defaults,
        directive.metadata
      );

    const chunks =
      semanticChunk(
        directive.text,
        config
      );

    const chunkTotal =
      chunks.length;

    for (
      const [
        chunkIndex,
        content
      ] of chunks.entries()
    ) {
      const title =
        chunkTotal === 1
          ? section.heading
          : `${section.heading} · ${chunkIndex + 1}`;

      const source =
        mergeObjects(
          sectionConfig.source,
          {
            section:
              section.sectionPath
                .join(' > ') ||
              section.heading
          }
        );

      const chunk =
        createRagDocument({
          ...sectionConfig,

          title,
          content,
          source,

          chunking: {
            strategy:
              'semantic',

            chunkIndex,

            chunkTotal,

            estimatedTokens:
              estimateTokens(
                content
              ),

            overlapGroup:
              `${source.sourceId}:${sectionIndex}`
          }
        });

      documents.push(
        chunk
      );
    }
  }

  return documents;
}


// ============================================================================
// JSON ingestion
// ----------------------------------------------------------------------------
// 지원 형식 1:
// {
//   "defaults": {...},
//   "source": {...},
//   "chunks": [
//     {"title":"...", "content":"...", "domain":"all", ...}
//   ]
// }
//
// 지원 형식 2:
// [
//   {"title":"...", "content":"...", ...},
//   ...
// ]
//
// JSON에 이미 semantic chunk가 들어왔다고 간주하며,
// 너무 큰 content만 semanticChunk()로 재분할한다.
// ============================================================================

async function buildFromJsonFile(
  filePath,
  config
) {
  const raw =
    await fs.readFile(
      filePath,
      'utf8'
    );

  let parsed;

  try {
    parsed =
      JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${filePath} JSON 파싱 실패: ${error.message}`
    );
  }

  const fileDefaults =
    baseDefaultsForFile(
      filePath,
      config
    );

  let defaults =
    fileDefaults;

  let chunks;

  if (
    Array.isArray(parsed)
  ) {
    chunks =
      parsed;
  } else if (
    parsed &&
    typeof parsed ===
      'object'
  ) {
    defaults =
      mergeObjects(
        fileDefaults,
        parsed.defaults
      );

    if (parsed.source) {
      defaults =
        mergeObjects(
          defaults,
          {
            source:
              parsed.source
          }
        );
    }

    chunks =
      parsed.chunks;
  }

  if (
    !Array.isArray(chunks)
  ) {
    throw new Error(
      `${filePath}: JSON은 chunk 배열 또는 { chunks: [] } 형식이어야 합니다.`
    );
  }

  const documents = [];

  for (
    const [
      rawIndex,
      rawChunk
    ] of chunks.entries()
  ) {
    if (
      !rawChunk ||
      typeof rawChunk !==
        'object' ||
      Array.isArray(rawChunk)
    ) {
      throw new Error(
        `${filePath}: chunks[${rawIndex}]가 객체가 아닙니다.`
      );
    }

    const merged =
      mergeObjects(
        defaults,
        rawChunk
      );

    const contentPieces =
      semanticChunk(
        rawChunk.content || '',
        config
      );

    if (
      contentPieces.length === 0
    ) {
      throw new Error(
        `${filePath}: chunks[${rawIndex}] content가 비어 있습니다.`
      );
    }

    for (
      const [
        pieceIndex,
        content
      ] of contentPieces.entries()
    ) {
      const titleBase =
        cleanSingleLine(
          rawChunk.title ||
          `Chunk ${rawIndex + 1}`
        );

      const title =
        contentPieces.length === 1
          ? titleBase
          : `${titleBase} · ${pieceIndex + 1}`;

      const chunk =
        createRagDocument({
          ...merged,

          title,
          content,

          chunking: {
            ...(merged.chunking || {}),

            strategy:
              merged
                .chunking
                ?.strategy ||
              'semantic',

            chunkIndex:
              pieceIndex,

            chunkTotal:
              contentPieces.length,

            estimatedTokens:
              estimateTokens(
                content
              ),

            overlapGroup:
              merged
                .chunking
                ?.overlapGroup ||
              `${merged.source?.sourceId || config.sourceId}:${rawIndex}`
          }
        });

      documents.push(
        chunk
      );
    }
  }

  return documents;
}


// ============================================================================
// Per-file builder
// ============================================================================

async function buildFile(
  filePath,
  config
) {
  const extension =
    path.extname(
      filePath
    ).toLowerCase();

  if (
    extension === '.json'
  ) {
    return buildFromJsonFile(
      filePath,
      config
    );
  }

  return buildFromTextFile(
    filePath,
    config
  );
}


// ============================================================================
// Corpus validation
// ============================================================================

function validateCorpus(
  documents
) {
  const errors = [];
  const warnings = [];

  const chunkIds =
    new Set();

  for (
    const document of documents
  ) {
    const validation =
      validateRagDocument(
        document
      );

    for (
      const item of
      validation.errors
    ) {
      errors.push({
        chunkId:
          document.chunkId,
        ...item
      });
    }

    for (
      const item of
      validation.warnings
    ) {
      warnings.push({
        chunkId:
          document.chunkId,
        ...item
      });
    }

    if (
      chunkIds.has(
        document.chunkId
      )
    ) {
      errors.push({
        chunkId:
          document.chunkId,

        field:
          'chunkId',

        message:
          'Duplicate chunkId.'
      });
    }

    chunkIds.add(
      document.chunkId
    );
  }

  return {
    valid:
      errors.length === 0,

    errors,
    warnings
  };
}


// ============================================================================
// Manifest
// ============================================================================

function countBy(
  documents,
  selector
) {
  const result = {};

  for (
    const document of documents
  ) {
    const key =
      selector(document) ||
      'unknown';

    result[key] =
      (
        result[key] ||
        0
      ) + 1;
  }

  return result;
}

function buildManifest({
  config,
  sourceFiles,
  documents,
  validation
}) {
  const tokenEstimates =
    documents.map(
      (document) =>
        document
          .chunking
          ?.estimatedTokens ||
        estimateTokens(
          document.content
        )
    );

  const totalEstimatedTokens =
    tokenEstimates.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  const averageEstimatedTokens =
    documents.length > 0
      ? Math.round(
          totalEstimatedTokens /
          documents.length
        )
      : 0;

  return {
    schemaVersion:
      'rag_corpus_manifest_v1',

    builderVersion:
      SCRIPT_VERSION,

    generatedAt:
      new Date()
        .toISOString(),

    inputDirectory:
      path.relative(
        PROJECT_ROOT,
        config.input
      ) || '.',

    outputFile:
      path.relative(
        PROJECT_ROOT,
        config.output
      ),

    sourceFileCount:
      sourceFiles.length,

    chunkCount:
      documents.length,

    totalEstimatedTokens,
    averageEstimatedTokens,

    corpus:
      config.corpus,

    status:
      config.status,

    counts: {
      domain:
        countBy(
          documents,
          (item) =>
            item.domain
        ),

      cycleType:
        countBy(
          documents,
          (item) =>
            item.cycleType
        ),

      factType:
        countBy(
          documents,
          (item) =>
            item.factType
        )
    },

    validation: {
      valid:
        validation.valid,

      errorCount:
        validation.errors.length,

      warningCount:
        validation.warnings.length,

      errors:
        validation.errors,

      warnings:
        validation.warnings
    },

    policy: {
      metadataInferenceFromContent:
        false,

      engineFactRecalculation:
        false,

      embeddingsGenerated:
        false
    }
  };
}


// ============================================================================
// Output
// ============================================================================

async function ensureParent(
  filePath
) {
  await fs.mkdir(
    path.dirname(filePath),
    {
      recursive: true
    }
  );
}

async function writeOutputs({
  config,
  documents,
  manifest
}) {
  await ensureParent(
    config.output
  );

  await ensureParent(
    config.manifest
  );

  const jsonl =
    documents
      .map(
        (document) =>
          JSON.stringify(
            document
          )
      )
      .join('\n') +
    (
      documents.length > 0
        ? '\n'
        : ''
    );

  await fs.writeFile(
    config.output,
    jsonl,
    'utf8'
  );

  await fs.writeFile(
    config.manifest,
    JSON.stringify(
      manifest,
      null,
      2
    ) + '\n',
    'utf8'
  );
}


// ============================================================================
// Diagnostics
// ============================================================================

function printBuildSummary(
  manifest,
  config
) {
  console.log('');
  console.log(
    '=============================================='
  );
  console.log(
    ' SajuGrap RAG Corpus Build'
  );
  console.log(
    '=============================================='
  );

  console.log(
    `source files : ${manifest.sourceFileCount}`
  );

  console.log(
    `chunks       : ${manifest.chunkCount}`
  );

  console.log(
    `avg tokens   : ${manifest.averageEstimatedTokens}`
  );

  console.log(
    `errors       : ${manifest.validation.errorCount}`
  );

  console.log(
    `warnings     : ${manifest.validation.warningCount}`
  );

  console.log(
    `valid        : ${manifest.validation.valid ? 'PASS' : 'FAIL'}`
  );

  if (
    config.dryRun
  ) {
    console.log(
      'mode         : DRY RUN'
    );
  } else {
    console.log(
      `output       : ${config.output}`
    );

    console.log(
      `manifest     : ${config.manifest}`
    );
  }

  console.log(
    '=============================================='
  );

  if (
    manifest.validation
      .warnings.length > 0
  ) {
    console.log('');
    console.log(
      '[Warnings]'
    );

    for (
      const warning of
      manifest.validation
        .warnings
        .slice(0, 20)
    ) {
      console.log(
        `- ${warning.chunkId} / ${warning.field}: ${warning.message}`
      );
    }

    if (
      manifest.validation
        .warnings.length >
      20
    ) {
      console.log(
        `... ${manifest.validation.warnings.length - 20} more`
      );
    }
  }

  if (
    manifest.validation
      .errors.length > 0
  ) {
    console.log('');
    console.log(
      '[Errors]'
    );

    for (
      const error of
      manifest.validation
        .errors
        .slice(0, 30)
    ) {
      console.log(
        `- ${error.chunkId} / ${error.field}: ${error.message}`
      );
    }

    if (
      manifest.validation
        .errors.length >
      30
    ) {
      console.log(
        `... ${manifest.validation.errors.length - 30} more`
      );
    }
  }

  console.log('');
}


// ============================================================================
// Main
// ============================================================================

async function main() {
  const config =
    parseArgs(
      process.argv.slice(2)
    );

  const sourceFiles =
    await collectSourceFiles(
      config.input
    );

  if (
    sourceFiles.length === 0
  ) {
    throw new Error(
      `지원되는 RAG 원천 파일이 없습니다: ${config.input}`
    );
  }

  console.log(
    `[RAG BUILD] ${sourceFiles.length} source file(s)`
  );

  const documents = [];

  for (
    const [
      index,
      filePath
    ] of sourceFiles.entries()
  ) {
    const relative =
      path.relative(
        config.input,
        filePath
      );

    console.log(
      `[${index + 1}/${sourceFiles.length}] ${relative}`
    );

    const built =
      await buildFile(
        filePath,
        config
      );

    documents.push(
      ...built
    );
  }

  const validation =
    validateCorpus(
      documents
    );

  const manifest =
    buildManifest({
      config,
      sourceFiles,
      documents,
      validation
    });

  printBuildSummary(
    manifest,
    config
  );

  if (
    !validation.valid
  ) {
    process.exitCode = 1;
    return;
  }

  if (
    !config.dryRun
  ) {
    await writeOutputs({
      config,
      documents,
      manifest
    });
  }
}

main()
  .catch(
    (error) => {
      console.error('');
      console.error(
        '=============================================='
      );

      console.error(
        ' SG-RAG-BUILD-001'
      );

      console.error(
        ' stage: BUILD_RAG_CORPUS'
      );

      console.error(
        ` message: ${error?.message || String(error)}`
      );

      console.error(
        '=============================================='
      );

      if (
        error?.stack
      ) {
        console.error(
          error.stack
        );
      }

      process.exitCode = 1;
    }
  );
