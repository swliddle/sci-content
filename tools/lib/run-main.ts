// Common top-level wrapper for tool entry points: awaits the given promise
// and on rejection prints `ERROR: <err>` and exits with code 1. Use as
// `runMain(main());` at the bottom of any tools/ executable.
export function runMain(promise: Promise<unknown>): void {
    promise.catch((err) => {
        console.error("ERROR:", err);
        process.exit(1);
    });
}
