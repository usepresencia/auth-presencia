import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const FORBIDDEN_LAYERS = {
    model: ['application', 'infrastructure', 'presentation'],
    application: ['infrastructure', 'presentation'],
    infrastructure: ['presentation'],
    presentation: ['infrastructure'],
};

const restrict = (files, folders, message) => ({
    files: [files],
    rules: {
        'no-restricted-imports': [
            'error',
            { patterns: [{ group: folders.map(folder => `**/${folder}/**`), message }] },
        ],
    },
});

export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts', '**/*.mjs'],
        languageOptions: { globals: globals.node },
        rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
    },
    {
        files: ['src/**/*.ts'],
        extends: [...tseslint.configs.recommendedTypeCheckedOnly],
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
    },
    ...Object.entries(FORBIDDEN_LAYERS).map(([layer, forbidden]) =>
        restrict(
            `src/modules/*/${layer}/**/*.ts`,
            forbidden,
            `A camada ${layer} não pode importar ${forbidden.join(', ')}.`,
        ),
    ),
    restrict('src/shared/**/*.ts', ['modules'], 'shared não importa de modules.'),
    {
        files: ['**/*.cjs'],
        languageOptions: { globals: globals.node },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
);
