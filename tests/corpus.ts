/**
 * Self-written sentences (fictional, Apache-2.0) used to build encoding test texts.
 * Each list only uses characters its target encodings can represent.
 */

export const JAPANESE = [
  '本日の会議は午後二時から第三会議室で行います。',
  '倉庫の在庫を確認し、不足している品目を報告してください。',
  '来週の月曜日は祝日のため、事務所は休みです。',
  '新しい名簿を作成しましたので、内容をご確認ください。',
  '夏の社員旅行の行き先は、海の近くの温泉に決まりました。',
  'お客様からの問い合わせには、三日以内に返事をすること。',
  '会計の締め切りは毎月二十五日です。',
  'コピー機の修理は明日の午前中に終わる予定です。',
  'ファイルの整理を手伝ってくれる方を募集しています。',
  '昨年度の売上は前年より一割ほど増えました。',
  '駅前の文具店で封筒と切手を買ってきてください。',
  'パソコンの使い方の講習会を開きます。',
];

export const LATIN = [
  'Nous avons bien reçu votre lettre du 3 mars.',
  'Die Sitzung beginnt pünktlich um neun Uhr im großen Saal.',
  'Le café est fermé le dimanche, mais la boulangerie reste ouverte.',
  'Bitte schicken Sie die Rechnung an unser Büro in München.',
  'La señora García llegará el miércoles por la mañana.',
  'Les élèves présenteront leurs résultats à la fin du trimestre.',
  'Für Rückfragen stehen wir Ihnen gern zur Verfügung.',
  '¿Podría confirmar la reserva para el próximo año?',
  'Total à payer : 125 € toutes taxes comprises.',
  'Æble, øl og rødgrød med fløde stod på menuen.',
  'Il a déjà envoyé le reçu à l’hôtel « Le Lys ».',
  'Prix spécial – valable jusqu’au 30 juin.',
];

/** Plain English for EBCDIC: letters, digits and common punctuation present in every EBCDIC page tested. */
export const ENGLISH = [
  'The quarterly ledger was closed on the last working day of the month.',
  'Please return the signed forms to the payroll office by Friday.',
  'Account 4471 shows a balance of 1250.00 after the March adjustments.',
  'The printer in room 12 is out of ribbons again.',
  'All batch jobs must finish before the nightly backup starts.',
  'Shipping charges are included in the total for each invoice.',
  'The audit team will visit the warehouse next Tuesday.',
  'Customer records are sorted by region and then by surname.',
];

/** Deterministic pseudo-random generator (mulberry32) so test texts are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Joins random sentences (with line breaks) until the text has at least `minChars` characters. */
export function makeText(sentences: readonly string[], minChars: number, random: () => number): string {
  let text = '';
  while (text.length < minChars) {
    text += sentences[Math.floor(random() * sentences.length)]!;
    text += random() < 0.3 ? '\r\n' : ' ';
  }
  return text.trimEnd();
}
