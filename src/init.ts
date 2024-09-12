import db from "@/db";
import { Eastward } from "eastward.js";
import { LocalePackAsset } from "eastward.js";

export async function init(eastward: Eastward) {
  try {
    await db.run(`CREATE TABLE "locale" (
    "id"	INTEGER UNIQUE,
    "path"	TEXT,
    "name"	TEXT,
    "lang"	TEXT,
    "key"	TEXT,
    "value"	TEXT,
    PRIMARY KEY("id" AUTOINCREMENT)
  );`);

    for (const node of eastward.getAssetNodes("locale_pack")) {
      const locale = (await eastward.loadAsset<LocalePackAsset>(node.path))!;
      for (const { path, name } of locale.config.items) {
        for (const lang of locale.langs) {
          const node = locale.data[lang][name];
          if (node) {
            for (const [key, value] of Object.entries(node)) {
              await db.run(
                `INSERT INTO locale (path, name, lang, key, value) VALUES (?, ?, ?, ?, ?)`,
                [path, name, lang, key, value]
              );
            }
          }
        }
      }
    }
  } catch {}
}
