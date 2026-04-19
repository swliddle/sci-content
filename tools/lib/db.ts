import * as mysql from "mysql2/promise";
import { envOr } from "./env.js";

export async function createDb(
    extra: Partial<mysql.ConnectionOptions> = {}
): Promise<mysql.Connection> {
    // Spread conditionally: under exactOptionalPropertyTypes, passing
    // `user: undefined` is not the same as omitting the key, and mysql2's
    // behavior differs between the two.
    return mysql.createConnection({
        host: envOr("DB_HOST", "127.0.0.1"),
        port: parseInt(envOr("DB_PORT", "3306"), 10),
        database: envOr("DB_NAME", "sci2p"),
        charset: "utf8mb4",
        ...(process.env.DB_USER !== undefined && { user: process.env.DB_USER }),
        ...(process.env.DB_PASSWORD !== undefined && { password: process.env.DB_PASSWORD }),
        ...extra
    });
}
