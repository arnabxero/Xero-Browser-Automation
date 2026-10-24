import type { FieldInfo, FieldSuggestion } from '../types';

/**
 * Field type classifier. Combines four kinds of evidence:
 *  1. the HTML autocomplete token (strongest, it is an explicit statement of intent),
 *  2. the input type,
 *  3. keywords in the label, name, id, placeholder and nearby text,
 *  4. the shape of the value the user actually typed while recording.
 * Each signal adds weight to a data type; weights become a confidence via 1 - e^(-1.5·w).
 */

const AUTOCOMPLETE: Record<string, string> = {
  name: 'person.fullName',
  'given-name': 'person.firstName',
  'additional-name': 'person.middleName',
  'family-name': 'person.lastName',
  'honorific-prefix': 'person.prefix',
  nickname: 'internet.username',
  username: 'internet.username',
  email: 'internet.email',
  'new-password': 'internet.password',
  'current-password': 'internet.password',
  'one-time-code': 'id.otp',
  organization: 'company.name',
  'organization-title': 'person.jobTitle',
  'street-address': 'address.street',
  'address-line1': 'address.street',
  'address-line2': 'address.secondary',
  'address-line3': 'address.secondary',
  'address-level2': 'address.city',
  'address-level1': 'address.state',
  country: 'address.countryCode',
  'country-name': 'address.country',
  'postal-code': 'address.zip',
  'cc-name': 'finance.cardholder',
  'cc-given-name': 'person.firstName',
  'cc-family-name': 'person.lastName',
  'cc-number': 'finance.creditCard',
  'cc-exp': 'finance.expiry',
  'cc-exp-month': 'finance.expiryMonth',
  'cc-exp-year': 'finance.expiryYear',
  'cc-csc': 'finance.cvv',
  'transaction-amount': 'finance.amount',
  'transaction-currency': 'finance.currency',
  bday: 'person.birthdate',
  'bday-day': 'person.birthDay',
  'bday-month': 'person.birthMonth',
  'bday-year': 'person.birthYear',
  sex: 'person.gender',
  url: 'company.website',
  tel: 'phone.number',
  'tel-national': 'phone.number',
  'tel-local': 'phone.digits',
  'tel-country-code': 'phone.countryCode',
};

type Rule = { type: string; re: RegExp; not?: RegExp; boost?: number };

