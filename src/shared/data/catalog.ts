import type { Faker } from '@faker-js/faker';
import type { FieldInfo } from '../types';
import { formatDate, isoWeek, nativeDateFormat } from './format';
import { getLocale, type LocaleDef } from './locales';
import { makeEmail, makePersona, strongPassword, type Persona } from './persona';

export type DataCategory =
  | 'person'
  | 'contact'
  | 'address'
  | 'company'
  | 'finance'
  | 'datetime'
  | 'number'
  | 'text'
  | 'identifier'
  | 'commerce'
  | 'web'
  | 'choice'
  | 'custom';

export const CATEGORIES: { id: DataCategory; label: string }[] = [
  { id: 'person', label: 'Person' },
  { id: 'contact', label: 'Contact & account' },
  { id: 'address', label: 'Address' },
  { id: 'company', label: 'Company' },
  { id: 'finance', label: 'Payment & finance' },
  { id: 'datetime', label: 'Date & time' },
  { id: 'number', label: 'Numbers' },
  { id: 'text', label: 'Text' },
  { id: 'identifier', label: 'Codes & identifiers' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'web', label: 'Web & network' },
  { id: 'choice', label: 'Choices' },
  { id: 'custom', label: 'Custom' },
];

export interface DataOption {
  key: string;
  label: string;
  kind: 'number' | 'text' | 'select' | 'boolean' | 'textarea';
  default: string | number | boolean;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  help?: string;
  placeholder?: string;
}

export interface GenContext {
  faker: Faker;
  locale: LocaleDef;
  persona: () => Persona;
  field?: FieldInfo;
  /** 1-based iteration number. */
  iteration: number;
  emailDomain?: string;
  /** Sequential counters for list/sequence generators, keyed by step id. */
  counters?: Map<string, number>;
  counterKey?: string;
}

type Opts = Record<string, unknown>;

export interface DataTypeDef {
  id: string;
  label: string;
  category: DataCategory;
  description: string;
  keywords?: string;
  options?: DataOption[];
  /** Resolved against the live element at run time. */
  runtime?: 'select' | 'radio' | 'checkbox';
  /** The value comes from the iteration persona unless persona is turned off. */
  usesPersona?: boolean;
  generate: (ctx: GenContext, o: Opts) => string;
}

const num = (v: unknown, d: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = '') => (v === undefined || v === null || v === '' ? d : String(v));
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : v === undefined ? d : v === 'true');

const PERSONA_OPTION: DataOption = {
  key: 'persona',
  label: 'Match other fields',
  kind: 'boolean',
  default: true,
  help: 'Use the same generated person for every field in an iteration, so names, email and address agree.',
};

const DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: '2026-03-14' },
  { value: 'MM/DD/YYYY', label: '03/14/2026' },
  { value: 'DD/MM/YYYY', label: '14/03/2026' },
  { value: 'DD.MM.YYYY', label: '14.03.2026' },
  { value: 'MMM D, YYYY', label: 'Mar 14, 2026' },
  { value: 'D MMMM YYYY', label: '14 March 2026' },
  { value: 'ISO', label: 'ISO 8601 timestamp' },
  { value: 'unix', label: 'Unix seconds' },
];

const DATE_FORMAT_OPTION: DataOption = { key: 'format', label: 'Format', kind: 'select', default: 'YYYY-MM-DD', choices: DATE_FORMATS };

function pickPersona<K extends keyof Persona>(ctx: GenContext, o: Opts, key: K, fresh: () => string): string {
  if (bool(o.persona, true)) return String(ctx.persona()[key]);
  return fresh();
}

function dateOut(ctx: GenContext, d: Date, o: Opts): string {
  const native = nativeDateFormat(ctx.field?.type);
  if (ctx.field?.type === 'week') return isoWeek(d);
  return formatDate(d, native ?? str(o.format, 'YYYY-MM-DD'));
}

const TEST_CARDS: Record<string, string[]> = {
  visa: ['4242424242424242', '4111111111111111', '4012888888881881', '4000056655665556'],
  mastercard: ['5555555555554444', '5105105105105100', '2223003122003222'],
  amex: ['378282246310005', '371449635398431'],
  discover: ['6011111111111117', '6011000990139424'],
};

function luhnComplete(prefix: string, length: number, f: Faker): string {
  let digits = prefix;
  while (digits.length < length - 1) digits += f.number.int({ min: 0, max: 9 });
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = parseInt(digits[digits.length - 1 - i], 10);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits + ((10 - (sum % 10)) % 10);
}

function fromList(ctx: GenContext, o: Opts): string {
  const items = str(o.items)
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) return '';
  if (str(o.order, 'random') === 'sequential') {
    const key = ctx.counterKey ?? 'list';
    const n = ctx.counters?.get(key) ?? 0;
    ctx.counters?.set(key, n + 1);
    return items[n % items.length];
  }
  return ctx.faker.helpers.arrayElement(items);
}

