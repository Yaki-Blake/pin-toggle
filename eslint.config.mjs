import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	{ ignores: ['node_modules/**', 'main.js', 'eslint.config.mjs'] },
	...obsidianmd.configs.recommended,
	comments.recommended,
	{
		rules: {
			'@eslint-community/eslint-comments/require-description': 'error',
		},
	},
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: './tsconfig.json' },
		},
	},
]);
