const pluginJson = require('../plugin.json');

module.exports = {
  locales: [
    'en-US',
    'id-ID',
    'cs-CZ',
    'de-DE',
    'es-ES',
    'fr-FR',
    'it-IT',
    'hu-HU',
    'nl-NL',
    'pl-PL',
    'pt-PT',
    'pt-BR',
    'sv-SE',
    'tr-TR',
    'ru-RU',
    'ko-KR',
    'zh-CN',
    'zh-TW',
    'zh-Hans',
    'zh-Hant',
    'ja-JP',
  ], // An array of the locales your plugin supports
  sort: true,
  createOldCatalogs: false,
  failOnWarnings: true,
  verbose: false,
  resetDefaultValueLocale: 'en-US', // Updates extracted values when they change in code
  defaultNamespace: pluginJson.id,
  input: ['../**/*.{tsx,ts}'],
  output: 'src/locales/$LOCALE/$NAMESPACE.json',
};
