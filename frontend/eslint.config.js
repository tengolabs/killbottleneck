import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    // Celý src/ — do 27. 8. 2026 bylo 44 % zdrojáků (lib/, api/, hooks/, …)
    // mimo lint a no-shadow tak neviděl pád Markdown exportu (nález F6-08/F5-01).
    // Výjimka jen shadcn boilerplate v ui/.
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    // skinValidator.js je bytová kopie sdílená s galerií skinů (killbottleneck-skins,
    // hlídá ji check-upstream.mjs) — lintovat ji tady by vyrobilo drift ve třetí kopii.
    ignores: ["src/components/ui/**/*", "src/lib/skinValidator.js"],
    // Pravidla doporučených sad se vtahují DOLE v `rules` — spready na téhle
    // úrovni by stejně přebil klíč `rules` níž a konfig by říkal dvě věci naráz.
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      // ⚠️ `rules` přepisuje celý blok ze spreadů výše — pravidla doporučených
      // sad je nutné vtáhnout ručně, jinak z nich neběží ANI JEDNO (mj. no-undef,
      // které by chytlo `setWithTasks` po smazání stavu → černá obrazovka).
      ...pluginJs.configs.recommended.rules,
      ...pluginReact.configs.flat.recommended.rules,
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
      // Zastínění vnější proměnné: callback pojmenovaný `t` zastínil překladovou
      // funkci a shodil aplikaci do černé obrazovky (NodeTasksDialog, task #17).
      // Platný kód, který dělá něco jiného, než autor chtěl — chytat při lintu.
      "no-shadow": "error",
    },
  },
];