const RULES: Rule[] = [
  { type: 'internet.email', re: /\b(e ?mail|email address|correo|courriel|mail)\b/ },
  { type: 'internet.password', re: /\b(pass ?word|passwd|pwd|pass|contrase(n|ñ)a|mot de passe|kennwort|passwort|senha)\b/, not: /\b(hint|question|forgot|reset|one time|otp)\b/ },
  { type: 'internet.username', re: /\b(user ?name|login|user ?id|handle|nick ?name|screen ?name|display ?name|benutzername|usuario|user)\b/, not: /\b(e ?mail|password|first|last)\b/ },
  { type: 'person.firstName', re: /\b(first ?name|fname|given ?name|forename|vorname|pr(e|é)nom|nombre|first|f name)\b/, not: /\b(company|business|last)\b/ },
  { type: 'person.lastName', re: /\b(last ?name|lname|sur ?name|family ?name|nachname|apellidos?|nom de famille|last|l name)\b/, not: /\b(company|business|first)\b/ },
  { type: 'person.middleName', re: /\b(middle ?name|middle initial|mname|middle)\b/ },
  { type: 'person.fullName', re: /\b(full ?name|your name|name|nom|contact name|nome)\b/, not: /\b(first|last|sur|user|company|business|org|organi[sz]ation|file|domain|product|pet|middle|display|screen|account|nick|street|city|card|holder|bank|project|team|event|group|site|app|store|shop|brand|family|given)\b/ },
  { type: 'finance.cardholder', re: /\b(name on card|card ?holder|holder name|cc ?name|card name)\b/, boost: 0.3 },
  { type: 'person.prefix', re: /\b(salutation|prefix|honorific|anrede|title)\b/, not: /\b(job|page|post|book|article|position|subject|event|product|listing|video)\b/ },
  { type: 'person.gender', re: /\b(gender|sex|geschlecht|g(e|é)nero)\b/ },
  { type: 'person.birthdate', re: /\b(birth ?date|birthday|date of birth|dob|bday|born|geburtsdatum|fecha de nacimiento|date de naissance)\b/, boost: 0.15 },
  { type: 'person.age', re: /\b(age|alter|edad|years old)\b/ },
  { type: 'person.jobTitle', re: /\b(job ?title|job|position|occupation|designation|profession|role)\b/, not: /\b(description)\b/ },
  { type: 'phone.number', re: /\b(phone|mobile|cell|tel|telephone|telefon|tel(e|é)fono|contact number|whatsapp|sms number|handy)\b/, not: /\b(code|country|prefix|ext|extension)\b/ },
  { type: 'phone.countryCode', re: /\b(country ?code|dial(ing)? ?code|calling code|phone prefix)\b/ },
  { type: 'address.secondary', re: /\b(address ?line ?2|line ?2|address 2|addr2|apt|apartment|suite|unit|flat|building|floor)\b/, boost: 0.1 },
  { type: 'address.street', re: /\b(address|street|addr|address ?line ?1|line ?1|address1|stra(ss|ß)e|direcci(o|ó)n|adresse|endere(c|ç)o|house number)\b/, not: /\b(e ?mail|ip|mac|web|line ?2|address ?2|wallet|bitcoin|city|zip|postal)\b/ },
  { type: 'address.city', re: /\b(city|town|locality|ort|stadt|ciudad|ville|suburb|cidade)\b/ },
  { type: 'address.state', re: /\b(state|province|region|county|prefecture|bundesland|estado)\b/, not: /\b(statement|status|united states)\b/ },
  { type: 'address.zip', re: /\b(zip|postal|post ?code|postcode|plz|cep|pin ?code|zip ?code|c(o|ó)digo postal|code postal)\b/ },
  { type: 'address.country', re: /\b(country|nation|pa(i|í)s|pays|land)\b/, not: /\b(code|dial)\b/ },
  { type: 'company.name', re: /\b(company|organi[sz]ation|employer|business|firm|org|firma|empresa|soci(e|é)t(e|é)|agency|institution|school|university)\b/, not: /\b(e ?mail|phone|size|type|address|website|url)\b/ },
  { type: 'company.website', re: /\b(website|web ?site|homepage|home page|portfolio|blog|web)\b/ },
  { type: 'web.url', re: /\b(url|link|uri)\b/ },
  { type: 'finance.creditCard', re: /\b(card ?number|cc ?num(ber)?|credit ?card|debit ?card|card ?no|cardnumber|pan|kartennummer|n(u|ú)mero de tarjeta)\b/, boost: 0.1 },
  { type: 'finance.cvv', re: /\b(cvv|cvc|csc|cvn|security ?code|card ?code|cvv2|card verification)\b/, boost: 0.2 },
  { type: 'finance.expiry', re: /\b(exp(iry|iration)?( ?date)?|valid ?thr(u|ough)|mm ?yy|expires?)\b/ },
  { type: 'finance.iban', re: /\biban\b/, boost: 0.3 },
  { type: 'finance.bic', re: /\b(bic|swift)\b/, boost: 0.2 },
  { type: 'finance.accountNumber', re: /\b(account ?(number|no|num)|acct)\b/ },
  { type: 'finance.routingNumber', re: /\b(routing|aba|sort ?code)\b/ },
  { type: 'finance.amount', re: /\b(amount|price|cost|total|budget|salary|income|payment|donation|fee|sum|revenue)\b/ },
  { type: 'number.int', re: /\b(quantity|qty|count|number of|how many|guests|people|seats|units|years|experience|size|rooms|children|adults)\b/ },
  { type: 'text.paragraph', re: /\b(message|comments?|description|bio|about|notes?|feedback|details|inquiry|enquiry|question|tell us|review|cover letter|additional|remarks|reason|explain|story)\b/ },
  { type: 'text.sentence', re: /\b(subject|headline|title|topic)\b/, not: /\b(job|salutation)\b/ },
  { type: 'text.words', re: /\b(search|query|keywords?|find|q|tags?|filter)\b/ },
  { type: 'id.otp', re: /\b(otp|one ?time|verification ?code|verify ?code|2fa|mfa|auth(entication)? code|pin|sms code|security pin|confirmation code)\b/, boost: 0.1 },
  { type: 'id.alphanumeric', re: /\b(coupon|promo|voucher|discount ?code|referral|reference|invite ?code|gift ?card|order ?(number|id)|booking ?ref)\b/ },
  { type: 'id.ssn', re: /\b(ssn|social ?security|national ?id|tax ?id|tin|sin)\b/, boost: 0.2 },
  { type: 'date.future', re: /\b(appointment|booking|check ?in|check ?out|arrival|departure|start ?date|move ?in|delivery ?date|event ?date|travel ?date|reservation|due ?date|deadline|end ?date)\b/ },
  { type: 'date.past', re: /\b(date|issued|since|graduat(ed|ion)|joined|purchase ?date)\b/, not: /\b(birth|update)\b/ },
  { type: 'date.time', re: /\b(time|hour)\b/, not: /\b(time ?zone|full ?time|part ?time|timestamp|one ?time|first ?time|times)\b/ },
  { type: 'address.timezone', re: /\b(time ?zone|timezone|tz)\b/ },
  { type: 'commerce.product', re: /\b(product|item ?name)\b/ },
  { type: 'commerce.color', re: /\b(colou?r|farbe)\b/ },
  { type: 'web.domain', re: /\b(domain|subdomain|host ?name)\b/ },
  { type: 'web.ipv4', re: /\b(ip|ip address|ipv4)\b/ },
];

