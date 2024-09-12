import db from "@/db";
import { init } from "@/init";
import { Eastward } from "eastward.js";
import { TextureAsset } from "eastward.js";
import { LocalePackAsset } from "eastward.js";
import { SqScriptAsset } from "eastward.js";
import express from "express";
import cors from "cors";

const root = "D:/SteamLibrary/steamapps/common/Eastward";
const eastward = new Eastward(root);
await eastward.init();
eastward.registerAssetLoader("texture", TextureAsset, true);
eastward.registerAssetLoader("locale_pack", LocalePackAsset, true);
eastward.registerAssetLoader("sq_script", SqScriptAsset, true);

await init(eastward);

async function getTranslation(path: string, lang: string, key: string) {
  const result = await db.get<{ value: string }>(
    `SELECT value FROM locale WHERE path=? AND lang=? AND key=?`,
    [path, lang, key]
  );
  return result && result.value;
}

async function getTranslations(path: string, lang: string) {
  const result = await db.all<{ key: string; value: string }[]>(
    `SELECT key, value FROM locale WHERE path=? AND lang=?`,
    [path, lang]
  );
  return result;
}

async function getLangs(path: string) {
  const result = await db.all<{ lang: string }[]>(
    `SELECT lang FROM locale WHERE path=? GROUP BY lang`,
    [path]
  );
  return result;
}

async function translationExists(path: string) {
  const result = await db.get<{ count: number }>(
    `SELECT COUNT(path) as count FROM locale WHERE path=?`,
    [path]
  );
  return result && result.count;
}

async function traslate(node: any, sqNode: any) {
  if (sqNode.chara) {
    let translatedName = await getTranslation(
      "config/story/CharacterName.xls/Name",
      "ko",
      `name::${sqNode.chara}`
    );
    if (!translatedName) {
      translatedName = await getTranslation(
        "config/story/CharacterName.xls/Name",
        "en",
        `name::${sqNode.chara}`
      );
    }
    if (translatedName) {
      sqNode.chara = translatedName;
    }

    let translated = false;
    for (const { lang } of await getLangs(node.path)) {
      if (sqNode.directive) {
        const translatedText = await getTranslation(
          node.path,
          lang,
          sqNode.directive
        );
        if (translatedText) {
          translated = true;
          sqNode[lang] = translatedText;
        }
      }
    }

    if (translated) {
      delete sqNode.fallback;
    }
  }
  if (sqNode.children) {
    for (const child of sqNode.children) {
      await traslate(node, child);
    }
  }
}

const locales: any = {};
const localeNodes = eastward.getAssetNodes("locale_pack");
const sqNodes = eastward.getAssetNodes("sq_script");

const translatablePaths: string[] = [];

for (const node of localeNodes) {
  const locale = (await eastward.loadAsset<LocalePackAsset>(node.path))!;
  for (const { path } of locale.config.items) {
    if (await translationExists(path)) {
      translatablePaths.push(path);
    }
  }
}

async function loadSQ(path: string) {
  const node = sqNodes.find((node) => node.path == path);
  if (!node) {
    return;
  }
  const sq = (await eastward.loadAsset<SqScriptAsset>(node.path))!;
  if (sq.root) {
    const build = sq.root.build();
    if (build.children.length > 0) {
      const exists = translationExists(node.path);
      if (!exists) {
        locales[path] = build;
      } else {
        await traslate(node, build);
        locales[path] = build;
      }
    }
  }
}

const app = express();

app.use(cors());
app.use(express.json());

app.get("/sq/names", function (req, res) {
  res.json(translatablePaths);
});

app.get("/sq/value", async function (req, res) {
  const { path } = req.query;
  if (!path || typeof path != "string") {
    res.status(400);
    return;
  }
  let csv;

  if (!locales[path]) {
    await loadSQ(path);
  }

  const node = sqNodes.find((node) => node.path == path);

  if (!locales[path] && !node) {
    const ko = await getTranslations(path, "ko");
    const en = await getTranslations(path, "en");
    csv = {} as any;

    for (const { key, value } of en) {
      csv[key] = {};
      csv[key].en = value;
    }

    for (const { key, value } of ko) {
      csv[key].ko = value;
    }
  }

  res.json({
    script: locales[path],
    csv,
  });
});

app.post("/sq/translate", async function (req, res) {
  const { path, lang, key, value } = req.body;
  if (!path || typeof path != "string") {
    res.sendStatus(400);
    return;
  }

  if (!locales[path]) {
    await loadSQ(path);
  }

  await db.run(`UPDATE locale SET value=? WHERE path=? AND lang=? AND key=?`, [
    value,
    path,
    lang,
    key,
  ]);
  const node = sqNodes.find((node) => node.path == path);
  const build = locales[path];
  if (node && build) {
    await traslate(node, build);
    locales[path] = build;
  }

  res.send({});
});

app.listen(3000, () => {
  console.log("http://localhost:3000");
});
