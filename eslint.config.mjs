// @ts-check
import eslint from "@eslint/js";
import tslint from "typescript-eslint";

export default tslint.config(
    eslint.configs.recommended,
    ...tslint.configs.recommended,
    ...tslint.configs.stylistic,
    {
        rules: {
            "semi": ["error", "always"], // Add this line to enforce semicolon use
            "@typescript-eslint/no-duplicate-enum-values": "off",
            //"@typescript-eslint/no-misleading-character-class": "off",
			"@typescript-eslint/class-literal-property-style": "off",
            "@typescript-eslint/no-this-alias": "off",
            "@typescript-eslint/no-unused-vars":  [
                "warn", {
                    argsIgnorePattern: "^(_+$|_[^_])",
                    varsIgnorePattern: "^(_+$|_[^_])",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-explicit-any": "off",
            //"@typescript-eslint/explicit-module-boundary-types": "off",
            //"@typescript-eslint/no-non-null-assertion": "off"
	        "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/consistent-indexed-object-style": "off"

        },
    },
    {
        files: ["src/*.ts", "src/*.tsx"],
    }
);