export const DATA_TYPES: DataTypeDef[] = [
  // ── Person ────────────────────────────────────────────────────────────────
  { id: 'person.fullName', label: 'Full name', category: 'person', description: 'First and last name', usesPersona: true, options: [PERSONA_OPTION], keywords: 'name', generate: (c, o) => pickPersona(c, o, 'fullName', () => c.faker.person.fullName()) },
  { id: 'person.firstName', label: 'First name', category: 'person', description: 'Given name', usesPersona: true, options: [PERSONA_OPTION], keywords: 'given forename', generate: (c, o) => pickPersona(c, o, 'firstName', () => c.faker.person.firstName()) },
  { id: 'person.lastName', label: 'Last name', category: 'person', description: 'Family name', usesPersona: true, options: [PERSONA_OPTION], keywords: 'surname family', generate: (c, o) => pickPersona(c, o, 'lastName', () => c.faker.person.lastName()) },
  { id: 'person.middleName', label: 'Middle name', category: 'person', description: 'Middle name', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => pickPersona(c, o, 'middleName', () => c.faker.person.middleName()) },
  { id: 'person.prefix', label: 'Title / prefix', category: 'person', description: 'Mr., Ms., Dr.', usesPersona: true, options: [PERSONA_OPTION], keywords: 'salutation honorific', generate: (c, o) => pickPersona(c, o, 'prefix', () => c.faker.person.prefix()) },
  { id: 'person.gender', label: 'Gender', category: 'person', description: 'Female or male', usesPersona: true, options: [PERSONA_OPTION, { key: 'case', label: 'Style', kind: 'select', default: 'title', choices: [{ value: 'title', label: 'Female' }, { value: 'lower', label: 'female' }, { value: 'letter', label: 'F' }] }], keywords: 'sex', generate: (c, o) => {
    const sex = bool(o.persona, true) ? c.persona().sex : (c.faker.person.sexType() as string);
    const style = str(o.case, 'title');
    if (style === 'letter') return sex[0].toUpperCase();
    if (style === 'lower') return sex;
    return sex[0].toUpperCase() + sex.slice(1);
  } },
  { id: 'person.age', label: 'Age', category: 'person', description: 'Age in years', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => (bool(o.persona, true) ? String(c.persona().age) : String(c.faker.number.int({ min: 18, max: 80 }))) },
  { id: 'person.birthdate', label: 'Date of birth', category: 'person', description: 'Adult birth date', usesPersona: true, options: [PERSONA_OPTION, DATE_FORMAT_OPTION], keywords: 'dob birthday', generate: (c, o) => dateOut(c, bool(o.persona, true) ? c.persona().birthdate : c.faker.date.birthdate({ mode: 'age', min: 18, max: 75 }), o) },
  { id: 'person.birthDay', label: 'Birth day', category: 'person', description: 'Day of month (1-31)', usesPersona: true, options: [PERSONA_OPTION, { key: 'pad', label: 'Two digits', kind: 'boolean', default: false }], generate: (c, o) => { const d = (bool(o.persona, true) ? c.persona().birthdate : c.faker.date.birthdate()).getDate(); return bool(o.pad, false) ? String(d).padStart(2, '0') : String(d); } },
  { id: 'person.birthMonth', label: 'Birth month', category: 'person', description: 'Month number or name', usesPersona: true, options: [PERSONA_OPTION, { key: 'style', label: 'Style', kind: 'select', default: 'number', choices: [{ value: 'number', label: '3' }, { value: 'padded', label: '03' }, { value: 'name', label: 'March' }, { value: 'short', label: 'Mar' }] }], generate: (c, o) => { const d = bool(o.persona, true) ? c.persona().birthdate : c.faker.date.birthdate(); const s = str(o.style, 'number'); return formatDate(d, s === 'padded' ? 'MM' : s === 'name' ? 'MMMM' : s === 'short' ? 'MMM' : 'M'); } },
  { id: 'person.birthYear', label: 'Birth year', category: 'person', description: 'Four digit year', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => String((bool(o.persona, true) ? c.persona().birthdate : c.faker.date.birthdate()).getFullYear()) },
  { id: 'person.jobTitle', label: 'Job title', category: 'person', description: 'Role or position', usesPersona: true, options: [PERSONA_OPTION], keywords: 'position occupation role', generate: (c, o) => pickPersona(c, o, 'jobTitle', () => c.faker.person.jobTitle()) },
  { id: 'person.bio', label: 'Short bio', category: 'person', description: 'One-line personal bio', keywords: 'about me', generate: (c) => c.faker.person.bio() },

  // ── Contact & account ─────────────────────────────────────────────────────
  { id: 'internet.email', label: 'Email address', category: 'contact', description: 'Realistic address based on the person', usesPersona: true, keywords: 'mail e-mail', options: [PERSONA_OPTION, { key: 'domain', label: 'Domain', kind: 'text', default: '', placeholder: 'Uses the default from Settings', help: 'Use a catch-all or disposable domain you control when the site sends real emails.' }], generate: (c, o) => {
    const explicit = str(o.domain);
    if (bool(o.persona, true)) {
      const p = c.persona();
      return explicit ? `${p.email.split('@')[0]}@${explicit.replace(/^@/, '')}` : p.email;
    }
    return makeEmail(c.faker, c.faker.person.firstName(), c.faker.person.lastName(), explicit || c.emailDomain);
  } },
  { id: 'internet.username', label: 'Username', category: 'contact', description: 'Handle derived from the name', usesPersona: true, options: [PERSONA_OPTION], keywords: 'login handle nickname user', generate: (c, o) => pickPersona(c, o, 'username', () => c.faker.internet.username()) },
  { id: 'internet.password', label: 'Password', category: 'contact', description: 'Strong password with upper, lower, digit and symbol', usesPersona: true, keywords: 'secret pass pwd', options: [PERSONA_OPTION, { key: 'length', label: 'Length', kind: 'number', default: 14, min: 6, max: 64 }, { key: 'symbols', label: 'Include symbols', kind: 'boolean', default: true }], generate: (c, o) => {
    const len = num(o.length, 14);
    const symbols = bool(o.symbols, true);
    if (bool(o.persona, true) && len === 14 && symbols) return c.persona().password;
    return strongPassword(c.faker, len, symbols);
  } },
  { id: 'phone.number', label: 'Phone number', category: 'contact', description: 'Local phone number format', usesPersona: true, keywords: 'mobile cell telephone', options: [PERSONA_OPTION, { key: 'style', label: 'Format', kind: 'select', default: 'national', choices: [{ value: 'national', label: 'National' }, { value: 'international', label: 'International' }, { value: 'mobile', label: 'Mobile' }, { value: 'human', label: 'Mixed' }] }], generate: (c, o) => {
    const style = str(o.style, 'national') as 'national' | 'international' | 'mobile' | 'human';
    if (bool(o.persona, true) && style === 'national') return c.persona().phone;
    return c.faker.phone.number({ style });
  } },
  { id: 'phone.digits', label: 'Phone (digits only)', category: 'contact', description: 'Phone number without punctuation', usesPersona: true, options: [PERSONA_OPTION, { key: 'length', label: 'Digits', kind: 'number', default: 10, min: 5, max: 15 }], generate: (c, o) => {
    const len = num(o.length, 10);
    const base = bool(o.persona, true) ? c.persona().phone.replace(/\D/g, '') : '';
    if (base.length >= len) return base.slice(-len);
    return c.faker.string.numeric({ length: len, allowLeadingZeros: false });
  } },
  { id: 'phone.countryCode', label: 'Phone country code', category: 'contact', description: 'Dialling prefix such as +1', generate: (c) => {
    const map: Record<string, string> = { US: '+1', CA: '+1', GB: '+44', AU: '+61', IN: '+91', DE: '+49', FR: '+33', ES: '+34', MX: '+52', IT: '+39', NL: '+31', BR: '+55', PL: '+48', SE: '+46', TR: '+90', JP: '+81' };
    return map[c.locale.countryCode] ?? '+1';
  } },

  // ── Address ───────────────────────────────────────────────────────────────
  { id: 'address.street', label: 'Street address', category: 'address', description: 'House number and street', usesPersona: true, options: [PERSONA_OPTION], keywords: 'address line 1 addr', generate: (c, o) => pickPersona(c, o, 'street', () => c.faker.location.streetAddress()) },
  { id: 'address.secondary', label: 'Apartment / suite', category: 'address', description: 'Address line 2', usesPersona: true, options: [PERSONA_OPTION], keywords: 'address line 2 apt unit', generate: (c, o) => pickPersona(c, o, 'secondary', () => c.faker.location.secondaryAddress()) },
  { id: 'address.city', label: 'City', category: 'address', description: 'City or town', usesPersona: true, options: [PERSONA_OPTION], keywords: 'town locality', generate: (c, o) => pickPersona(c, o, 'city', () => c.faker.location.city()) },
  { id: 'address.state', label: 'State / province', category: 'address', description: 'Full state or region name', usesPersona: true, options: [PERSONA_OPTION], keywords: 'region county province', generate: (c, o) => pickPersona(c, o, 'state', () => c.faker.location.state()) },
  { id: 'address.stateAbbr', label: 'State code', category: 'address', description: 'Abbreviated state, e.g. CA', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => pickPersona(c, o, 'stateAbbr', () => c.faker.location.state({ abbreviated: true })) },
  { id: 'address.zip', label: 'ZIP / postal code', category: 'address', description: 'Postal code that matches the state', usesPersona: true, options: [PERSONA_OPTION], keywords: 'postcode postal zip', generate: (c, o) => pickPersona(c, o, 'zip', () => c.faker.location.zipCode()) },
  { id: 'address.country', label: 'Country', category: 'address', description: 'Country of the data locale', usesPersona: true, options: [PERSONA_OPTION, { key: 'any', label: 'Any country', kind: 'boolean', default: false }], generate: (c, o) => (bool(o.any, false) ? c.faker.location.country() : pickPersona(c, o, 'country', () => c.faker.location.country())) },
  { id: 'address.countryCode', label: 'Country code', category: 'address', description: 'ISO alpha-2 code', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => pickPersona(c, o, 'countryCode', () => c.faker.location.countryCode()) },
  { id: 'address.full', label: 'Full address', category: 'address', description: 'Street, city, state and ZIP on one line', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => {
    const p = bool(o.persona, true) ? c.persona() : makePersona(c.locale);
    return `${p.street}, ${p.city}, ${p.stateAbbr || p.state} ${p.zip}`.trim();
  } },
  { id: 'address.latitude', label: 'Latitude', category: 'address', description: 'Decimal degrees', generate: (c) => String(c.faker.location.latitude()) },
  { id: 'address.longitude', label: 'Longitude', category: 'address', description: 'Decimal degrees', generate: (c) => String(c.faker.location.longitude()) },
  { id: 'address.timezone', label: 'Time zone', category: 'address', description: 'IANA zone such as Europe/Berlin', generate: (c) => c.faker.location.timeZone() },

  // ── Company ───────────────────────────────────────────────────────────────
  { id: 'company.name', label: 'Company name', category: 'company', description: 'Business name', usesPersona: true, options: [PERSONA_OPTION], keywords: 'organization organisation employer business', generate: (c, o) => pickPersona(c, o, 'company', () => c.faker.company.name()) },
  { id: 'company.catchPhrase', label: 'Slogan', category: 'company', description: 'Marketing catch phrase', keywords: 'tagline', generate: (c) => c.faker.company.catchPhrase() },
  { id: 'company.department', label: 'Department', category: 'company', description: 'Team or department', generate: (c) => c.faker.commerce.department() },
  { id: 'company.website', label: 'Website', category: 'company', description: 'Homepage URL based on the person', usesPersona: true, options: [PERSONA_OPTION], keywords: 'url homepage site', generate: (c, o) => pickPersona(c, o, 'website', () => c.faker.internet.url()) },
  { id: 'company.employees', label: 'Company size', category: 'company', description: 'Employee count', generate: (c) => String(c.faker.helpers.arrayElement([5, 12, 25, 48, 120, 250, 800, 1500, 5000])) },

  // ── Finance ───────────────────────────────────────────────────────────────
  { id: 'finance.creditCard', label: 'Card number', category: 'finance', description: 'Test card numbers accepted by payment sandboxes', keywords: 'credit debit cc pan', options: [{ key: 'issuer', label: 'Network', kind: 'select', default: 'visa', choices: [{ value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }, { value: 'amex', label: 'American Express' }, { value: 'discover', label: 'Discover' }] }, { key: 'testOnly', label: 'Use sandbox test numbers', kind: 'boolean', default: true, help: 'Well-known numbers such as 4242 4242 4242 4242 that payment providers treat as test cards.' }, { key: 'spaced', label: 'Group digits', kind: 'boolean', default: false }], generate: (c, o) => {
    const issuer = str(o.issuer, 'visa');
    let n: string;
    if (bool(o.testOnly, true)) n = c.faker.helpers.arrayElement(TEST_CARDS[issuer] ?? TEST_CARDS.visa);
    else {
      const prefix = issuer === 'amex' ? '37' : issuer === 'mastercard' ? '51' : issuer === 'discover' ? '6011' : '4';
      n = luhnComplete(prefix, issuer === 'amex' ? 15 : 16, c.faker);
    }
    if (!bool(o.spaced, false)) return n;
    return issuer === 'amex' ? `${n.slice(0, 4)} ${n.slice(4, 10)} ${n.slice(10)}` : n.replace(/(\d{4})(?=\d)/g, '$1 ');
  } },
  { id: 'finance.cvv', label: 'Card security code', category: 'finance', description: 'CVV / CVC', keywords: 'cvc csc security code', options: [{ key: 'length', label: 'Digits', kind: 'number', default: 3, min: 3, max: 4 }], generate: (c, o) => c.faker.string.numeric({ length: num(o.length, 3), allowLeadingZeros: false }) },
  { id: 'finance.expiry', label: 'Card expiry', category: 'finance', description: 'Future month and year', keywords: 'expiration exp', options: [{ key: 'format', label: 'Format', kind: 'select', default: 'MM/YY', choices: [{ value: 'MM/YY', label: '08/29' }, { value: 'MM / YY', label: '08 / 29' }, { value: 'MM/YYYY', label: '08/2029' }, { value: 'MMYY', label: '0829' }, { value: 'YYYY-MM', label: '2029-08' }] }], generate: (c, o) => {
    const d = new Date();
    d.setMonth(d.getMonth() + c.faker.number.int({ min: 6, max: 60 }));
    return formatDate(d, nativeDateFormat(c.field?.type) ?? str(o.format, 'MM/YY'));
  } },
  { id: 'finance.expiryMonth', label: 'Expiry month', category: 'finance', description: 'Two-digit month', generate: (c) => String(c.faker.number.int({ min: 1, max: 12 })).padStart(2, '0') },
  { id: 'finance.expiryYear', label: 'Expiry year', category: 'finance', description: 'Year 1-5 years ahead', options: [{ key: 'digits', label: 'Digits', kind: 'select', default: '4', choices: [{ value: '4', label: '2029' }, { value: '2', label: '29' }] }], generate: (c, o) => { const y = new Date().getFullYear() + c.faker.number.int({ min: 1, max: 5 }); return str(o.digits, '4') === '2' ? String(y).slice(-2) : String(y); } },
  { id: 'finance.cardholder', label: 'Name on card', category: 'finance', description: 'Upper-case cardholder name', usesPersona: true, options: [PERSONA_OPTION], generate: (c, o) => pickPersona(c, o, 'fullName', () => c.faker.person.fullName()).toUpperCase() },
  { id: 'finance.iban', label: 'IBAN', category: 'finance', description: 'Format-valid bank account', generate: (c) => c.faker.finance.iban() },
  { id: 'finance.bic', label: 'BIC / SWIFT', category: 'finance', description: 'Bank identifier code', generate: (c) => c.faker.finance.bic() },
  { id: 'finance.accountNumber', label: 'Account number', category: 'finance', description: 'Bank account digits', options: [{ key: 'length', label: 'Digits', kind: 'number', default: 10, min: 4, max: 20 }], generate: (c, o) => c.faker.finance.accountNumber(num(o.length, 10)) },
  { id: 'finance.routingNumber', label: 'Routing number', category: 'finance', description: 'US ABA routing number', generate: (c) => c.faker.finance.routingNumber() },
  { id: 'finance.amount', label: 'Amount', category: 'finance', description: 'Money amount', keywords: 'price total cost sum', options: [{ key: 'min', label: 'Min', kind: 'number', default: 5 }, { key: 'max', label: 'Max', kind: 'number', default: 500 }, { key: 'decimals', label: 'Decimals', kind: 'number', default: 2, min: 0, max: 4 }], generate: (c, o) => c.faker.finance.amount({ min: num(o.min, 5), max: num(o.max, 500), dec: num(o.decimals, 2) }) },
  { id: 'finance.currency', label: 'Currency code', category: 'finance', description: 'ISO 4217 code', generate: (c) => c.faker.finance.currencyCode() },
  { id: 'finance.bitcoin', label: 'Bitcoin address', category: 'finance', description: 'Wallet address', generate: (c) => c.faker.finance.bitcoinAddress() },

  // ── Date & time ───────────────────────────────────────────────────────────
  { id: 'date.past', label: 'Past date', category: 'datetime', description: 'Date within the last N years', options: [DATE_FORMAT_OPTION, { key: 'years', label: 'Years back', kind: 'number', default: 2, min: 1, max: 100 }], generate: (c, o) => dateOut(c, c.faker.date.past({ years: num(o.years, 2) }), o) },
  { id: 'date.future', label: 'Future date', category: 'datetime', description: 'Date within the next N days', keywords: 'appointment booking', options: [DATE_FORMAT_OPTION, { key: 'days', label: 'Days ahead', kind: 'number', default: 60, min: 1, max: 3650 }], generate: (c, o) => { const d = new Date(); d.setDate(d.getDate() + c.faker.number.int({ min: 1, max: num(o.days, 60) })); return dateOut(c, d, o); } },
  { id: 'date.today', label: "Today's date", category: 'datetime', description: 'Current date', options: [DATE_FORMAT_OPTION, { key: 'offset', label: 'Offset days', kind: 'number', default: 0 }], generate: (c, o) => { const d = new Date(); d.setDate(d.getDate() + num(o.offset, 0)); return dateOut(c, d, o); } },
  { id: 'date.time', label: 'Time', category: 'datetime', description: 'Time of day', options: [{ key: 'format', label: 'Format', kind: 'select', default: 'HH:mm', choices: [{ value: 'HH:mm', label: '14:30' }, { value: 'h:mm A', label: '2:30 PM' }, { value: 'HH:mm:ss', label: '14:30:05' }] }], generate: (c, o) => { const d = c.faker.date.anytime(); d.setMinutes(Math.round(d.getMinutes() / 5) * 5); return formatDate(d, nativeDateFormat(c.field?.type) ?? str(o.format, 'HH:mm')); } },
  { id: 'date.datetime', label: 'Date and time', category: 'datetime', description: 'Timestamp within a year', options: [{ key: 'format', label: 'Format', kind: 'select', default: 'YYYY-MM-DD HH:mm', choices: [{ value: 'YYYY-MM-DD HH:mm', label: '2026-03-14 14:30' }, { value: 'ISO', label: 'ISO 8601' }, { value: 'MM/DD/YYYY h:mm A', label: '03/14/2026 2:30 PM' }] }], generate: (c, o) => formatDate(c.faker.date.soon({ days: 365 }), nativeDateFormat(c.field?.type) ?? str(o.format, 'YYYY-MM-DD HH:mm')) },
  { id: 'date.month', label: 'Month', category: 'datetime', description: 'Month name or number', options: [{ key: 'style', label: 'Style', kind: 'select', default: 'name', choices: [{ value: 'name', label: 'March' }, { value: 'short', label: 'Mar' }, { value: 'number', label: '3' }, { value: 'padded', label: '03' }] }], generate: (c, o) => { const m = c.faker.number.int({ min: 0, max: 11 }); const d = new Date(2000, m, 1); const s = str(o.style, 'name'); return formatDate(d, s === 'short' ? 'MMM' : s === 'number' ? 'M' : s === 'padded' ? 'MM' : 'MMMM'); } },
  { id: 'date.year', label: 'Year', category: 'datetime', description: 'Year between bounds', options: [{ key: 'min', label: 'From', kind: 'number', default: 1990 }, { key: 'max', label: 'To', kind: 'number', default: new Date().getFullYear() }], generate: (c, o) => String(c.faker.number.int({ min: num(o.min, 1990), max: num(o.max, new Date().getFullYear()) })) },
  { id: 'date.weekday', label: 'Weekday', category: 'datetime', description: 'Day of the week', generate: (c) => c.faker.date.weekday() },

  // ── Numbers ───────────────────────────────────────────────────────────────
  { id: 'number.int', label: 'Whole number', category: 'number', description: 'Integer in a range (uses the field’s min/max when set)', keywords: 'integer quantity count qty', options: [{ key: 'min', label: 'Min', kind: 'number', default: 1 }, { key: 'max', label: 'Max', kind: 'number', default: 100 }, { key: 'fieldLimits', label: 'Respect the field’s own min and max', kind: 'boolean', default: true }], generate: (c, o) => {
    const useField = bool(o.fieldLimits, true);
    const fmin = useField && c.field?.min !== undefined && c.field.min !== '' ? parseFloat(c.field.min) : NaN;
    const fmax = useField && c.field?.max !== undefined && c.field.max !== '' ? parseFloat(c.field.max) : NaN;
    let min = Number.isFinite(fmin) ? fmin : num(o.min, 1);
    let max = Number.isFinite(fmax) ? fmax : num(o.max, 100);
    if (max < min) [min, max] = [max, min];
    return String(c.faker.number.int({ min: Math.ceil(min), max: Math.floor(max) }));
  } },
  { id: 'number.float', label: 'Decimal number', category: 'number', description: 'Number with decimals', options: [{ key: 'min', label: 'Min', kind: 'number', default: 0 }, { key: 'max', label: 'Max', kind: 'number', default: 1000 }, { key: 'decimals', label: 'Decimals', kind: 'number', default: 2, min: 0, max: 8 }], generate: (c, o) => c.faker.number.float({ min: num(o.min, 0), max: num(o.max, 1000), fractionDigits: num(o.decimals, 2) }).toFixed(num(o.decimals, 2)) },
  { id: 'number.digits', label: 'Digit string', category: 'number', description: 'Fixed number of digits', options: [{ key: 'length', label: 'Digits', kind: 'number', default: 6, min: 1, max: 64 }], generate: (c, o) => c.faker.string.numeric({ length: num(o.length, 6), allowLeadingZeros: true }) },
  { id: 'number.percentage', label: 'Percentage', category: 'number', description: '0 to 100', generate: (c) => String(c.faker.number.int({ min: 0, max: 100 })) },
  { id: 'number.boolean', label: 'True / false', category: 'number', description: 'Boolean text', options: [{ key: 'style', label: 'Style', kind: 'select', default: 'truefalse', choices: [{ value: 'truefalse', label: 'true / false' }, { value: 'yesno', label: 'Yes / No' }, { value: 'onezero', label: '1 / 0' }] }], generate: (c, o) => { const b = c.faker.datatype.boolean(); const s = str(o.style, 'truefalse'); return s === 'yesno' ? (b ? 'Yes' : 'No') : s === 'onezero' ? (b ? '1' : '0') : String(b); } },

  // ── Text ──────────────────────────────────────────────────────────────────
  { id: 'text.word', label: 'Word', category: 'text', description: 'A single word', generate: (c) => c.faker.word.sample() },
  { id: 'text.words', label: 'Words', category: 'text', description: 'A few words', keywords: 'search query keyword', options: [{ key: 'count', label: 'Words', kind: 'number', default: 3, min: 1, max: 30 }], generate: (c, o) => c.faker.word.words(num(o.count, 3)) },
  { id: 'text.sentence', label: 'Sentence', category: 'text', description: 'Readable sentence', keywords: 'subject title headline', options: [{ key: 'words', label: 'Words', kind: 'number', default: 8, min: 2, max: 40 }], generate: (c, o) => { const s = c.faker.word.words(num(o.words, 8)); return s[0].toUpperCase() + s.slice(1) + '.'; } },
  { id: 'text.paragraph', label: 'Paragraph', category: 'text', description: 'Several readable sentences', keywords: 'message comment description notes feedback', options: [{ key: 'sentences', label: 'Sentences', kind: 'number', default: 3, min: 1, max: 20 }], generate: (c, o) => Array.from({ length: num(o.sentences, 3) }, () => { const s = c.faker.word.words(c.faker.number.int({ min: 6, max: 14 })); return s[0].toUpperCase() + s.slice(1) + '.'; }).join(' ') },
  { id: 'text.lorem', label: 'Lorem ipsum', category: 'text', description: 'Placeholder Latin text', options: [{ key: 'sentences', label: 'Sentences', kind: 'number', default: 2, min: 1, max: 20 }], generate: (c, o) => c.faker.lorem.sentences(num(o.sentences, 2)) },
  { id: 'text.title', label: 'Title', category: 'text', description: 'Short title case phrase', generate: (c) => c.faker.word.words(c.faker.number.int({ min: 2, max: 5 })).replace(/\b\w/g, (m) => m.toUpperCase()) },
  { id: 'text.slug', label: 'Slug', category: 'text', description: 'url-friendly-words', generate: (c) => c.faker.lorem.slug(3) },
  { id: 'text.emoji', label: 'Emoji', category: 'text', description: 'A single emoji', generate: (c) => c.faker.internet.emoji() },

  // ── Identifiers ───────────────────────────────────────────────────────────
  { id: 'id.uuid', label: 'UUID', category: 'identifier', description: 'Random v4 UUID', generate: (c) => c.faker.string.uuid() },
  { id: 'id.alphanumeric', label: 'Random code', category: 'identifier', description: 'Letters and digits', keywords: 'coupon promo voucher reference', options: [{ key: 'length', label: 'Length', kind: 'number', default: 8, min: 1, max: 64 }, { key: 'casing', label: 'Case', kind: 'select', default: 'upper', choices: [{ value: 'upper', label: 'ABC123' }, { value: 'lower', label: 'abc123' }, { value: 'mixed', label: 'aBc123' }] }], generate: (c, o) => c.faker.string.alphanumeric({ length: num(o.length, 8), casing: str(o.casing, 'upper') as 'upper' | 'lower' | 'mixed' }) },
  { id: 'id.otp', label: 'One-time code', category: 'identifier', description: 'Numeric verification code', keywords: 'otp pin verification 2fa', options: [{ key: 'length', label: 'Digits', kind: 'number', default: 6, min: 4, max: 10 }], generate: (c, o) => c.faker.string.numeric({ length: num(o.length, 6), allowLeadingZeros: true }) },
  { id: 'id.ssn', label: 'SSN (test)', category: 'identifier', description: 'Format-valid number from the never-issued 9xx range', keywords: 'social security national id', generate: (c) => `9${c.faker.string.numeric(2)}-${c.faker.string.numeric({ length: 2, allowLeadingZeros: false })}-${c.faker.string.numeric({ length: 4, allowLeadingZeros: false })}` },
  { id: 'id.vin', label: 'Vehicle VIN', category: 'identifier', description: '17-character vehicle id', generate: (c) => c.faker.vehicle.vin() },
  { id: 'id.licensePlate', label: 'License plate', category: 'identifier', description: 'Vehicle registration', generate: (c) => c.faker.vehicle.vrm() },
  { id: 'id.isbn', label: 'ISBN', category: 'identifier', description: 'Book number', generate: (c) => c.faker.commerce.isbn() },
  { id: 'id.hex', label: 'Hex string', category: 'identifier', description: 'Hexadecimal characters', options: [{ key: 'length', label: 'Length', kind: 'number', default: 16, min: 1, max: 128 }], generate: (c, o) => c.faker.string.hexadecimal({ length: num(o.length, 16), prefix: '', casing: 'lower' }) },

  // ── Commerce ──────────────────────────────────────────────────────────────
  { id: 'commerce.product', label: 'Product name', category: 'commerce', description: 'Product title', generate: (c) => c.faker.commerce.productName() },
  { id: 'commerce.price', label: 'Price', category: 'commerce', description: 'Price without currency', options: [{ key: 'min', label: 'Min', kind: 'number', default: 1 }, { key: 'max', label: 'Max', kind: 'number', default: 200 }], generate: (c, o) => c.faker.commerce.price({ min: num(o.min, 1), max: num(o.max, 200) }) },
  { id: 'commerce.description', label: 'Product description', category: 'commerce', description: 'Marketing copy', generate: (c) => c.faker.commerce.productDescription() },
  { id: 'commerce.color', label: 'Color name', category: 'commerce', description: 'Human color name', generate: (c) => c.faker.color.human() },
  { id: 'commerce.hexColor', label: 'Hex color', category: 'commerce', description: '#rrggbb', generate: (c) => c.faker.color.rgb({ format: 'hex', casing: 'lower' }) },

  // ── Web & network ─────────────────────────────────────────────────────────
  { id: 'web.url', label: 'URL', category: 'web', description: 'https:// address', keywords: 'link website', generate: (c) => c.faker.internet.url() },
  { id: 'web.domain', label: 'Domain name', category: 'web', description: 'example.com style', generate: (c) => c.faker.internet.domainName() },
  { id: 'web.ipv4', label: 'IPv4 address', category: 'web', description: '192.168.0.1 style', generate: (c) => c.faker.internet.ipv4() },
  { id: 'web.ipv6', label: 'IPv6 address', category: 'web', description: 'Full IPv6', generate: (c) => c.faker.internet.ipv6() },
  { id: 'web.mac', label: 'MAC address', category: 'web', description: 'Network hardware address', generate: (c) => c.faker.internet.mac() },
  { id: 'web.userAgent', label: 'User agent', category: 'web', description: 'Browser user agent string', generate: (c) => c.faker.internet.userAgent() },
  { id: 'web.fileName', label: 'File name', category: 'web', description: 'name.ext', generate: (c) => c.faker.system.fileName() },

  // ── Choices (resolved against the element) ───────────────────────────────
  { id: 'choice.option', label: 'Random option', category: 'choice', description: 'Picks one of the dropdown’s real options, skipping placeholders', runtime: 'select', keywords: 'select dropdown', generate: (c) => {
    const opts = (c.field?.options ?? []).filter((x) => x.value && !/^(select|choose|pick|--|please)/i.test(x.label));
    return opts.length ? c.faker.helpers.arrayElement(opts).label : '';
  } },
  { id: 'choice.radio', label: 'Random choice in group', category: 'choice', description: 'Selects a random radio button from the same group', runtime: 'radio', generate: () => '' },
  { id: 'choice.checkbox', label: 'Random on / off', category: 'choice', description: 'Checks the box with a given probability', runtime: 'checkbox', options: [{ key: 'probability', label: 'Chance checked (%)', kind: 'number', default: 50, min: 0, max: 100 }], generate: (c, o) => (c.faker.number.int({ min: 1, max: 100 }) <= num(o.probability, 50) ? 'true' : 'false') },

  // ── Custom ────────────────────────────────────────────────────────────────
  { id: 'custom.list', label: 'Pick from my list', category: 'custom', description: 'One value from your own list', options: [{ key: 'items', label: 'Values (one per line)', kind: 'textarea', default: 'Alpha\nBravo\nCharlie' }, { key: 'order', label: 'Order', kind: 'select', default: 'random', choices: [{ value: 'random', label: 'Random' }, { value: 'sequential', label: 'In order, one per iteration' }] }], generate: fromList },
  { id: 'custom.sequence', label: 'Numbered sequence', category: 'custom', description: 'user001, user002 … one per iteration', options: [{ key: 'prefix', label: 'Prefix', kind: 'text', default: 'user' }, { key: 'start', label: 'Start at', kind: 'number', default: 1 }, { key: 'padding', label: 'Pad to digits', kind: 'number', default: 3, min: 0, max: 12 }, { key: 'suffix', label: 'Suffix', kind: 'text', default: '' }], generate: (c, o) => `${str(o.prefix)}${String(num(o.start, 1) + c.iteration - 1).padStart(num(o.padding, 3), '0')}${str(o.suffix)}` },
  { id: 'custom.regex', label: 'Match a pattern', category: 'custom', description: 'Generates text that matches a regular expression', options: [{ key: 'pattern', label: 'Pattern', kind: 'text', default: '[A-Z]{3}-[0-9]{4}', help: 'Supports character classes, ranges and {n,m} repetition.' }], generate: (c, o) => { try { return c.faker.helpers.fromRegExp(str(o.pattern, '[A-Z]{3}-[0-9]{4}')); } catch { return ''; } } },
  { id: 'custom.timestamp', label: 'Unique timestamp', category: 'custom', description: 'Milliseconds since 1970, unique per run', generate: () => String(Date.now()) },
];

