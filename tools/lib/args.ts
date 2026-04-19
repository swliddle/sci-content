// Canonical two-letter language / content-direction tag used across
// stpjs, core, mobile, and the Ensign publishers. Single source of truth
// — each config module re-exports it so old import paths keep working.
export type Lang = "en" | "es";

export function argValue(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag);

    if (idx === -1 || !process.argv[idx + 1]) {
        return undefined;
    }

    return process.argv[idx + 1];
}

export function hasArg(flag: string): boolean {
    return process.argv.indexOf(flag) !== -1;
}

export function requireArg(flag: string, usage: string): string {
    const value = argValue(flag);

    if (value === undefined) {
        throw new Error(usage);
    }

    return value;
}

export function parseLangArg(): Lang {
    const value = requireArg("--lang", "Usage: --lang en|es");

    if (value !== "en" && value !== "es") {
        throw new Error(`Invalid --lang: ${value}`);
    }

    return value;
}

export function parseVolumeArg(min = 1, max = 26): number {
    const raw = requireArg("--volume", "Usage: --volume NN");
    const vol = parseInt(raw, 10);

    if (!(Number.isFinite(vol) && vol >= min && vol <= max)) {
        throw new Error(`Invalid --volume: ${raw}`);
    }

    return vol;
}

// Parse --id N | --range LO-HI into an inclusive list of integers, or
// undefined if neither flag is present. Shared by stpjs / gc-ensign /
// jod runners that accept the same two shapes.
export function parseIdRangeArgs(): number[] | undefined {
    const idRaw = argValue("--id");
    if (idRaw !== undefined) {
        const id = parseInt(idRaw, 10);
        if (!Number.isFinite(id)) {
            throw new Error(`Invalid --id: ${idRaw}`);
        }
        return [id];
    }

    const rangeRaw = argValue("--range");
    if (rangeRaw !== undefined) {
        const parts = rangeRaw.split("-");
        const lo = parseInt(parts[0] ?? "", 10);
        const hi = parseInt(parts[1] ?? "", 10);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
            throw new Error(`Invalid --range: ${rangeRaw}`);
        }
        const ids: number[] = [];
        for (let i = lo; i <= hi; i++) ids.push(i);
        return ids;
    }

    return undefined;
}
