// Client-agnostic email reply cleaner. Matches the Cloudflare Worker implementation.
// Used only for existing, already-imported email messages; no Firestore writes.
'use strict';
(() => {
function extractLatestEmailReply(value) {
  const original = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .trim();
  if (!original) return '';
  const lines = original.split('\n');
  const tidy = v => String(v || '').trim();
  const dateCue = /(?:\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\b|\b\d{1,2}[:\/.\-]\d{1,2}\b|\b20\d{2}\b|@)/i;
  function attributionStartsAt(i) {
    const first = tidy(lines[i]);
    if (!/^(?:On|Am|Le|El|Em|Il|Dnia|Op)\s+\S/i.test(first)) return false;
    for (let end = i; end < Math.min(lines.length, i + 6); end++) {
      const joined = lines.slice(i, end + 1).map(tidy).join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 700) break;
      if (!dateCue.test(joined)) continue;
      if (/^(?:On|Op)\s+.+\b(?:wrote|schreef)\s*:\s*$/i.test(joined) ||
          /^(?:Am|Dnia)\s+.+\b(?:schrieb\b|napisa(?:ł|l|ła|la))[^:]{0,200}:\s*$/i.test(joined) ||
          /^(?:Le|El|Em|Il)\s+.+\b(?:a\s+écrit|escribi[oó]|escreveu|ha\s+scritto)\s*:\s*$/i.test(joined)) {
        return true;
      }
      if (/\b(?:wrote|schrieb|schreef|escribi[oó]|escreveu|scritto)\s*:/i.test(joined)) break;
    }
    return false;
  }
  function outlookHeaderStartsAt(i) {
    if (!/^\s*From\s*:\s*/i.test(lines[i])) return false;
    const labels = new Set();
    for (let j=i; j < Math.min(lines.length, i+8); j++) {
      const key=tidy(lines[j]).match(/^(From|Sent|Date|To|Cc|Subject)\s*:/i)?.[1]?.toLowerCase();
      if (key) labels.add(key);
    }
    return labels.has('from') && labels.size >= 3 && (labels.has('sent') || labels.has('date'));
  }
  function isBoundary(i) {
    const line = tidy(lines[i]);
    if (!line) return false;
    if (/^>/.test(line)) return true;
    if (/^(?:-{2,}\s*(?:Original\s+Message|Forwarded\s+message|Mensaje\s+original|Message\s+d.origine|Urspr[uü]ngliche\s+Nachricht)\s*-{2,}|Begin\s+forwarded\s+message\s*:|Forwarded\s+message\s*:)/i.test(line)) return true;
    if (/^(?:_{8,}|-{8,})$/.test(line)) {
      // A decorative separator inside a user's own message is not a quote.
      return Array.from({length: Math.min(7, lines.length-i-1)}, (_, j) => i+j+1)
        .some(next => outlookHeaderStartsAt(next) || attributionStartsAt(next));
    }
    return outlookHeaderStartsAt(i) || attributionStartsAt(i);
  }
  let cut = lines.length;
  for (let i=0; i<lines.length; i++) {
    if (isBoundary(i)) { cut = i; break; }
  }
  let reply = lines.slice(0, cut).join('\n').trim();
  // Delete only known, *terminal* mail-app signatures, including inline mobile
  // signatures. Never remove arbitrary sentences, signatures or line breaks.
  const appSignature = /(?:^|\n|[ \t]+)(?:Sent from my (?:iPhone|iPad|Android|Samsung Galaxy|mobile device)|Get Outlook for (?:iOS|Android)|Sent from Outlook for (?:iOS|Android)|Sent with Spark|Sent from Yahoo Mail(?: for (?:iPhone|Android))?|Sent from Proton Mail)[.!]?[ \t]*$/i;
  while (appSignature.test(reply)) reply = reply.replace(appSignature, '').trim();
  return reply.replace(/\n{3,}/g, '\n\n').trim();
}
  globalThis.rebatatrackCleanEmailReply = extractLatestEmailReply;
})();
