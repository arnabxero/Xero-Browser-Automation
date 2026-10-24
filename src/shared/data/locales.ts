import {
  fakerDE,
  fakerEN_AU,
  fakerEN_CA,
  fakerEN_GB,
  fakerEN_IN,
  fakerEN_US,
  fakerES,
  fakerES_MX,
  fakerFR,
  fakerIT,
  fakerJA,
  fakerNL,
  fakerPL,
  fakerPT_BR,
  fakerSV,
  fakerTR,
  type Faker,
} from '@faker-js/faker';

export interface LocaleDef {
  id: string;
  label: string;
  country: string;
  countryCode: string;
  faker: Faker;
}

export const LOCALES: LocaleDef[] = [
  { id: 'en_US', label: 'English (United States)', country: 'United States', countryCode: 'US', faker: fakerEN_US },
  { id: 'en_GB', label: 'English (United Kingdom)', country: 'United Kingdom', countryCode: 'GB', faker: fakerEN_GB },
  { id: 'en_CA', label: 'English (Canada)', country: 'Canada', countryCode: 'CA', faker: fakerEN_CA },
  { id: 'en_AU', label: 'English (Australia)', country: 'Australia', countryCode: 'AU', faker: fakerEN_AU },
  { id: 'en_IN', label: 'English (India)', country: 'India', countryCode: 'IN', faker: fakerEN_IN },
  { id: 'de', label: 'German (Germany)', country: 'Deutschland', countryCode: 'DE', faker: fakerDE },
  { id: 'fr', label: 'French (France)', country: 'France', countryCode: 'FR', faker: fakerFR },
  { id: 'es', label: 'Spanish (Spain)', country: 'España', countryCode: 'ES', faker: fakerES },
  { id: 'es_MX', label: 'Spanish (Mexico)', country: 'México', countryCode: 'MX', faker: fakerES_MX },
  { id: 'it', label: 'Italian (Italy)', country: 'Italia', countryCode: 'IT', faker: fakerIT },
  { id: 'nl', label: 'Dutch (Netherlands)', country: 'Nederland', countryCode: 'NL', faker: fakerNL },
  { id: 'pt_BR', label: 'Portuguese (Brazil)', country: 'Brasil', countryCode: 'BR', faker: fakerPT_BR },
  { id: 'pl', label: 'Polish (Poland)', country: 'Polska', countryCode: 'PL', faker: fakerPL },
  { id: 'sv', label: 'Swedish (Sweden)', country: 'Sverige', countryCode: 'SE', faker: fakerSV },
  { id: 'tr', label: 'Turkish (Türkiye)', country: 'Türkiye', countryCode: 'TR', faker: fakerTR },
  { id: 'ja', label: 'Japanese (Japan)', country: '日本', countryCode: 'JP', faker: fakerJA },
];

export function getLocale(id?: string): LocaleDef {
  return LOCALES.find((l) => l.id === id) ?? LOCALES[0];
}