const CONFIRM = /\b(confirm|confirmation|repeat|retype|re ?enter|re ?type|verify|again|wiederholen|confirmar|confirmer)\b/;

const SOURCES: { key: keyof FieldInfo; weight: number; label: string }[] = [
  { key: 'label', weight: 0.6, label: 'label' },
  { key: 'ariaLabel', weight: 0.55, label: 'accessible name' },
  { key: 'name', weight: 0.5, label: 'name attribute' },
  { key: 'placeholder', weight: 0.45, label: 'placeholder' },
  { key: 'id', weight: 0.4, label: 'id' },
  { key: 'title', weight: 0.3, label: 'title' },
  { key: 'nearbyText', weight: 0.3, label: 'nearby text' },
  { key: 'describedBy', weight: 0.15, label: 'hint text' },
];

export function tokenize(s?: string): string {
  return (s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]:/\\#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = parseInt(digits[digits.length - 1 - i], 10);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const TEXTUAL_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'password', 'number']);

export function isConfirmField(field: FieldInfo): boolean {
  const text = [field.label, field.name, field.id, field.placeholder, field.ariaLabel].map(tokenize).join(' ');
  return CONFIRM.test(text);
}

export function detectFieldType(field: FieldInfo, recordedValue?: string): FieldSuggestion[] {
  const scores = new Map<string, { score: number; reasons: string[] }>();
  const add = (type: string, pts: number, reason: string) => {
    const cur = scores.get(type) ?? { score: 0, reasons: [] };
    cur.score += pts;
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    scores.set(type, cur);
  };

  const tag = field.tag?.toLowerCase();
  const type = (field.type ?? '').toLowerCase();

  // Choice controls are resolved against the page's real options.
  if (tag === 'select') {
    add('choice.option', 1.6, 'Dropdown list');
  }
  if (type === 'checkbox') add('choice.checkbox', 1.6, 'Checkbox');
  if (type === 'radio') add('choice.radio', 1.6, 'Radio button group');

  // 1. Autocomplete token.
  const acTokens = (field.autocomplete ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && !/^(section-|shipping|billing|home|work|mobile|fax|pager|on|off)$/.test(t) && !t.startsWith('section-'));
  for (const t of acTokens) {
    const mapped = AUTOCOMPLETE[t];
    if (mapped) add(mapped, 1.3, `autocomplete="${t}"`);
  }

  // 2. Input type.
  switch (type) {
    case 'email':
      add('internet.email', 1.0, 'Email input');
      break;
    case 'tel':
      add('phone.number', 0.85, 'Telephone input');
      break;
    case 'password':
      add('internet.password', 1.0, 'Password input');
      break;
    case 'url':
      add('web.url', 0.6, 'URL input');
      add('company.website', 0.5, 'URL input');
      break;
    case 'number':
      add('number.int', 0.35, 'Number input');
      break;
    case 'date':
      add('date.past', 0.3, 'Date picker');
      add('date.future', 0.25, 'Date picker');
      break;
    case 'datetime-local':
      add('date.datetime', 0.8, 'Date-time picker');
      break;
    case 'time':
      add('date.time', 1.0, 'Time picker');
      break;
    case 'month':
    case 'week':
      add('date.future', 0.7, `${type} picker`);
      break;
    case 'color':
      add('commerce.hexColor', 1.4, 'Color picker');
      break;
    case 'range':
      add('number.int', 1.0, 'Slider');
      break;
    case 'search':
      add('text.words', 0.7, 'Search box');
      break;
  }
  if (tag === 'textarea' || field.multiline) add('text.paragraph', 0.4, 'Multi-line text area');
  if (field.inputMode === 'numeric' || field.inputMode === 'decimal') add('number.int', 0.15, `inputmode="${field.inputMode}"`);
  if (field.inputMode === 'email') add('internet.email', 0.6, 'inputmode="email"');
  if (field.inputMode === 'tel') add('phone.number', 0.5, 'inputmode="tel"');

  // 3. Keywords.
  for (const src of SOURCES) {
    const raw = field[src.key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const text = tokenize(raw);
    if (!text || text.length > 160) continue;
    for (const rule of RULES) {
      if (rule.re.test(text) && !(rule.not && rule.not.test(text))) {
        add(rule.type, src.weight + (rule.boost ?? 0) * src.weight, `${src.label} “${raw.trim().slice(0, 40)}”`);
      }
    }
  }

  // Birth date parts: "Day" / "Month" / "Year" next to a birthday label.
  const allText = SOURCES.map((s) => tokenize(field[s.key] as string | undefined)).join(' ');
  if (/\b(birth|dob|bday)\b/.test(allText)) {
    if (/\b(day|dd)\b/.test(allText)) add('person.birthDay', 0.6, 'Birthday day part');
    if (/\b(month|mm)\b/.test(allText)) add('person.birthMonth', 0.6, 'Birthday month part');
    if (/\b(year|yyyy|yy)\b/.test(allText)) add('person.birthYear', 0.6, 'Birthday year part');
    if (type === 'date') add('person.birthdate', 0.4, 'Date picker for a birthday');
  }

  // Card expiry month/year split fields.
  if (/\b(exp|expiry|expiration)\b/.test(allText)) {
    if (/\b(month|mm)\b/.test(allText)) add('finance.expiryMonth', 0.7, 'Expiry month part');
    if (/\b(year|yy|yyyy)\b/.test(allText)) add('finance.expiryYear', 0.7, 'Expiry year part');
  }

  // 4. Value shape.
  const v = (recordedValue ?? '').trim();
  if (v) {
    const digits = v.replace(/\D/g, '');
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) add('internet.email', 0.9, 'Typed value is an email address');
    else if (/^\d[\d ]{11,22}$/.test(v) && digits.length >= 13 && digits.length <= 19 && luhn(digits)) add('finance.creditCard', 0.9, 'Typed value is a valid card number');
    else if (/^(0[1-9]|1[0-2]) ?\/ ?(\d{2}|\d{4})$/.test(v)) add('finance.expiry', 0.8, 'Typed value looks like MM/YY');
    else if (/^\d{3}-\d{2}-\d{4}$/.test(v)) add('id.ssn', 0.7, 'Typed value looks like an SSN');
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) add('id.uuid', 1.0, 'Typed value is a UUID');
    else if (/^(https?:\/\/|www\.)\S+$/i.test(v)) {
      add('web.url', 0.6, 'Typed value is a URL');
      add('company.website', 0.35, 'Typed value is a URL');
    } else if (/^\+?[\d\s().-]{7,}$/.test(v) && digits.length >= 7 && digits.length <= 15 && /[\s().+-]/.test(v)) add('phone.number', 0.45, 'Typed value looks like a phone number');
    else if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v)) {
      const year = parseInt((v.match(/\d{4}/) ?? [''])[0], 10);
      if (year && year < new Date().getFullYear() - 14) add('person.birthdate', 0.35, 'Typed value is an adult birth date');
      else add('date.past', 0.3, 'Typed value is a date');
    } else if (/^\d{5}(-\d{4})?$/.test(v)) {
      add('address.zip', 0.3, 'Typed value looks like a ZIP code');
    } else if (/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i.test(v) || /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(v)) {
      add('address.zip', 0.6, 'Typed value looks like a postal code');
    } else if (/^\d+$/.test(v)) {
      if (v.length <= 6) add('number.int', 0.25, 'Typed value is a number');
      else add('number.digits', 0.25, 'Typed value is a long digit string');
      if (v.length >= 4 && v.length <= 8 && /\b(code|otp|pin|verification)\b/.test(allText)) add('id.otp', 0.3, 'Numeric code');
    } else if (/^\d+[.,]\d+$/.test(v)) {
      add('number.float', 0.3, 'Typed value is a decimal');
      add('finance.amount', 0.15, 'Typed value is a decimal');
    } else if (v.length > 50 && /\s/.test(v)) {
      add('text.paragraph', 0.45, 'Typed a long text');
    } else if (/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u.test(v)) {
      add('person.fullName', 0.2, 'Typed value looks like a name');
    }
  }

  if (isConfirmField(field)) {
    for (const key of ['internet.password', 'internet.email']) {
      const s = scores.get(key);
      if (s) {
        s.score += 0.2;
        s.reasons.push('Confirmation field: reuses the value of the earlier field');
      }
    }
  }

  // Fallbacks so every text field gets at least one sensible suggestion.
  if (!scores.size || [...scores.values()].every((s) => s.score < 0.2)) {
    if (tag === 'textarea') add('text.paragraph', 0.3, 'Multi-line text area');
    else if (type === 'number') add('number.int', 0.3, 'Number input');
    else if (TEXTUAL_TYPES.has(type) || field.contentEditable) add('text.words', 0.2, 'Generic text field');
  }

  const list: FieldSuggestion[] = [...scores.entries()]
    .map(([dataType, s]) => ({ dataType, confidence: Math.min(0.99, 1 - Math.exp(-1.5 * s.score)), reasons: s.reasons.slice(0, 4) }))
    .filter((s) => s.confidence >= 0.12)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);
  return list;
}

/** A short human label for the field, used in reports and the smart-fill review. */
export function fieldLabel(field?: FieldInfo, fallback = 'Field'): string {
  if (!field) return fallback;
  const pick = field.label || field.ariaLabel || field.placeholder || field.nearbyText || field.title || field.name || field.id;
  return (pick ?? fallback).replace(/\s+/g, ' ').replace(/[*:]+\s*$/, '').trim().slice(0, 60) || fallback;
}