const BY_ID = new Map(DATA_TYPES.map((d) => [d.id, d]));

export function getDataType(id?: string): DataTypeDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function dataTypeLabel(id?: string): string {
  return getDataType(id)?.label ?? (id || 'Unknown');
}

export function defaultOptions(def: DataTypeDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of def.options ?? []) out[o.key] = o.default;
  return out;
}

export interface GeneratorScope {
  locale: LocaleDef;
  emailDomain?: string;
  iteration: number;
  persona: () => Persona;
  counters: Map<string, number>;
  resetPersona: () => void;
}

/** Creates the per-iteration state that keeps generated values coherent. */
export function createGeneratorScope(localeId: string, opts: { emailDomain?: string; iteration?: number } = {}): GeneratorScope {
  const locale = getLocale(localeId);
  let persona: Persona | undefined;
  const scope: GeneratorScope = {
    locale,
    emailDomain: opts.emailDomain,
    iteration: opts.iteration ?? 1,
    counters: new Map(),
    persona: () => (persona ??= makePersona(locale, { emailDomain: opts.emailDomain })),
    resetPersona: () => {
      persona = undefined;
    },
  };
  return scope;
}

/** Generates one value and applies the field's own constraints (max length, native formats). */
export function generateValue(dataTypeId: string, options: Record<string, unknown> | undefined, scope: GeneratorScope, field?: FieldInfo, counterKey?: string): string {
  const def = getDataType(dataTypeId);
  if (!def) return '';
  const ctx: GenContext = {
    faker: scope.locale.faker,
    locale: scope.locale,
    persona: scope.persona,
    field,
    iteration: scope.iteration,
    emailDomain: scope.emailDomain,
    counters: scope.counters,
    counterKey: counterKey ?? dataTypeId,
  };
  let value = def.generate(ctx, { ...defaultOptions(def), ...(options ?? {}) });
  if (field?.maxLength && field.maxLength > 0 && value.length > field.maxLength && !def.runtime) {
    value = value.slice(0, field.maxLength);
  }
  return value;
}

/** Quick sample for previews in the UI. */
export function sampleValues(dataTypeId: string, options: Record<string, unknown> | undefined, localeId: string, count = 3, field?: FieldInfo, emailDomain?: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const scope = createGeneratorScope(localeId, { iteration: i + 1, emailDomain });
    out.push(generateValue(dataTypeId, options, scope, field));
  }
  return out;
}
