declare module "saxon-js" {
    const SaxonJS: {
        transform(options: unknown, mode?: string): unknown;
        XPath: {
            evaluate(xpath: string, context: unknown, options?: unknown): unknown;
        };
    } & Record<string, unknown>;
    export default SaxonJS;
}
