// Minimal type declaration for json-dup-key-validator@1.0.3 (CommonJS, ships no types). Only the function used by
// Foundation is declared: validate(jsonString, allowDuplicatedKeys) returns an error message, or undefined when the
// text is valid JSON without duplicate object keys.
declare module 'json-dup-key-validator' {
  interface JsonDupKeyValidator {
    validate(jsonString: string, allowDuplicatedKeys?: boolean): string | undefined;
  }
  const validator: JsonDupKeyValidator;
  export = validator;
}
