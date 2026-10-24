import type { Faker } from '@faker-js/faker';
import type { LocaleDef } from './locales';

/**
 * A coherent fake identity. Every field in one iteration draws from the same persona
 * so the first name, email, username and address of a generated sign-up agree.
 */
export interface Persona {
  sex: 'female' | 'male';
  prefix: string;
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  email: string;
  username: string;
  password: string;
  phone: string;
  birthdate: Date;
  age: number;
  street: string;
  secondary: string;
  city: string;
  state: string;
  stateAbbr: string;
  zip: string;
  country: string;
  countryCode: string;
  company: string;
  jobTitle: string;
  website: string;
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';

export function strongPassword(f: Faker, length = 14, symbols = true): string {
  const len = Math.max(6, Math.min(128, Math.round(length)));
  const pick = (set: string) => set[f.number.int({ min: 0, max: set.length - 1 })];
  const all = UPPER + LOWER + DIGITS + (symbols ? SYMBOLS : '');
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), symbols ? pick(SYMBOLS) : pick(DIGITS)];
  while (chars.length < len) chars.push(pick(all));
  return f.helpers.shuffle(chars).join('');
}

export function asciiLocal(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function makeEmail(f: Faker, firstName: string, lastName: string, domain?: string): string {
  const a = asciiLocal(firstName);
  const b = asciiLocal(lastName);
  const provider = domain?.trim().replace(/^@/, '') || f.helpers.arrayElement(['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com']);
  const digits = f.number.int({ min: 10, max: 9999 });
  const local =
    a && b
      ? f.helpers.arrayElement([`${a}.${b}${digits}`, `${a}${b}${digits}`, `${a[0]}${b}${digits}`, `${a}_${b}${digits}`])
      : `user${f.number.int({ min: 100000, max: 999999 })}`;
  return `${local}@${provider}`;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null || (v as unknown) === '' ? fallback : v;
  } catch {
    return fallback;
  }
}

export function makePersona(locale: LocaleDef, opts: { emailDomain?: string } = {}): Persona {
  const f = locale.faker;
  const sex = f.person.sexType() as 'female' | 'male';
  const firstName = f.person.firstName(sex);
  const lastName = f.person.lastName(sex);
  const middleName = safe(() => f.person.middleName(sex), f.person.firstName(sex));
  const birthdate = f.date.birthdate({ mode: 'age', min: 19, max: 68 });
  const now = new Date();
  let age = now.getFullYear() - birthdate.getFullYear();
  const m = now.getMonth() - birthdate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthdate.getDate())) age--;

  // Keep state name, abbreviation and zip code consistent where the locale allows it.
  let state = '';
  let stateAbbr = '';
  try {
    const states = f.definitions.location.state as string[] | undefined;
    const abbrs = f.definitions.location.state_abbr as string[] | undefined;
    if (states?.length) {
      const i = f.number.int({ min: 0, max: states.length - 1 });
      state = states[i];
      stateAbbr = abbrs?.[i] ?? state.slice(0, 2).toUpperCase();
    }
  } catch {
    /* locale without states */
  }
  if (!state) {
    state = safe(() => f.location.state(), '');
    stateAbbr = safe(() => f.location.state({ abbreviated: true }), state.slice(0, 2).toUpperCase());
  }
  const zip = safe(() => (locale.id === 'en_US' && stateAbbr ? f.location.zipCode({ state: stateAbbr }) : f.location.zipCode()), f.location.zipCode());
  const username = (() => {
    const u = safe(() => f.internet.username({ firstName, lastName }), '');
    const ascii = u.normalize('NFKD').replace(/[^\w.-]/g, '');
    return ascii.length >= 4 ? ascii : `${asciiLocal(firstName) || 'user'}${f.number.int({ min: 100, max: 9999 })}`;
  })();

  return {
    sex,
    prefix: safe(() => f.person.prefix(sex), ''),
    firstName,
    middleName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: makeEmail(f, firstName, lastName, opts.emailDomain),
    username,
    password: strongPassword(f, 14, true),
    phone: safe(() => f.phone.number({ style: 'national' }), f.phone.number()),
    birthdate,
    age,
    street: f.location.streetAddress(),
    secondary: safe(() => f.location.secondaryAddress(), `Apt. ${f.number.int({ min: 1, max: 999 })}`),
    city: f.location.city(),
    state,
    stateAbbr,
    zip,
    country: locale.country,
    countryCode: locale.countryCode,
    company: f.company.name(),
    jobTitle: f.person.jobTitle(),
    website: `https://${asciiLocal(firstName)}${asciiLocal(lastName)}.${f.helpers.arrayElement(['com', 'net', 'io', 'dev'])}`,
  };
}
