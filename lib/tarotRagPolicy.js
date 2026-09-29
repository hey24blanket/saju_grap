const TAROT=/tarot|타로|라이더.?웨이트|rider.?waite|아르카나|arcana/i;
const COMMON=/common.mind|dialogue|human.support|counsel|상담|심리|의사결정|대화|불확실|윤리/i;
const SAJU=/saju|사주|명리|십신|용신|간지|오행|engine.facts/i;
export function classify(d){const metadata=JSON.stringify([d.title,d.category,d.categoryIds,d.categories,d.domain,d.knowledgeLayer,d.reviewedManifest?.category,d.metadata?.keywords]);const content=typeof d.content==='string'?d.content:typeof d.explanation==='string'?d.explanation:'';if(TAROT.test(metadata)||TAROT.test(content))return'tarot';if(COMMON.test(metadata)&&!SAJU.test(metadata+' '+content))return'common';return null}
export function approvedUnit(d){return d.status==='approved'&&!!d.reviewedAt&&d.retrievalAllowed!==false&&d.isActive!==false&&!d.isNegative;}
