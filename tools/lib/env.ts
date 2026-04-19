// Read an env var, returning `fallback` if the var is unset or empty.
// Standardizes directory-override handling across corpus configs, which
// had drifted into a mix of `process.env.X || fallback` and `?? fallback`
// (the two disagree on empty-string vs undefined).
export function envOr(name: string, fallback: string): string {
    const v = process.env[name];
    return v === undefined || v === "" ? fallback : v;
}
