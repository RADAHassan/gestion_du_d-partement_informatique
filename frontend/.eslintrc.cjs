module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: '18.3' } },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react/jsx-runtime', 'plugin:react-hooks/recommended'],
  rules: {
    'react/prop-types': 'off',
    'react/no-unescaped-entities': 'off', // texte français : apostrophes fréquentes
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
