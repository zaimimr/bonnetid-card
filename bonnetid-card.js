const VERSION = '1.1.0';
const API = 'https://disp-api.bonnetider.eu/rest/v1';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgyMzI2MzU2LCJleHAiOjIwOTc2ODYzNTZ9.Z2ukipzy8HRp3aZ3qGjnRYEkn6n-Kh-XGUphYDijt-w';
const ZONE = 'Europe/Oslo';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JUMMAH_GRACE_MINUTES = 30;
const REFRESH_AFTER = 6 * HOUR;
const RETRY_AFTER = 5 * MINUTE;
const NO_MOSQUE = 'none';
const AUTO = 'auto';

const LABELS = {
  fajr: 'Fajr',
  fajr_endtime: 'Soloppgang',
  duhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

const ICONS = {
  fajr: 'mdi:weather-night',
  fajr_endtime: 'mdi:weather-sunset-up',
  duhr: 'mdi:white-balance-sunny',
  asr: 'mdi:weather-partly-cloudy',
  maghrib: 'mdi:weather-sunset-down',
  isha: 'mdi:moon-waning-crescent',
  midnight: 'mdi:sleep',
};

const JAMAT_COLUMNS = { fajr: 'fajr', duhr: 'dhuhr', asr: 'asr', maghrib: 'maghrib', isha: 'isha' };

const HIJRI_MONTHS = [
  'Muharram',
  'Safar',
  'Rabi al-Awal',
  'Rabi at-thani',
  'Jumadi al-Awwal',
  'Jumadi al-Thani',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  'Dhul Qa’da',
  'Dhul-hijja',
];

const ASR_METHODS = [
  { value: AUTO, label: 'Automatisk (moské eller sted)' },
  { value: 'irn', label: 'IRN standard' },
  { value: 'shadow_1x', label: '1x skygge' },
  { value: 'shadow_2x', label: '2x skygge (Hanafi)' },
  { value: 'wusta', label: 'Wusta' },
];

const THEMES = [
  { value: 'app', label: 'Bønnetid-appen' },
  { value: 'ha', label: 'Home Assistant-temaet' },
];

const ASR_BY_NUMBER = ['irn', 'shadow_1x', 'shadow_2x', 'wusta'];

const AXIS_LABELS = [
  [0, '00:00'],
  [0.25, '06:00'],
  [0.5, '12:00'],
  [0.75, '18:00'],
  [1, '24:00'],
];

const requests = new Map();

function get(path, params) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  if (!requests.has(url)) {
    const request = fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then(
      (response) => {
        if (!response.ok) throw new Error(`Bønnetid API ${response.status}`);
        return response.json();
      },
    );
    request.catch(() => requests.delete(url));
    requests.set(url, request);
  }
  return requests.get(url);
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const clockFormatter = new Intl.DateTimeFormat('nb-NO', {
  timeZone: ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

function zonedParts(date) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((part) => [part.type, Number(part.value)]),
  );
  return parts;
}

function offsetAt(ms) {
  const p = zonedParts(new Date(ms));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

function osloInstant(isoDate, clock) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hours, minutes] = clock.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  const first = wall - offsetAt(wall);
  const second = wall - offsetAt(first);
  return new Date(second);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dayKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function isFriday(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 5;
}

function hhmm(time) {
  return time ? time.slice(0, 5) : null;
}

function jamatClock(time) {
  const trimmed = hhmm(time);
  return trimmed === '00:00' ? null : trimmed;
}

function nearInstant(isoDate, clock, reference) {
  return [-1, 0, 1]
    .map((shift) => osloInstant(addDays(isoDate, shift), clock))
    .reduce((best, candidate) =>
      Math.abs(candidate - reference) < Math.abs(best - reference) ? candidate : best,
    );
}

function clock(date) {
  return clockFormatter.format(date);
}

function countdown(to, now) {
  const seconds = Math.max(0, Math.floor((to - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `om ${hours}t ${minutes}m`;
  if (minutes > 0) return `om ${minutes} min`;
  return 'om under 1 min';
}

function timer(to, now) {
  const seconds = Math.max(0, Math.floor((to - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function escape(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function mosqueName(row) {
  return row.org_name2?.trim() || row.reg_navn || row.organisasjonsnummer;
}

function asrFromNumber(value) {
  if (value == null || value === '') return null;
  return ASR_BY_NUMBER[Number(value)] ?? null;
}

function asrClock(row, method) {
  const preferred =
    method === 'shadow_1x'
      ? row.shadow_1x
      : method === 'shadow_2x'
        ? row.shadow_2x
        : method === 'wusta'
          ? row.wusta_noon_sunset
          : row.asr;
  return hhmm(preferred ?? row.asr);
}

async function loadSource(config, today) {
  const mosqueId = config.mosque && config.mosque !== NO_MOSQUE ? config.mosque : null;
  const from = today;
  const to = addDays(today, 2);

  const mosque = mosqueId
    ? (
        await get('mosque_t', [
          [
            'select',
            'organisasjonsnummer,reg_navn,org_name2,asr_method,location_postnumber(location_iso),mosque_jummah(jummah,jamat_id)',
          ],
          ['organisasjonsnummer', `eq.${mosqueId}`],
        ])
      )[0] ?? null
    : null;

  const locationIso = config.location || mosque?.location_postnumber?.location_iso;
  if (!locationIso) throw new Error('Fant ikke stedet til moskeen');

  const [locations, rows, hijri, periods] = await Promise.all([
    get('location_t', [
      ['select', 'location_iso,location_name,asr_method'],
      ['location_iso', `eq.${locationIso}`],
    ]),
    get('prayertime', [
      [
        'select',
        'date,prayer_method,fajr,fajr_endtime,shuruq_sunrise,duhr,asr,shadow_1x,shadow_2x,wusta_noon_sunset,maghrib,isha,muntasafallayl_midnight',
      ],
      ['location_iso', `eq.${locationIso}`],
      ['date', `gte.${from}`],
      ['date', `lte.${to}`],
      ['order', 'date,prayer_method'],
    ]),
    get('hijri_dates', [
      ['select', 'gregorian_date,hijri_date_day,hijri_date_month,hijri_date_year'],
      ['gregorian_date', `gte.${from}`],
      ['gregorian_date', `lte.${to}`],
    ]),
    mosqueId
      ? get('mosque_jamatperiode', [
          [
            'select',
            'start_date,end_date,fajr,dhuhr,asr,maghrib,isha,fajr_offset,dhuhr_offset,asr_offset,maghrib_offset,isha_offset,mosque_jummah(jummah)',
          ],
          ['mosque_id', `eq.${mosqueId}`],
          ['start_date', `lte.${to}`],
          ['end_date', `gte.${from}`],
          ['order', 'start_date.desc'],
        ])
      : Promise.resolve([]),
  ]);

  const location = locations[0] ?? null;
  const seen = new Set();
  const days = rows.filter((row) => !seen.has(row.date) && seen.add(row.date));

  return { location, locationIso, mosque, periods, days, hijri };
}

function effectiveAsr(config, source) {
  if (config.asr_method && config.asr_method !== AUTO) return config.asr_method;
  const mosqueInLocation = source.mosque?.location_postnumber?.location_iso === source.locationIso;
  const fromMosque = mosqueInLocation ? asrFromNumber(source.mosque.asr_method) : null;
  return fromMosque ?? asrFromNumber(source.location?.asr_method) ?? 'shadow_1x';
}

function periodFor(periods, isoDate) {
  return (
    periods.find(
      (period) =>
        (!period.start_date || isoDate >= period.start_date) &&
        (!period.end_date || isoDate <= period.end_date),
    ) ?? null
  );
}

function jummahClocks(source, period) {
  const mosqueLevel = source.mosque?.mosque_jummah ?? [];
  const usesPeriods = mosqueLevel.some((entry) => entry.jamat_id != null);
  const list = usesPeriods ? (period?.mosque_jummah ?? []) : mosqueLevel;
  return [...new Set(list.map((entry) => hhmm(entry.jummah)).filter(Boolean))].sort();
}

function buildDay(row, source, asrMethod) {
  const date = row.date;
  const period = source.mosque ? periodFor(source.periods, date) : null;
  const slots = [
    ['fajr', hhmm(row.fajr), true],
    ['fajr_endtime', hhmm(row.fajr_endtime), false],
    ['duhr', hhmm(row.duhr), true],
    ['asr', asrClock(row, asrMethod), true],
    ['maghrib', hhmm(row.maghrib), true],
    ['isha', hhmm(row.isha), true],
  ];

  const entries = slots
    .filter(([, time]) => time)
    .map(([kind, time, isPrayer]) => ({
      kind,
      label: LABELS[kind],
      at: osloInstant(date, time),
      isPrayer,
      end: null,
      jamat: null,
      jummahAt: null,
      jummahEnd: null,
    }));

  entries.forEach((entry, index) => {
    if (entry.kind === 'isha') {
      const midnight = hhmm(row.muntasafallayl_midnight);
      if (midnight) {
        const sameDay = osloInstant(date, midnight);
        entry.end = sameDay > entry.at ? sameDay : osloInstant(addDays(date, 1), midnight);
      }
      return;
    }
    if (!entry.isPrayer) return;
    if (entry.kind === 'fajr') {
      const sunrise = hhmm(row.fajr_endtime ?? row.shuruq_sunrise);
      if (sunrise) {
        entry.end = osloInstant(date, sunrise);
        return;
      }
    }
    entry.end = entries[index + 1]?.at ?? null;
  });

  for (const entry of entries) {
    const column = JAMAT_COLUMNS[entry.kind];
    if (!period || !column) continue;
    const offset = period[`${column}_offset`];
    const fixed = jamatClock(period[column]);
    if (offset) entry.jamat = new Date(entry.at.getTime() + offset * MINUTE);
    else if (fixed) entry.jamat = nearInstant(date, fixed, entry.at);
  }

  if (source.mosque && isFriday(date)) {
    const clocks = jummahClocks(source, period);
    const duhr = entries.find((entry) => entry.kind === 'duhr');
    if (duhr && clocks.length > 0) {
      duhr.jummahAt = osloInstant(date, clocks[0]);
      duhr.jummahEnd = new Date(
        osloInstant(date, clocks[clocks.length - 1]).getTime() + JUMMAH_GRACE_MINUTES * MINUTE,
      );
    }
  }

  const hijri = source.hijri.find((day) => day.gregorian_date === date);
  const hijriText = hijri
    ? `${hijri.hijri_date_day}. ${HIJRI_MONTHS[hijri.hijri_date_month - 1] ?? ''} ${hijri.hijri_date_year}`
    : '';

  return { date, hijriText, prayers: entries };
}

function resolved(entry, now) {
  if (!entry.jummahAt) return { ...entry, isJummah: false };
  const open = now < entry.jummahEnd;
  return {
    ...entry,
    label: open ? 'Jumuah' : entry.label,
    jamat: open ? entry.jummahAt : entry.jamat,
    isJummah: open,
  };
}

function printedAt(entry, showJamat) {
  if (!showJamat && entry.isJummah && entry.jamat) return entry.jamat;
  return entry.at;
}

function resolveMoment(days, now) {
  const prayers = days
    .flatMap((day) => day.prayers)
    .filter((entry) => entry.isPrayer)
    .sort((a, b) => a.at - b.at)
    .map((entry) => resolved(entry, now));
  const nextIndex = prayers.findIndex((entry) => entry.at > now);
  if (nextIndex < 0) return null;

  const todayKey = dayKey(now);
  const today = days.find((day) => day.date === todayKey);
  const started = today?.prayers
    .filter((entry) => entry.isPrayer && entry.at <= now)
    .sort((a, b) => a.at - b.at)
    .pop();
  const current = started && !(started.end && now >= started.end) ? resolved(started, now) : null;

  const next = prayers[nextIndex];
  const headline = current ?? next;
  const headlineDay = days.find((day) => day.date === dayKey(headline.at)) ?? days[0];

  return {
    current,
    next,
    headline,
    isNow: current != null,
    stateLabel: current ? 'Nå' : 'Neste',
    windowStart: prayers[nextIndex - 1]?.at ?? now,
    hijriText: today?.hijriText ?? days[0]?.hijriText ?? '',
    daily: headlineDay.prayers.filter((entry) => entry.isPrayer).map((entry) => resolved(entry, now)),
    today,
  };
}

function buildTimeline(day, now) {
  if (!day) return null;
  const start = osloInstant(day.date, '00:00');
  const length = osloInstant(addDays(day.date, 1), '00:00') - start;
  const fraction = (date) => (date - start) / length;
  const marks = day.prayers
    .map((entry) => ({
      kind: entry.kind,
      at: entry.at,
      icon: ICONS[entry.kind],
      fraction: fraction(entry.at),
      isPrayer: entry.isPrayer,
    }))
    .filter((mark) => mark.fraction >= 0 && mark.fraction <= 1);

  const isha = day.prayers.find((entry) => entry.kind === 'isha');
  if (isha?.end) {
    const value = fraction(isha.end);
    if (value >= 0 && value <= 1) {
      marks.push({ kind: 'midnight', at: isha.end, icon: ICONS.midnight, fraction: value, isPrayer: false });
    }
  }
  if (marks.length === 0) return null;

  return {
    marks: marks.sort((a, b) => a.at - b.at),
    progress: Math.min(Math.max(fraction(now), 0), 1),
  };
}

function placeable(marks, minGap, highlighted) {
  const rank = (mark) => {
    if (highlighted && mark.at.getTime() === highlighted.getTime()) return 0;
    if (mark.kind === 'midnight') return 3;
    return mark.isPrayer ? 1 : 2;
  };
  const placed = [];
  for (const mark of [...marks].sort((a, b) => rank(a) - rank(b) || a.at - b.at)) {
    if (placed.some((other) => Math.abs(other.fraction - mark.fraction) < minGap)) continue;
    placed.push(mark);
  }
  return placed.sort((a, b) => a.at - b.at);
}

function position(fraction, slot) {
  return `left:clamp(${slot / 2}px, ${fraction * 100}%, calc(100% - ${slot / 2}px))`;
}

const STYLES = `
  :host { display: block; height: 100%; }
  ha-card {
    --brand: #0C6B52; --brand-plate: #D3EAE0; --on-brand-plate: #074536; --surface: #FFFFFF;
    --ink: #182420; --ink-secondary: #3E4C46; --ink-muted: #5F6E67; --track: #EDF1EF;
    --track-marker: #C3CEC8;
    box-sizing: border-box; height: 100%; padding: 16px; overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--surface); color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  ha-card.dark {
    --brand: #6FBA9D; --brand-plate: #27362F; --on-brand-plate: #D3EAE0; --surface: #151F1B;
    --ink: #F6F8F7; --ink-secondary: #C6D0CB; --ink-muted: #8C9A93; --track: #27362F;
    --track-marker: #354740;
  }
  ha-card.theme {
    --brand: var(--primary-color); --brand-plate: rgba(var(--rgb-primary-color, 3, 169, 244), 0.16);
    --on-brand-plate: var(--primary-text-color); --surface: var(--ha-card-background, var(--card-background-color));
    --ink: var(--primary-text-color); --ink-secondary: var(--secondary-text-color);
    --ink-muted: var(--secondary-text-color); --track: var(--divider-color);
    --track-marker: var(--disabled-text-color, var(--divider-color));
  }
  .tight { min-height: 4px; }
  .row { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .caption { font-size: 12px; line-height: 16px; }
  .caption2 { font-size: 11px; line-height: 13px; }
  .muted { color: var(--ink-muted); }
  .secondary { color: var(--ink-secondary); }
  .brand { color: var(--brand); }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .spacer { flex: 1 1 auto; min-height: 8px; }
  ha-icon { --mdc-icon-size: 13px; display: inline-flex; flex: none; }
  .headline { font-size: 17px; line-height: 22px; font-weight: 600; }
  .big { font-size: 34px; line-height: 41px; font-weight: 700; letter-spacing: -0.5px; }
  .columns { display: flex; gap: 4px; }
  .column {
    flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 6px 2px; border-radius: 10px;
  }
  .column .label { color: var(--ink-muted); }
  .column .time { font-size: 15px; line-height: 20px; font-weight: 500; color: var(--ink); }
  .column .jamat { color: var(--brand); }
  .column.current { background: var(--brand-plate); }
  .column.current .label, .column.current .time, .column.current .jamat { color: var(--on-brand-plate); }
  .column.current .time { font-weight: 700; }
  .footer { font-weight: 500; }
  .top { display: flex; justify-content: space-between; gap: 8px; }
  .title2 { font-size: 22px; line-height: 28px; font-weight: 700; }
  .sub { font-size: 15px; line-height: 20px; }
  .split { display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; margin: 10px 0; }
  .right { text-align: right; }
  .bar { position: relative; height: 44px; flex: none; }
  .bar > * { position: absolute; transform: translateX(-50%); }
  .bar .track, .bar .fill { transform: none; top: 18px; height: 9px; border-radius: 4.5px; }
  .bar .track { left: 0; right: 0; background: var(--track); }
  .bar .fill { left: 0; background: var(--brand); }
  .bar .tick { top: 18px; width: 1px; height: 9px; background: var(--track-marker); }
  .bar .tick.passed { background: var(--surface); }
  .bar .marker { top: 15px; width: 2px; height: 15px; border-radius: 1px; background: var(--track-marker); }
  .bar .knob {
    top: 16px; width: 9px; height: 9px; border-radius: 50%;
    background: var(--brand); border: 2px solid var(--surface);
  }
  .bar .glyph {
    top: 0; width: 19px; height: 16px; display: flex; align-items: center; justify-content: center;
    color: var(--ink-muted); --mdc-icon-size: 11px;
  }
  .bar .glyph.highlight { color: var(--brand); }
  .bar .axis { top: 31px; font-size: 9px; line-height: 13px; color: var(--ink-muted); white-space: nowrap; }
  .empty ha-icon { --mdc-icon-size: 22px; color: var(--brand); margin-bottom: 6px; }
  .empty .headline { margin-bottom: 4px; }
`;

class BonnetidCard extends HTMLElement {
  static variant = 'small';

  static getStubConfig() {
    return { location: 'NO0301', show_jamat: false };
  }

  static getConfigElement() {
    return document.createElement('bonnetid-card-editor');
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._source = null;
    this._error = null;
    this._loadedAt = 0;
    this._loadedDay = null;
    this._loading = false;
    this._html = '';
    this._barWidth = 300;
  }

  get variant() {
    return this.constructor.variant;
  }

  setConfig(config) {
    if (!config.location && (!config.mosque || config.mosque === NO_MOSQUE)) {
      throw new Error('Velg et sted eller en moské');
    }
    const changed = JSON.stringify(config) !== JSON.stringify(this._config);
    this._config = config;
    if (changed) {
      this._source = null;
      this._error = null;
      this._loadedAt = 0;
      this._load();
    }
  }

  set hass(hass) {
    this._dark = Boolean(hass?.themes?.darkMode);
    this._render();
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return this.variant === 'small'
      ? { columns: 6, rows: 3, min_columns: 6, min_rows: 3 }
      : { columns: 12, rows: 3, min_columns: 9, min_rows: this.variant === 'medium' ? 2 : 3 };
  }

  connectedCallback() {
    this._timer = setInterval(() => this._tick(), 1000);
    this._tick();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._resize?.disconnect();
  }

  _tick() {
    const now = Date.now();
    const stale = this._loadedDay !== dayKey(new Date(now)) || now - this._loadedAt > REFRESH_AFTER;
    const retry = this._error && now - this._loadedAt > RETRY_AFTER;
    if ((stale || retry) && this._config) this._load();
    this._render();
  }

  async _load() {
    if (this._loading || !this._config) return;
    this._loading = true;
    const config = this._config;
    const today = dayKey(new Date());
    try {
      const source = await loadSource(config, today);
      if (config !== this._config) return;
      this._source = source;
      this._error = null;
    } catch (error) {
      if (config !== this._config) return;
      this._error = error;
    } finally {
      this._loading = false;
      this._loadedAt = Date.now();
      this._loadedDay = today;
      this._render();
    }
  }

  _render() {
    if (!this._config) return;
    const now = new Date();
    const view = this._view(now);
    const html = `<style>${STYLES}</style><ha-card class="${this._config.theme === 'ha' ? 'theme' : this._dark ? 'dark' : ''}">${view.html}</ha-card>`;
    if (html !== this._html) {
      this._html = html;
      this.shadowRoot.innerHTML = html;
      this._observeBar();
    }
    view.live?.(this.shadowRoot);
  }

  _observeBar() {
    const bar = this.shadowRoot.querySelector('.bar');
    this._resize?.disconnect();
    if (!bar) return;
    this._resize = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0 && width !== this._barWidth) {
        this._barWidth = width;
        this._render();
      }
    });
    this._resize.observe(bar);
  }

  _view(now) {
    if (!this._source) {
      return this._error
        ? this._message('mdi:alert-circle-outline', 'Fikk ikke hentet tidene', this._error.message)
        : this._message('mdi:clock-outline', 'Bønnetid', 'Henter tider…');
    }
    const asr = effectiveAsr(this._config, this._source);
    const days = this._source.days.map((row) => buildDay(row, this._source, asr));
    const moment = resolveMoment(days, now);
    if (!moment) {
      return this._message(
        'mdi:calendar-remove-outline',
        'Ingen tider',
        'Fant ingen bønnetider for dette stedet de neste dagene.',
      );
    }
    const context = {
      now,
      moment,
      days,
      showJamat: Boolean(this._config.show_jamat),
      hasJamat: days.some((day) => day.prayers.some((entry) => entry.jamat || entry.jummahAt)),
      locationName: this._source.location?.location_name ?? '',
    };
    if (this.variant === 'medium') return this._medium(context);
    if (this.variant === 'timeline') return this._timeline(context);
    return this._small(context);
  }

  _message(icon, title, text) {
    return {
      html: `<div class="empty"><ha-icon icon="${icon}"></ha-icon><div class="headline">${escape(title)}</div><div class="caption secondary">${escape(text)}</div></div>`,
    };
  }

  _small({ now, moment, showJamat }) {
    const shown = moment.headline;
    const time = printedAt(shown, false);
    const jamat =
      showJamat && shown.jamat && !shown.isJummah
        ? `<div class="caption brand">Jamat ${clock(shown.jamat)}</div>`
        : '';
    const wait = countdown(moment.next.at, now);
    const line = moment.isNow ? `${moment.next.label} ${wait}` : wait;
    return {
      html: `
        <div class="caption muted">${moment.stateLabel}</div>
        <div class="row brand" style="margin-top:3px">
          <ha-icon icon="${ICONS[shown.kind]}"></ha-icon>
          <span class="headline ellipsis">${shown.label}</span>
        </div>
        <div class="big">${clock(time)}</div>
        ${jamat}
        <div class="spacer"></div>
        <div class="caption secondary">${line}</div>`,
    };
  }

  _medium({ now, moment, showJamat, hasJamat, locationName }) {
    const currentAt = moment.current?.at.getTime();
    const columns = moment.daily
      .map((entry) => {
        const isCurrent = entry.at.getTime() === currentAt;
        const jamat =
          showJamat && entry.jamat ? `<span class="caption2 jamat">${clock(entry.jamat)}</span>` : '';
        return `
          <div class="column${isCurrent ? ' current' : ''}">
            <span class="caption2 label ellipsis">${entry.label}</span>
            <span class="time">${clock(printedAt(entry, showJamat))}</span>
            ${jamat}
          </div>`;
      })
      .join('');
    const wait = `${moment.next.label} ${countdown(moment.next.at, now)}`;
    const footer = moment.isNow ? `${moment.headline.label} nå · ${wait}` : wait;
    const hijri = moment.hijriText
      ? `<span class="caption muted">·</span><span class="caption muted ellipsis">${escape(moment.hijriText)}</span>`
      : '';
    return {
      html: `
        <div class="row" style="gap:6px">
          <span class="caption secondary ellipsis" style="flex:none">${escape(locationName)}</span>
          ${hijri}
        </div>
        <div class="spacer tight"></div>
        <div class="columns">${columns}</div>
        <div class="spacer tight"></div>
        <div class="row brand">
          <ha-icon icon="${ICONS[moment.headline.kind]}" style="--mdc-icon-size:11px"></ha-icon>
          <span class="caption footer ellipsis">${footer}</span>
          ${showJamat && hasJamat ? '<span class="caption2 muted" style="flex:none">· jamat</span>' : ''}
        </div>`,
    };
  }

  _timeline({ now, moment, showJamat }) {
    const timeline = buildTimeline(moment.today, now);
    const headline = moment.headline;
    const nextAt = moment.next.at;
    const marker = timeline?.marks.find((mark) => mark.at.getTime() === nextAt.getTime());
    const jamat =
      showJamat && headline.jamat && !headline.isJummah ? ` · jamat ${clock(headline.jamat)}` : '';
    const upcoming = moment.isNow
      ? `<div class="sub secondary">${moment.next.label} ${clock(nextAt)}</div>`
      : '';

    let bar = '';
    if (timeline) {
      const passed = (mark) => mark.fraction <= timeline.progress;
      const glyphs = placeable(timeline.marks, 19 / this._barWidth, marker?.at)
        .map(
          (mark) =>
            `<div class="glyph${mark === marker ? ' highlight' : ''}" style="${position(mark.fraction, 19)}"><ha-icon icon="${mark.icon}"></ha-icon></div>`,
        )
        .join('');
      const ticks = timeline.marks
        .map((mark) => `<div class="tick${passed(mark) ? ' passed' : ''}" style="${position(mark.fraction, 1)}"></div>`)
        .join('');
      const axis = AXIS_LABELS.map(
        ([fraction, text]) => `<div class="axis" style="${position(fraction, 30)}">${text}</div>`,
      ).join('');
      bar = `
        <div class="bar">
          <div class="track"></div>
          <div class="fill"></div>
          ${ticks}
          ${marker ? `<div class="marker" style="${position(marker.fraction, 2)}"></div>` : ''}
          <div class="knob"></div>
          ${glyphs}
          ${axis}
        </div>`;
    }

    return {
      html: `
        <div class="top">
          <span class="caption muted ellipsis">${moment.isNow ? 'Nåværende bønn' : 'Neste bønn'}</span>
          <span class="caption muted ellipsis">Tid igjen til neste salah</span>
        </div>
        <div class="split">
          <div style="min-width:0">
            <div class="title2 brand ellipsis">${headline.label}</div>
            <div class="sub secondary">${clock(printedAt(headline, false))}${jamat}</div>
          </div>
          <div class="right">
            <div class="title2" data-timer></div>
            ${upcoming}
          </div>
        </div>
        <div class="spacer" style="min-height:0"></div>
        ${bar}`,
      live: (root) => {
        const timerNode = root.querySelector('[data-timer]');
        if (timerNode) timerNode.textContent = timer(nextAt, new Date());
        if (!timeline) return;
        const progress = buildTimeline(moment.today, new Date())?.progress ?? timeline.progress;
        const fill = root.querySelector('.fill');
        const knob = root.querySelector('.knob');
        if (fill) fill.style.width = `max(9px, ${progress * 100}%)`;
        if (knob) knob.setAttribute('style', position(progress, 13));
      },
    };
  }
}

class BonnetidSmallCard extends BonnetidCard {
  static variant = 'small';
}

class BonnetidMediumCard extends BonnetidCard {
  static variant = 'medium';
}

class BonnetidTimelineCard extends BonnetidCard {
  static variant = 'timeline';
}

const FORM_LABELS = {
  location: 'Sted',
  mosque: 'Moské (for jamat og Jumuah)',
  show_jamat: 'Vis jamat-tider',
  asr_method: 'Asr-metode',
  theme: 'Utseende',
};

class BonnetidCardEditor extends HTMLElement {
  constructor() {
    super();
    this._locations = [];
    this._mosques = [];
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  connectedCallback() {
    if (this._requested) return;
    this._requested = true;
    Promise.all([
      get('location_t', [
        ['select', 'location_iso,location_name'],
        ['order', 'location_name'],
      ]),
      get('mosque_t', [
        ['select', 'organisasjonsnummer,reg_navn,org_name2,map_only,location_postnumber(post_name,location_iso)'],
        ['order', 'reg_navn'],
      ]),
    ])
      .then(([locations, mosques]) => {
        this._locations = locations;
        this._mosques = mosques
          .filter((row) => !row.map_only)
          .map((row) => ({
            value: row.organisasjonsnummer,
            label: `${mosqueName(row)}${row.location_postnumber?.post_name ? `, ${row.location_postnumber.post_name}` : ''}`,
            locationIso: row.location_postnumber?.location_iso ?? null,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'nb'));
        this._render();
      })
      .catch(() => {});
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (schema) => FORM_LABELS[schema.name] ?? schema.name;
      this._form.addEventListener('value-changed', (event) => this._changed(event.detail.value));
      this.appendChild(this._form);
    }
    const location = this._config.location ?? '';
    const locationOptions = this._locations.length
      ? this._locations.map((row) => ({ value: row.location_iso, label: row.location_name }))
      : location
        ? [{ value: location, label: location }]
        : [];
    const mosque = this._config.mosque ?? NO_MOSQUE;
    const mosqueOptions = [
      { value: NO_MOSQUE, label: 'Ingen moské' },
      ...(this._mosques.length
        ? this._mosques
        : mosque !== NO_MOSQUE
          ? [{ value: mosque, label: mosque }]
          : []),
    ];
    this._form.hass = this._hass;
    this._form.schema = [
      { name: 'location', selector: { select: { mode: 'dropdown', options: locationOptions } } },
      { name: 'mosque', selector: { select: { mode: 'dropdown', options: mosqueOptions } } },
      { name: 'show_jamat', selector: { boolean: {} } },
      { name: 'asr_method', selector: { select: { mode: 'dropdown', options: ASR_METHODS } } },
      { name: 'theme', selector: { select: { mode: 'dropdown', options: THEMES } } },
    ];
    this._form.data = {
      location,
      mosque,
      show_jamat: Boolean(this._config.show_jamat),
      asr_method: this._config.asr_method ?? AUTO,
      theme: this._config.theme ?? 'app',
    };
  }

  _changed(value) {
    const config = { ...this._config, ...value };
    if (value.mosque !== (this._config.mosque ?? NO_MOSQUE)) {
      const picked = this._mosques.find((entry) => entry.value === value.mosque);
      if (picked?.locationIso) config.location = picked.locationIso;
    }
    if (!config.mosque || config.mosque === NO_MOSQUE) delete config.mosque;
    if (!config.asr_method || config.asr_method === AUTO) delete config.asr_method;
    if (config.theme !== 'ha') delete config.theme;
    if (!config.location) delete config.location;
    this._config = config;
    this.dispatchEvent(
      new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }),
    );
  }
}

const CARDS = [
  ['bonnetid-small-card', BonnetidSmallCard, 'Bønnetid: Neste bønn', 'Bønnen som pågår eller kommer, med tiden som er igjen.'],
  ['bonnetid-medium-card', BonnetidMediumCard, 'Bønnetid: Dagens tider', 'Dagens fem bønner, med jamat-tider fra moskeen hvis du vil.'],
  ['bonnetid-timeline-card', BonnetidTimelineCard, 'Bønnetid: Tidslinje', 'Døgnet fra 00:00 til 24:00 med bønnene og nedtelling til den neste.'],
];

for (const [tag, element] of CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, element);
}
if (!customElements.get('bonnetid-card-editor')) {
  customElements.define('bonnetid-card-editor', BonnetidCardEditor);
}

window.customCards = window.customCards || [];
for (const [type, , name, description] of CARDS) {
  if (!window.customCards.some((card) => card.type === type)) {
    window.customCards.push({ type, name, description, preview: true, documentationURL: 'https://github.com/zaimimr/bonnetid-card' });
  }
}

console.info(`%c BØNNETID-CARD %c ${VERSION} `, 'color:#fff;background:#0C6B52;font-weight:700', 'color:#0C6B52');
