// ESLint 9.x flat config format (CommonJS)
// https://eslint.org/docs/latest/use/configure/configuration-files

const js = require('@eslint/js');

module.exports = [
  // Apply to all JavaScript files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'writable',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        // Browser globals for public/app.js
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        Chart: 'readonly',
        alert: 'readonly',
        confirm: 'readonly'
      }
    },
    rules: {
      // Extend recommended rules
      ...js.configs.recommended.rules,
      
      // Security rules
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'radix': 'warn',
      
      // Code quality rules
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-alert': 'warn',
      'curly': 'warn',
      'eqeqeq': 'error',
      'no-eq-null': 'error',
      'guard-for-in': 'error',
      'no-extend-native': 'error',
      'no-multi-spaces': 'warn',
      'no-multi-str': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'wrap-iife': ['error', 'any'],
      'yoda': 'error',
      'no-delete-var': 'error',
      'no-label-var': 'error',
      'no-shadow': 'warn',
      'no-shadow-restricted-names': 'error',
      'no-undef': 'error',
      'no-undef-init': 'error',
      'no-undefined': 'warn',
      'no-use-before-define': 'warn',
      
      // Style rules (less strict for now)
      'camelcase': 'warn',
      'func-style': 'warn',
      'new-cap': 'error',
      'no-nested-ternary': 'warn',
      'no-useless-escape': 'warn',
      'indent': 'off', // Too many existing indentation issues
      'brace-style': 'off' // Too many existing style issues
    }
  },
  
  // Specific overrides for different file types
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        // Additional browser-specific globals for frontend
        Chart: 'readonly',
        moment: 'readonly'
      }
    }
  },
  
  // Node.js specific files
  {
    files: [
      'server.js',
      'watchdog.js',
      'src/**/*.js'
    ],
    languageOptions: {
      sourceType: 'commonjs'
    }
  }
];
