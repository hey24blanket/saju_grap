import {guides} from './tarotGuides.js';
const metadata=[
  {
    "id": "ar00",
    "name": "바보",
    "en": "The Fool",
    "group": "메이저"
  },
  {
    "id": "ar01",
    "name": "마법사",
    "en": "The Magician",
    "group": "메이저"
  },
  {
    "id": "ar02",
    "name": "여사제",
    "en": "The High Priestess",
    "group": "메이저"
  },
  {
    "id": "ar03",
    "name": "여황제",
    "en": "The Empress",
    "group": "메이저"
  },
  {
    "id": "ar04",
    "name": "황제",
    "en": "The Emperor",
    "group": "메이저"
  },
  {
    "id": "ar05",
    "name": "교황",
    "en": "The Hierophant",
    "group": "메이저"
  },
  {
    "id": "ar06",
    "name": "연인",
    "en": "The Lovers",
    "group": "메이저"
  },
  {
    "id": "ar07",
    "name": "전차",
    "en": "The Chariot",
    "group": "메이저"
  },
  {
    "id": "ar08",
    "name": "힘",
    "en": "Strength",
    "group": "메이저"
  },
  {
    "id": "ar09",
    "name": "은둔자",
    "en": "The Hermit",
    "group": "메이저"
  },
  {
    "id": "ar10",
    "name": "운명의 수레바퀴",
    "en": "Wheel of Fortune",
    "group": "메이저"
  },
  {
    "id": "ar11",
    "name": "정의",
    "en": "Justice",
    "group": "메이저"
  },
  {
    "id": "ar12",
    "name": "매달린 사람",
    "en": "The Hanged Man",
    "group": "메이저"
  },
  {
    "id": "ar13",
    "name": "죽음",
    "en": "Death",
    "group": "메이저"
  },
  {
    "id": "ar14",
    "name": "절제",
    "en": "Temperance",
    "group": "메이저"
  },
  {
    "id": "ar15",
    "name": "악마",
    "en": "The Devil",
    "group": "메이저"
  },
  {
    "id": "ar16",
    "name": "탑",
    "en": "The Tower",
    "group": "메이저"
  },
  {
    "id": "ar17",
    "name": "별",
    "en": "The Star",
    "group": "메이저"
  },
  {
    "id": "ar18",
    "name": "달",
    "en": "The Moon",
    "group": "메이저"
  },
  {
    "id": "ar19",
    "name": "태양",
    "en": "The Sun",
    "group": "메이저"
  },
  {
    "id": "ar20",
    "name": "심판",
    "en": "Judgement",
    "group": "메이저"
  },
  {
    "id": "ar21",
    "name": "세계",
    "en": "The World",
    "group": "메이저"
  },
  {
    "id": "waac",
    "name": "완드 에이스",
    "en": "Ace of Wands",
    "group": "완드"
  },
  {
    "id": "wa02",
    "name": "완드 2",
    "en": "Two of Wands",
    "group": "완드"
  },
  {
    "id": "wa03",
    "name": "완드 3",
    "en": "Three of Wands",
    "group": "완드"
  },
  {
    "id": "wa04",
    "name": "완드 4",
    "en": "Four of Wands",
    "group": "완드"
  },
  {
    "id": "wa05",
    "name": "완드 5",
    "en": "Five of Wands",
    "group": "완드"
  },
  {
    "id": "wa06",
    "name": "완드 6",
    "en": "Six of Wands",
    "group": "완드"
  },
  {
    "id": "wa07",
    "name": "완드 7",
    "en": "Seven of Wands",
    "group": "완드"
  },
  {
    "id": "wa08",
    "name": "완드 8",
    "en": "Eight of Wands",
    "group": "완드"
  },
  {
    "id": "wa09",
    "name": "완드 9",
    "en": "Nine of Wands",
    "group": "완드"
  },
  {
    "id": "wa10",
    "name": "완드 10",
    "en": "Ten of Wands",
    "group": "완드"
  },
  {
    "id": "wapa",
    "name": "완드 시종",
    "en": "Page of Wands",
    "group": "완드"
  },
  {
    "id": "wakn",
    "name": "완드 기사",
    "en": "Knight of Wands",
    "group": "완드"
  },
  {
    "id": "waqu",
    "name": "완드 여왕",
    "en": "Queen of Wands",
    "group": "완드"
  },
  {
    "id": "waki",
    "name": "완드 왕",
    "en": "King of Wands",
    "group": "완드"
  },
  {
    "id": "cuac",
    "name": "컵 에이스",
    "en": "Ace of Cups",
    "group": "컵"
  },
  {
    "id": "cu02",
    "name": "컵 2",
    "en": "Two of Cups",
    "group": "컵"
  },
  {
    "id": "cu03",
    "name": "컵 3",
    "en": "Three of Cups",
    "group": "컵"
  },
  {
    "id": "cu04",
    "name": "컵 4",
    "en": "Four of Cups",
    "group": "컵"
  },
  {
    "id": "cu05",
    "name": "컵 5",
    "en": "Five of Cups",
    "group": "컵"
  },
  {
    "id": "cu06",
    "name": "컵 6",
    "en": "Six of Cups",
    "group": "컵"
  },
  {
    "id": "cu07",
    "name": "컵 7",
    "en": "Seven of Cups",
    "group": "컵"
  },
  {
    "id": "cu08",
    "name": "컵 8",
    "en": "Eight of Cups",
    "group": "컵"
  },
  {
    "id": "cu09",
    "name": "컵 9",
    "en": "Nine of Cups",
    "group": "컵"
  },
  {
    "id": "cu10",
    "name": "컵 10",
    "en": "Ten of Cups",
    "group": "컵"
  },
  {
    "id": "cupa",
    "name": "컵 시종",
    "en": "Page of Cups",
    "group": "컵"
  },
  {
    "id": "cukn",
    "name": "컵 기사",
    "en": "Knight of Cups",
    "group": "컵"
  },
  {
    "id": "cuqu",
    "name": "컵 여왕",
    "en": "Queen of Cups",
    "group": "컵"
  },
  {
    "id": "cuki",
    "name": "컵 왕",
    "en": "King of Cups",
    "group": "컵"
  },
  {
    "id": "peac",
    "name": "펜타클 에이스",
    "en": "Ace of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe02",
    "name": "펜타클 2",
    "en": "Two of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe03",
    "name": "펜타클 3",
    "en": "Three of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe04",
    "name": "펜타클 4",
    "en": "Four of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe05",
    "name": "펜타클 5",
    "en": "Five of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe06",
    "name": "펜타클 6",
    "en": "Six of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe07",
    "name": "펜타클 7",
    "en": "Seven of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe08",
    "name": "펜타클 8",
    "en": "Eight of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe09",
    "name": "펜타클 9",
    "en": "Nine of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pe10",
    "name": "펜타클 10",
    "en": "Ten of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pepa",
    "name": "펜타클 시종",
    "en": "Page of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pekn",
    "name": "펜타클 기사",
    "en": "Knight of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "pequ",
    "name": "펜타클 여왕",
    "en": "Queen of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "peki",
    "name": "펜타클 왕",
    "en": "King of Pentacles",
    "group": "펜타클"
  },
  {
    "id": "swac",
    "name": "소드 에이스",
    "en": "Ace of Swords",
    "group": "소드"
  },
  {
    "id": "sw02",
    "name": "소드 2",
    "en": "Two of Swords",
    "group": "소드"
  },
  {
    "id": "sw03",
    "name": "소드 3",
    "en": "Three of Swords",
    "group": "소드"
  },
  {
    "id": "sw04",
    "name": "소드 4",
    "en": "Four of Swords",
    "group": "소드"
  },
  {
    "id": "sw05",
    "name": "소드 5",
    "en": "Five of Swords",
    "group": "소드"
  },
  {
    "id": "sw06",
    "name": "소드 6",
    "en": "Six of Swords",
    "group": "소드"
  },
  {
    "id": "sw07",
    "name": "소드 7",
    "en": "Seven of Swords",
    "group": "소드"
  },
  {
    "id": "sw08",
    "name": "소드 8",
    "en": "Eight of Swords",
    "group": "소드"
  },
  {
    "id": "sw09",
    "name": "소드 9",
    "en": "Nine of Swords",
    "group": "소드"
  },
  {
    "id": "sw10",
    "name": "소드 10",
    "en": "Ten of Swords",
    "group": "소드"
  },
  {
    "id": "swpa",
    "name": "소드 시종",
    "en": "Page of Swords",
    "group": "소드"
  },
  {
    "id": "swkn",
    "name": "소드 기사",
    "en": "Knight of Swords",
    "group": "소드"
  },
  {
    "id": "swqu",
    "name": "소드 여왕",
    "en": "Queen of Swords",
    "group": "소드"
  },
  {
    "id": "swki",
    "name": "소드 왕",
    "en": "King of Swords",
    "group": "소드"
  }
];
export const cards=metadata.map(c=>({...c,guide:guides[c.id],keywords:guides[c.id].theme,symbol:guides[c.id].picture,upright:guides[c.id].upright,reversed:guides[c.id].reversed}));
export function shuffleDeck(reverse=false){const deck=cards.map(c=>({id:c.id,reversed:reverse&&crypto.getRandomValues(new Uint32Array(1))[0]%2===1}));for(let i=deck.length-1;i>0;i--){const range=i+1,limit=Math.floor(4294967296/range)*range;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);let j=n%range;[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
