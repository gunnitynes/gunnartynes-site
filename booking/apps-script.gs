/**
 * Booking requests for catalogue.gunnartynes.com / www.gunnartynes.com
 *
 * Each request from the booking page becomes a row in the Google Sheet this script belongs to,
 * and an email arrives in the inbox of the Google account that owns it. Reply to that email to answer
 * the person directly. Your address never appears on the website.
 *
 * Setting it up once:
 *  1. Make a new Google Sheet, called for example "Booking requests".
 *  2. In the Sheet: Extensions > Apps Script. Delete what is there and paste this whole file. Save.
 *  3. Choose the function "setup" at the top and press Run. Allow the permissions it asks for.
 *     It writes the column headings and sends you one test email.
 *  4. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *  5. Copy the Web app URL (it ends in /exec) and give it to Claude, who puts it in booking/config.js.
 *
 * The Status column is yours: New, Replied, Booked, Declined, or anything you like.
 */

const TYPES = ['Film & TV', 'Production', 'Recording', 'Mixing', 'Performance', 'Theatre & dance', 'Collaboration', 'Something else'];
const HEADERS = ['Received', 'Status', 'Reference', 'Work', 'Name', 'Email', 'Organisation', 'Project', 'Details', 'About',
  'Links', 'Date', 'Deadline', 'Flexible', 'Country', 'City', 'Budget'];
const MAX_PER_HOUR = 20;      // all requests together
const MAX_PER_SENDER = 3;     // from one email address, per hour

function setup() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Booking requests are connected',
    'This is the test email from your booking script. New requests from the website will arrive like this, and as rows in the Sheet.');
}

function doGet() {
  return json({ ok: true, service: 'booking' });
}

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // Spam traps: a hidden field people never see, and a form filled in faster than a person could.
    if (d.website || !(Number(d.t) > 3000)) return json({ ok: true, ref: ref() });

    const clean = {};
    for (const k of ['type', 'title', 'format', 'stage', 'artist', 'songs', 'mode', 'venue', 'about', 'links', 'date', 'deadline',
      'flexible', 'country', 'city', 'budget', 'name', 'email', 'org']) {
      clean[k] = String(d[k] == null ? '' : d[k]).slice(0, k === 'about' ? 4000 : 1000).trim();
    }
    if (TYPES.indexOf(clean.type) < 0) return json({ ok: false, error: 'type' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email) || !clean.name) return json({ ok: false, error: 'contact' });
    if (!(clean.date || clean.flexible) || !clean.country) return json({ ok: false, error: 'when' });

    const cache = CacheService.getScriptCache();
    const hourKey = 'h' + Math.floor(Date.now() / 3600000);
    const senderKey = hourKey + ':' + clean.email.toLowerCase();
    const all = Number(cache.get(hourKey) || 0), mine = Number(cache.get(senderKey) || 0);
    if (all >= MAX_PER_HOUR || mine >= MAX_PER_SENDER) return json({ ok: false, error: 'busy' });
    cache.put(hourKey, String(all + 1), 3700);
    cache.put(senderKey, String(mine + 1), 3700);

    const details = [
      clean.format && 'Format: ' + clean.format, clean.stage && 'Stage: ' + clean.stage,
      clean.artist && 'Artist: ' + clean.artist, clean.songs && 'Songs: ' + clean.songs, clean.mode && 'Working: ' + clean.mode,
      clean.venue && 'Venue: ' + clean.venue
    ].filter(Boolean).join('\n');
    const id = ref();

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
      // A leading = + - or @ would make the Sheet read text as a formula; a quote mark keeps it as text.
      const safe = v => /^[=+\-@]/.test(v) ? "'" + v : v;
      sheet.appendRow([new Date(), 'New', id, clean.type, clean.name, clean.email, clean.org, clean.title, details, clean.about,
        clean.links, clean.date, clean.deadline, clean.flexible ? 'Yes' : '', clean.country, clean.city, clean.budget].map(v => typeof v === 'string' ? safe(v) : v));
    } finally {
      lock.releaseLock();
    }

    const lines = [
      ['Work', clean.type], ['Project', clean.title], ['', details], ['About', clean.about], ['Links', clean.links],
      ['Date', clean.date + (clean.flexible ? ' (flexible)' : '')], ['Deadline', clean.deadline],
      ['Where', [clean.city, clean.country].filter(Boolean).join(', ')], ['Budget', clean.budget],
      ['From', clean.name + (clean.org ? ', ' + clean.org : '') + ' <' + clean.email + '>']
    ].filter(r => r[1]);
    const text = lines.map(r => (r[0] ? r[0] + ': ' : '') + r[1]).join('\n\n');
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const htmlBody = '<div style="font:15px/1.5 Helvetica,Arial,sans-serif;color:#222">' +
      lines.map(r => (r[0] ? '<div style="font:11px monospace;letter-spacing:.1em;text-transform:uppercase;color:#888;margin-top:14px">' + esc(r[0]) + '</div>' : '<div style="margin-top:14px"></div>') + '<div>' + esc(r[1]) + '</div>').join('') +
      '<p style="color:#888;font-size:12px;margin-top:24px">Reference ' + id + '. Reply to this email to answer ' + esc(clean.name) + ' directly.</p></div>';

    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      replyTo: clean.email,
      name: 'Booking: ' + clean.name,
      subject: clean.type + ' request from ' + clean.name + (clean.title ? ': ' + clean.title : ''),
      body: text + '\n\nReference ' + id,
      htmlBody: htmlBody
    });
    return json({ ok: true, ref: id });
  } catch (err) {
    return json({ ok: false, error: 'server' });
  }
}

function ref() {
  const d = new Date(), p = n => ('0' + n).slice(-2);
  return 'GT-' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
