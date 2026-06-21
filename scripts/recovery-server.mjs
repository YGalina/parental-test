import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Load .env.local if present (local dev)
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z_]+)="?(.+?)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n/g, "\n");
    }
  }
} catch {}

async function appendToSheet(row) {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) return;

  // JWT for Google API
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1e3);
  const claims = Buffer.from(JSON.stringify({
    iss: email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now
  })).toString("base64url");

  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claims}`);
  const sig = sign.sign(key, "base64url");
  const jwt = `${header}.${claims}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const { access_token } = await tokenRes.json();

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`, {
    method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] })
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);

const scaleKeys = [
  "adultResponsibility",
  "emotionalContact",
  "boundariesConsistency",
  "autonomySupport",
  "conflictTolerance",
  "flexibility",
  "difficultyVsUnsafety"
];

const scaleTitles = {
  adultResponsibility: "Взрослая опора и структура",
  emotionalContact: "Эмоциональная настройка",
  boundariesConsistency: "Последовательные границы",
  autonomySupport: "Поддержка автономии",
  conflictTolerance: "Саморегуляция в конфликте",
  flexibility: "Рефлексивная гибкость",
  difficultyVsUnsafety: "Оценка риска: дискомфорт или опасность"
};

const scaleDescriptions = {
  adultResponsibility: "Как взрослый берет на себя решения и последствия, которые ребенок пока не может оценить полностью.",
  emotionalContact: "Замечает ли взрослый состояние ребенка до перехода к правилам, требованиям и объяснениям.",
  boundariesConsistency: "Остается ли договоренность различимой, когда ребенок сопротивляется, злится или просит отменить правило.",
  autonomySupport: "Есть ли у ребенка посильная зона выбора без передачи ему взрослой ответственности целиком.",
  conflictTolerance: "Может ли взрослый выдержать недовольство ребенка без автоматической капитуляции или усиления давления.",
  flexibility: "Меняется ли решение при появлении новых фактов, которые действительно меняют смысл ситуации.",
  difficultyVsUnsafety: "Отличается ли обычная трудность роста от перегруза, унижения, травли или другой проблемы среды."
};

const scaleAcademicBasis = {
  adultResponsibility: "Parental structure / scaffolding / limit-setting",
  emotionalContact: "Emotional attunement / emotion coaching (Gottman)",
  boundariesConsistency: "Consistent discipline vs laxness/overreactivity (Parenting Scale)",
  autonomySupport: "Autonomy-supportive parenting (Self-Determination Theory)",
  conflictTolerance: "Parental emotion regulation / overreactivity",
  flexibility: "Parental reflective functioning (PRFQ)",
  difficultyVsUnsafety: "Overprotection / accommodation / risk appraisal"
};

const strengthTitles = {
  adultResponsibility: "Вы умеете удерживать взрослую позицию",
  emotionalContact: "Вы замечаете состояние ребенка до решения",
  boundariesConsistency: "Вы сохраняете границы без немедленной капитуляции",
  autonomySupport: "Вы оставляете ребенку пространство выбора",
  conflictTolerance: "Вы выдерживаете сопротивление",
  flexibility: "Вы способны пересматривать первое решение",
  difficultyVsUnsafety: "Вы проверяете, не стоит ли за отказом небезопасная среда"
};

const strengthDescriptions = {
  adultResponsibility: "В ситуациях неопределенности вы чаще удерживаете за взрослым ту часть решения, где ребенок еще не может полностью оценить последствия.",
  emotionalContact: "В ответах заметна попытка сначала понять состояние ребенка, а уже потом переходить к правилу, сроку или действию.",
  boundariesConsistency: "Вы склонны не превращать каждое «не хочу» в автоматическую отмену договоренности, даже если формат можно обсуждать.",
  autonomySupport: "Вы ищете для ребенка реальную, но посильную зону выбора: не все решение целиком, а ту часть, которую он уже может выдержать.",
  conflictTolerance: "Недовольство ребенка не обязательно сбивает вас с выбранной линии; вы можете выдерживать напряжение, не усиливая его мгновенно.",
  flexibility: "Вы готовы пересматривать первое решение, если появляются факты, которые меняют смысл ситуации.",
  difficultyVsUnsafety: "Вы допускаете, что отказ может быть не только сопротивлением усилию, но и сигналом о среде, перегрузе или унижении."
};

const attentionTitles = {
  adultResponsibility: "Где взрослое решение не стоит передавать ребенку слишком рано",
  emotionalContact: "Где перед правилом важно успеть признать состояние ребенка",
  boundariesConsistency: "Где договоренность лучше формулировать яснее",
  autonomySupport: "Где ребенку можно дать больше посильного выбора",
  conflictTolerance: "Где конфликт может слишком быстро менять ваше решение",
  flexibility: "Где новая информация может требовать пересмотра позиции",
  difficultyVsUnsafety: "Где важно отличить сопротивление усилию от проблемы среды"
};

const attentionDescriptions = {
  adultResponsibility: "Иногда забота о самостоятельности может звучать так, будто ребенок должен сам решить вопрос, который пока требует взрослой оценки.",
  emotionalContact: "В части ситуаций можно усилить короткое признание состояния ребенка до объяснений и решений.",
  boundariesConsistency: "Если правило остается важным, его полезно назвать конкретно: что неизменно, а где возможен выбор.",
  autonomySupport: "Можно чаще отделять взрослую границу от выбора внутри нее: ребенок не решает все, но решает что-то реальное.",
  conflictTolerance: "Когда сопротивление усиливается, полезно заранее иметь спокойную формулу, чтобы не перейти ни в давление, ни в быстрый отказ от правила.",
  flexibility: "Новая информация иногда требует не просто сочувствия, а пересмотра решения и проверки среды.",
  difficultyVsUnsafety: "Стоит чаще задавать вопрос: это обычная трудность навыка или сигнал о небезопасности, унижении, перегрузе?"
};

const scaleHowTo = {
  adultResponsibility: {
    label: "увидеть",
    text: "Назовите вслух, какую часть решения берете на себя вы, а какую — оставляете ребенку. Часто это проясняет ситуацию обоим."
  },
  emotionalContact: {
    label: "услышать",
    text: "Перед любым «нет» или «надо» произнесите вслух то, что, кажется, чувствует ребенок: «Тебе сейчас не хочется/обидно/страшно». Не нужно угадывать точно — важен сам жест."
  },
  boundariesConsistency: {
    label: "увидеть",
    text: "Спросите себя: если бы сторонний наблюдатель посмотрел на эту сцену через неделю, понял бы он, какое правило действует? Если нет — граница размыта."
  },
  autonomySupport: {
    label: "почувствовать",
    text: "Дайте ребенку выбор из двух вариантов, оба из которых вам подходят. Понаблюдайте, что он выбирает — это говорит о том, что для него важно сейчас."
  },
  conflictTolerance: {
    label: "почувствовать",
    text: "Когда ребенок злится или плачет из-за вашего «нет», досчитайте до пяти, прежде чем отвечать. Дайте чувству побыть в комнате, не спасая от него мгновенно."
  },
  flexibility: {
    label: "услышать",
    text: "Спросите: «Что изменилось с тех пор, как мы договорились?» Иногда ребенок называет факт, который вы не учли — а иногда честно говорит «ничего, просто не хочу», и это тоже ответ."
  },
  difficultyVsUnsafety: {
    label: "увидеть",
    text: "Понаблюдайте, как ребенок ведет себя в похожей ситуации с другими людьми. Если избегание повторяется только в одном контексте — вероятно, дело не в лени, а в среде."
  }
};

const scaleLevelTexts = {
  adultResponsibility: {
    high: "Вы чётко держите взрослую рамку: не перекладываете на ребёнка решения, которые пока не его. Это создаёт предсказуемость.",
    mid: "В большинстве ситуаций вы берёте ответственность на себя, но под давлением граница иногда сдвигается.",
    low: "Стоит чаще называть вслух, что это ваше решение как взрослого — это снижает неопределённость для ребёнка."
  },
  emotionalContact: {
    high: "Вы замечаете состояние ребёнка до того, как переходите к правилу или требованию — это сильная база для диалога.",
    mid: "Вы стараетесь слышать ребёнка, хотя иногда решение или объяснение опережает признание его состояния.",
    low: "Перед любым «нет» или «надо» стоит сделать паузу: произнести вслух, что, кажется, чувствует ребёнок прямо сейчас."
  },
  boundariesConsistency: {
    high: "Договорённость остаётся различимой, даже когда ребёнок злится или давит — это создаёт надёжность.",
    mid: "Границы в целом держатся, но под сильным давлением правило иногда размывается быстрее, чем нужно.",
    low: "Если договорённость важна, полезно формулировать её конкретно: что неизменно, а где можно обсуждать формат."
  },
  autonomySupport: {
    high: "Вы умеете оставлять ребёнку реальный выбор внутри взрослой рамки — не всё решение, но что-то значимое для него.",
    mid: "Вы даёте ребёнку выбор, но иногда он либо слишком мал, либо слишком велик для его возраста и ситуации.",
    low: "Попробуйте чаще предлагать выбор из двух вариантов, оба из которых вам подходят — это даёт ребёнку участие без перегруза."
  },
  conflictTolerance: {
    high: "Вы выдерживаете недовольство ребёнка без автоматической капитуляции — это ценная родительская устойчивость.",
    mid: "Вы стараетесь держать позицию, но сильная эмоция ребёнка иногда меняет решение быстрее, чем планировалось.",
    low: "Когда ребёнок злится или плачет, решение может измениться слишком быстро. Стоит заранее подготовить спокойную формулу."
  },
  flexibility: {
    high: "Вы готовы пересматривать первое решение, если появляются факты, которые действительно меняют картину.",
    mid: "Вы меняете позицию при новых фактах, но не всегда — иногда первое решение остаётся даже когда данные изменились.",
    low: "Стоит чаще задавать вопрос: а что изменилось? Новые факты требуют другого ответа, и это не слабость."
  },
  difficultyVsUnsafety: {
    high: "Вы проверяете: это сопротивление усилию или сигнал о небезопасной среде — важное различение, которое защищает ребёнка.",
    mid: "Вы замечаете разницу между трудностью и угрозой, хотя иногда это требует дополнительного вопроса к себе.",
    low: "Полезно чаще спрашивать: это обычная трудность роста, или ребёнок посылает сигнал о среде, перегрузе, унижении?"
  }
};

const reactionQuestions = [
  {
    id: "safety-or-discomfort",
    number: 1,
    title: "Это про небезопасность или про неудобство?",
    text:
      "«Не хочу переходить дорогу один» — про безопасность, тут граница не обсуждается, обсуждается только то, как ее донести. «Не хочу надевать куртку» — про неудобство и ощущения ребенка, здесь есть пространство для диалога.",
    scaleKey: "difficultyVsUnsafety",
    sourceHint: "различение трудности, перегруза и небезопасной среды"
  },
  {
    id: "can-explain-softly",
    number: 2,
    title: "Ребенок может объяснить причину, если спросить мягко?",
    text:
      "Разумная причина — устал, боится, не понимает зачем — повод для диалога, а не для автоматического давления.",
    scaleKey: "emotionalContact",
    sourceHint: "эмоциональный контакт и короткое признание состояния"
  },
  {
    id: "autonomy-or-avoidance",
    number: 3,
    title: "Это про «хочу решать сам» или про «не хочу делать вообще»?",
    text:
      "Первое — предложите выбор: сейчас или через пять минут, с чего начнем, как проверим результат. Второе — назовите чувство, но не торгуйтесь бесконечно.",
    scaleKey: "autonomySupport",
    sourceHint: "автономия внутри взрослой рамки"
  },
  {
    id: "if-i-push",
    number: 4,
    title: "Если я продавлю — чему это научит на этот раз?",
    text:
      "Регулярное игнорирование «нет» может научить ребенка не озвучивать реальные проблемы. Один эпизод не определит все, но стоит замечать, не складывается ли это в паттерн.",
    scaleKey: "boundariesConsistency",
    sourceHint: "границы без унижения и потери контакта"
  },
  {
    id: "if-i-step-back",
    number: 5,
    title: "Если я отступлю — чему это научит на этот раз?",
    text:
      "Если так происходит часто, ребенок может не получить опыт «дискомфорт можно пережить». Но иногда отступить — нормально и даже правильно.",
    scaleKey: "conflictTolerance",
    sourceHint: "способность выдерживать конфликт и дискомфорт"
  }
];

const emptyWeights = Object.fromEntries(scaleKeys.map((key) => [key, 0]));

function loadCases() {
  const casesPath = path.join(root, "src/data/cases.ts");
  let source = fs.readFileSync(casesPath, "utf8");
  source = source
    .replace(/^import type .*$/gm, "")
    .replace(/^import \{ emptyWeights \} from .*$/gm, `const emptyWeights = ${JSON.stringify(emptyWeights)};`);

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;

  const sandbox = { exports: {}, module: { exports: {} }, console };
  sandbox.module.exports = sandbox.exports;
  vm.runInNewContext(compiled, sandbox, { filename: casesPath });
  return sandbox.module.exports.testCases ?? sandbox.exports.testCases;
}

function loadFoundations() {
  const foundationsPath = path.join(root, "src/data/foundations.ts");
  let source = fs.readFileSync(foundationsPath, "utf8");
  source = source.replace(/^import type .*$/gm, "");

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;

  const sandbox = { exports: {}, module: { exports: {} }, console };
  sandbox.module.exports = sandbox.exports;
  vm.runInNewContext(compiled, sandbox, { filename: foundationsPath });
  return sandbox.module.exports;
}

const testCases = loadCases();
const foundationData = loadFoundations();
const scientificFoundations = foundationData.scientificFoundations ?? [];
const learningMaterials = foundationData.learningMaterials ?? [];
const allQuestions = testCases.flatMap((testCase) =>
  testCase.questions.map((question) => ({ ...question, caseId: testCase.id, caseTitle: testCase.title }))
);

function serveAsset(req, res) {
  const safePath = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, "public", safePath.replace(/^\/+/, ""));
  if (!filePath.startsWith(path.join(root, "public")) || !fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function html() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Родительская позиция — тест на автоматическую реакцию</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0C0906;
      --panel: #161210;
      --panel2: #1E1A17;
      --text: #F0EDE8;
      --muted: rgba(240,237,232,.55);
      --line: rgba(240,237,232,.1);
      --pink: #FF2D8A;
      --mint: #7DDBB8;
      --blue: #85AAFF;
      --yellow: #F5D060;
      --red: #FF6B6B;
      --accent: #E8C9A0;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      overflow-x: hidden;
      cursor: none;
    }
    @media (hover: none) { body { cursor: auto; } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
      .reveal > *, .fade-up, .stagger > * { transform: none !important; opacity: 1 !important; }
    }
    body { overflow-x: hidden; }
    a { color: inherit; text-decoration: none; }

    /* ── Custom Cursor ─────────────────────────────────── */
    #cursor {
      position: fixed;
      top: 0; left: 0;
      width: 36px; height: 36px;
      border: 1.5px solid rgba(240,237,232,.7);
      border-radius: 50%;
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      transition: transform 0.08s linear, width 0.25s ease, height 0.25s ease, background 0.25s ease, border-color 0.25s ease;
      mix-blend-mode: difference;
    }
    #cursor.hover {
      width: 60px; height: 60px;
      background: rgba(240,237,232,.12);
    }
    #cursor-dot {
      position: fixed;
      top: 0; left: 0;
      width: 5px; height: 5px;
      background: var(--mint);
      border-radius: 50%;
      pointer-events: none;
      z-index: 10000;
      transform: translate(-50%, -50%);
    }
    @media (hover: none) { #cursor, #cursor-dot { display: none; } }

    /* ── Layout ────────────────────────────────────────── */
    .wrap { width: min(1240px, calc(100% - 48px)); margin: 0 auto; }
    .screen { padding-bottom: 120px; }

    /* ── Header ────────────────────────────────────────── */
    .top {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 100;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 24px;
      padding: 20px 40px;
      background: linear-gradient(to bottom, rgba(12,9,6,.95) 0%, transparent 100%);
      backdrop-filter: blur(0px);
    }
    .brand {
      display: flex;
      flex-direction: column;
      text-transform: uppercase;
      letter-spacing: .2em;
      font-size: 11px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
    }
    .brand small { color: var(--muted); font-size: 9px; margin-top: 3px; letter-spacing: .18em; }
    .header-meta {
      text-align: center;
      font-size: 10px;
      letter-spacing: .16em;
      text-transform: uppercase;
      color: var(--muted);
      line-height: 1.6;
    }
    .header-clock { font-size: 10px; color: var(--muted); text-align: right; letter-spacing: .1em; }
    .nav { display: flex; gap: 8px; align-items: center; }
    .nav a {
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 16px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      background: transparent;
      transition: color .2s, border-color .2s, background .2s;
    }
    .nav a:hover { color: var(--text); border-color: rgba(240,237,232,.3); }
    .nav a.primary {
      background: var(--mint);
      color: #0C0906;
      border-color: var(--text);
      font-weight: 600;
    }
    .nav a.primary:hover { background: var(--accent); border-color: var(--accent); }
    .pill {
      display: inline-flex; align-items: center; justify-content: center;
      height: 36px; padding: 0 16px;
      border: 1px solid var(--line); border-radius: 999px;
      color: var(--muted); font-size: 13px;
      background: transparent;
      transition: color .2s, border-color .2s;
    }
    .pill:hover { color: var(--text); border-color: rgba(240,237,232,.3); }

    /* ── Hero ──────────────────────────────────────────── */
    .hero {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 120px 40px 80px;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse 80% 60% at 50% 100%, rgba(255,45,138,.06) 0%, transparent 60%),
                  radial-gradient(ellipse 60% 40% at 80% 20%, rgba(133,170,255,.04) 0%, transparent 50%);
      pointer-events: none;
    }
    .hero-eyebrow {
      font-size: 11px;
      letter-spacing: .3em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 32px;
    }
    .hero h1 {
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: clamp(38px, 5.8vw, 88px);
      line-height: 1.05;
      font-weight: 400;
      letter-spacing: -.025em;
      color: var(--text);
      max-width: 1000px;
      margin: 0 0 32px;
    }
    .hero h1 em {
      font-style: italic;
      color: var(--accent);
    }
    .hero-bottom {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 32px;
      flex-wrap: wrap;
    }
    .hero-lead {
      max-width: 520px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.7;
    }
    .hero-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 40px;
    }
    .chip {
      display: inline-flex; align-items: center; gap: 7px;
      height: 32px; padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      letter-spacing: .05em;
      background: transparent;
    }
    .chip.c-pink { border-color: rgba(255,45,138,.3); color: rgba(255,45,138,.8); }
    .chip.c-mint { border-color: rgba(125,219,184,.3); color: rgba(125,219,184,.8); }

    /* ── Divider line ───────────────────────────────────── */
    .divider { border: none; border-top: 1px solid var(--line); margin: 0; }

    /* ── Buttons ────────────────────────────────────────── */
    .button {
      border: 1px solid var(--mint);
      height: 54px;
      padding: 0 32px;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
      color: #0C0906;
      background: var(--mint);
      font-size: 15px;
      font-family: inherit;
      letter-spacing: .02em;
      transition: background .25s, color .25s, border-color .25s, transform .2s;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .button:hover { background: var(--accent); border-color: var(--accent); transform: translateY(-1px); }
    .button.secondary {
      background: transparent;
      color: var(--text);
      border-color: var(--line);
    }
    .button.secondary:hover { border-color: rgba(240,237,232,.4); background: rgba(240,237,232,.06); transform: none; }

    /* ── Floating bottom nav ────────────────────────────── */
    .bottom-nav {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      display: flex;
      gap: 4px;
      background: rgba(22,18,16,.85);
      backdrop-filter: blur(16px);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px;
    }
    .bottom-nav a {
      height: 36px;
      padding: 0 20px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      display: inline-flex; align-items: center;
      transition: color .2s, background .2s;
      white-space: nowrap;
    }
    .bottom-nav a:hover { color: var(--text); background: rgba(240,237,232,.08); }
    .bottom-nav a.active { background: var(--text); color: var(--bg); font-weight: 600; }

    /* ── Sections ───────────────────────────────────────── */
    .section {
      padding: 96px 40px;
      border-top: 1px solid var(--line);
    }
    .section-inner { max-width: 1240px; margin: 0 auto; }
    .section-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 48px;
      align-items: end;
      margin-bottom: 64px;
    }
    .section-header .kicker { margin-bottom: 16px; }
    .section-header p { color: var(--muted); line-height: 1.7; }

    /* ── Scroll reveal animations ─────────────────────── */
    @keyframes fadeUp { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: translateY(0); } }
    .hero-eyebrow { animation: fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
    .hero h1 { animation: fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.2s both; }
    .hero-lead { animation: fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.35s both; }
    .hero-actions { animation: fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.45s both; }
    .hero .chips { animation: fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 0.55s both; }
    .reveal {
      overflow: hidden;
    }
    .reveal > * {
      display: block;
      transform: translateY(60px);
      opacity: 0;
      transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .reveal.visible > * { transform: translateY(0); opacity: 1; }
    .fade-up {
      transform: translateY(40px);
      opacity: 0;
      transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.7s ease;
    }
    .fade-up.visible { transform: translateY(0); opacity: 1; }
    .stagger > * {
      opacity: 0;
      transform: translateY(30px);
      transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .stagger.visible > *:nth-child(1) { transition-delay: 0ms; }
    .stagger.visible > *:nth-child(2) { transition-delay: 80ms; }
    .stagger.visible > *:nth-child(3) { transition-delay: 160ms; }
    .stagger.visible > *:nth-child(4) { transition-delay: 240ms; }
    .stagger.visible > *:nth-child(5) { transition-delay: 320ms; }
    .stagger.visible > * { opacity: 1; transform: translateY(0); }

    /* ── Result visualization ───────────────────────────── */
    .result-top { display: grid; grid-template-columns: 340px 1fr; gap: 48px; align-items: start; margin-bottom: 40px; }
    .result-radar-col { position: sticky; top: 80px; }
    .result-radar-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 24px; }
    .result-insights { display: flex; flex-direction: column; gap: 0; }
    .ri-item { padding: 20px 0; border-bottom: 1px solid var(--line); }
    .ri-item:last-of-type { border-bottom: none; }
    .ri-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 6px; font-weight: 500; }
    .ri-item h3 { font-family: "Cormorant Garamond", Georgia, serif; font-size: clamp(18px, 2.2vw, 26px); font-weight: 400; margin: 0 0 8px; color: var(--text); }
    .ri-text { font-size: 14px; color: var(--muted); line-height: 1.55; margin: 0; }
    .result-scales-wrap { padding-top: 0; }
    .result-scales { display: flex; flex-direction: column; gap: 0; }
    .sbar-item { padding: 20px 0; border-bottom: 1px solid var(--line); }
    .sbar-item:last-child { border-bottom: none; }
    .sbar-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .sbar-title { font-size: 14px; font-weight: 500; color: var(--text); }
    .sbar-num { font-family: "Cormorant Garamond", Georgia, serif; font-size: 32px; font-weight: 400; line-height: 1; flex-shrink: 0; }
    .sbar-track { height: 3px; background: rgba(240,237,232,.08); border-radius: 2px; margin-bottom: 10px; overflow: hidden; }
    .sbar-fill { height: 100%; border-radius: 2px; transition: width 1s cubic-bezier(0.16,1,0.3,1); }
    .sbar-desc { font-size: 13px; color: var(--muted); line-height: 1.55; margin: 0 0 4px; }
    .sbar-howto { margin: 0; line-height: 1.5; }
    .strategy-block { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 28px; margin-bottom: 40px; }
    .strategy-pattern { font-size: 14px; line-height: 1.65; color: var(--muted); margin: 0 0 12px; }
    .strategy-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .strategy-col { background: rgba(240,237,232,.045); border-radius: 14px; padding: 16px 18px; }
    .strategy-col-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; margin-bottom: 8px; display: block; }
    .strategy-col p { font-size: 13px; line-height: 1.55; color: var(--muted); margin: 0; }
    .sbar-zone { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; font-weight: 600; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
    .sbar-inline-art { margin-top: 14px; padding: 13px 15px; background: rgba(240,237,232,.04); border-radius: 12px; border-left: 2px solid rgba(82,127,240,.4); }
    .sbar-inline-art .art-meta { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-bottom: 5px; }
    .sbar-inline-art h4 { font-size: 13px; font-weight: 500; margin: 0 0 5px; color: var(--text); line-height: 1.35; }
    .sbar-inline-art p { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 0 0 8px; }
    .sbar-level-text { font-size: 14px; line-height: 1.6; color: var(--text); margin: 0 0 10px; }
    .sbar-tip { background: rgba(240,237,232,.04); border-radius: 10px; padding: 10px 13px; margin: 10px 0 0; }
    .sbar-tip-label { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; font-weight: 600; }
    .sbar-tip p { font-size: 12px; line-height: 1.55; color: var(--muted); margin: 0; }
    .verdict-line { font-size: 15px; line-height: 1.55; color: var(--text); background: rgba(240,237,232,.05); border-radius: 12px; padding: 14px 16px; margin-bottom: 24px; border-left: 2px solid var(--pink); }
    @media (max-width: 600px) { .strategy-cols { grid-template-columns: 1fr; } }
    @media (max-width: 768px) {
      /* ── Scroll animations: disable on mobile to avoid invisible gaps ── */
      .stagger > *, .fade-up, .reveal > * {
        opacity: 1 !important;
        transform: none !important;
        transition: none !important;
      }
      /* ── Body: padding for fixed bottom-nav ── */
      body { padding-bottom: 80px; }
      /* ── Header: hide non-essential elements ── */
      .header-meta, .header-clock { display: none; }
      .top { padding: 12px 16px; }
      .nav a:not(:last-child) { display: none; }
      /* ── Hero ── */
      .hero { padding: 80px 20px 48px; }
      .hero-bottom { flex-direction: column; align-items: flex-start; gap: 20px; }
      .hero-actions { width: 100%; }
      .hero-actions .button { width: 100%; justify-content: center; }
      .chips { gap: 6px; }
      /* ── Sections ── */
      .section-inner { padding: 48px 20px; }
      .section-header { flex-direction: column; gap: 16px; }
      .grid { grid-template-columns: 1fr !important; gap: 16px; }
      .value-grid { grid-template-columns: 1fr !important; }
      .testimonials-grid { grid-template-columns: 1fr !important; }
      /* ── Result ── */
      .result-top { grid-template-columns: 1fr; gap: 24px; }
      .result-radar-col { position: static; }
      /* ── Cards ── */
      details.card > summary { padding: 20px 16px; padding-right: 40px; }
      details.card > *:not(summary) { padding: 20px 16px; }
      .card { padding: 24px 20px; }
      /* ── Bottom nav ── */
      .bottom-nav { padding: 10px 16px; gap: 4px; }
      .bottom-nav a { font-size: 12px; padding: 8px 10px; }
      /* ── Article ── */
      .article { padding: 0 20px; }
      .article-hero { padding: 48px 20px !important; }
      /* ── Section spacing ── */
      .section { padding-top: 40px !important; padding-bottom: 40px !important; }
      .section-inner { padding: 0 20px !important; }
      .divider { margin: 0; }
      h2 { font-size: clamp(26px, 7vw, 40px) !important; }
    }
    /* ── Value grid ─────────────────────────────────────── */
    .value-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--line);
      border: 1px solid var(--line);
      border-radius: 20px;
      overflow: hidden;
    }
    .value-item {
      background: var(--bg);
      padding: 40px 36px;
      transition: background .3s;
    }
    .value-item:hover { background: var(--panel); }
    .value-num {
      font-size: 11px;
      letter-spacing: .25em;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    .value-item h3 {
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: clamp(22px, 2.2vw, 30px);
      font-weight: 400;
      letter-spacing: -.01em;
      color: var(--text);
      margin-bottom: 16px;
      line-height: 1.2;
    }
    .value-item p { color: var(--muted); font-size: 15px; line-height: 1.65; }

    /* ── Testimonials ───────────────────────────────────── */
    .testimonials-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .testimonial {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 32px 28px;
      transition: border-color .3s, transform .3s;
    }
    .testimonial:hover { border-color: rgba(240,237,232,.22); transform: translateY(-3px); }
    .testimonial blockquote {
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 17px;
      line-height: 1.65;
      color: var(--text);
      font-style: italic;
      margin-bottom: 24px;
    }
    .testimonial footer { font-size: 13px; color: var(--muted); letter-spacing: .03em; }

    /* ── Cards ──────────────────────────────────────────── */
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--line); border-radius: 20px; overflow: hidden; margin: 48px 0; }
    .card {
      background: var(--panel);
      padding: 32px;
      transition: background .3s;
    }
    .card:hover { background: var(--panel2); }
    .card.light { background: #F5F0E8; color: #1A1410; }
    .card.light p, .card.light h2, .card.light h3 { color: #2A2018; }
    .card.light:hover { background: #EDE8DF; }
    .article { max-width: 1080px; margin: 0 auto; display: grid; gap: 1px; background: var(--line); border-radius: 20px; overflow: hidden; }
    .article > * { background: var(--panel); padding: 40px; }
    .article-hero { padding: clamp(28px, 5vw, 56px) !important; background: linear-gradient(135deg,#1A1208 0%,#0C0906 100%) !important; border-bottom: 1px solid var(--line); color: var(--text) !important; }
    .article-hero h1 { font-family: "Cormorant Garamond", Georgia, serif; font-size: clamp(28px, 4.2vw, 48px); line-height: 1.18; color: var(--text) !important; font-weight: 400; letter-spacing: -.02em; }
    .article-hero p, .article-hero .lead { color: var(--muted) !important; }
    .kicker { margin: 0 0 16px; text-transform: uppercase; letter-spacing: .25em; font-size: 11px; font-weight: 600; color: var(--muted); }
    .rows { display: grid; gap: 1px; background: var(--line); border-radius: 14px; overflow: hidden; margin-top: 24px; }
    .row { background: var(--bg); padding: 20px 24px; }
    .stage { display: grid; gap: 12px; grid-template-columns: 44px 160px 1fr; align-items: start; }
    .qa { display: grid; gap: 16px; grid-template-columns: 44px 1fr; align-items: start; }
    .num { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--pink); color: #fff; font-weight: 700; font-size: 13px; }
    .author { display: grid; grid-template-columns: .9fr 1.1fr; gap: 1px; background: var(--line); border-radius: 20px; overflow: hidden; margin: 48px 0; }
    .author > * { background: var(--panel); padding: 40px; }
    .portrait { position: relative; min-height: 420px; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 60% 20%,rgba(201,142,111,.15),transparent 38%); }
    .portrait.mint { background: radial-gradient(circle at 35% 15%,rgba(124,154,130,.15),transparent 34%); }
    .portrait img { width: min(78vw, 320px); height: min(78vw, 320px); border-radius: 50%; object-fit: cover; filter: grayscale(20%); }
    .facts { display: grid; gap: 1px; background: var(--line); border-radius: 14px; overflow: hidden; margin-top: 24px; }
    .fact { background: var(--bg); padding: 16px 20px; font-size: 15px; font-weight: 500; line-height: 1.5; color: var(--text); }
    h1 { font-family: "Cormorant Garamond", Georgia, serif; font-size: clamp(38px, 5.8vw, 88px); line-height: 1.05; font-weight: 400; letter-spacing: -.025em; color: var(--text); }
    h2 { font-family: "Cormorant Garamond", Georgia, serif; font-size: clamp(26px, 3.2vw, 42px); line-height: 1.1; font-weight: 400; letter-spacing: -.015em; color: var(--text); margin-bottom: 16px; }
    h3 { font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 8px; letter-spacing: -.01em; }
    p { color: var(--muted); line-height: 1.7; font-size: 15px; }
    p + p { margin-top: 12px; }

    /* ── Test & result specific ─────────────────────────── */
    .cta { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 40px; }
    .status {
      width: fit-content;
      color: var(--muted); font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
      border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px;
    }
    .test-shell { display: grid; grid-template-columns: 300px 1fr; gap: 24px; align-items: start; }
    .side { position: sticky; top: 100px; }
    .progress { height: 3px; border-radius: 999px; background: var(--line); overflow: hidden; margin-top: 16px; }
    .progress span { display: block; height: 100%; width: var(--w); background: var(--pink); border-radius: 999px; transition: width .4s ease; }
    .case-list { display: grid; gap: 6px; margin-top: 16px; }
    .case-dot { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); color: var(--muted); font-size: 13px; transition: all .2s; }
    .case-dot.active { color: var(--bg); background: var(--pink); border-color: var(--pink); font-weight: 600; }
    .question { padding: clamp(24px,4vw,48px); }
    .scenario { font-size: 19px; color: var(--text); line-height: 1.6; }
    .options { display: grid; gap: 10px; margin-top: 28px; }
    .option { width: 100%; text-align: left; border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 14px; padding: 18px 20px; font-size: 15px; line-height: 1.5; cursor: pointer; font-family: inherit; transition: border-color .25s, color .25s, background .25s, transform .2s; }
    .option:hover { transform: translateX(4px); }
    details summary { cursor: pointer; }
    .option:hover { border-color: rgba(240,237,232,.3); color: var(--text); background: rgba(240,237,232,.04); }
    .option.selected { border-color: var(--pink); color: var(--text); background: rgba(255,45,138,.07); }
    textarea { width: 100%; min-height: 140px; resize: vertical; border: 1px solid var(--line); border-radius: 14px; background: transparent; color: var(--text); padding: 16px 20px; font: inherit; line-height: 1.6; transition: border-color .2s; }
    textarea:focus { outline: none; border-color: rgba(240,237,232,.3); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
    .error { color: var(--red); min-height: 20px; font-size: 14px; }
    .bars { display: grid; gap: 16px; margin-top: 20px; }
    .bar-row { display: grid; gap: 8px; }
    .bar-line { height: 3px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .bar-line span { display: block; height: 100%; width: var(--w); background: var(--pink); border-radius: 999px; }
    .fine { color: var(--muted); font-size: 13px; line-height: 1.5; }
    details summary { cursor: pointer; list-style: none; }
    details summary::-webkit-details-marker { display: none; }
    details.card { border: none; background: transparent; }
    details.card > summary { padding: 28px 32px; background: var(--panel); border-bottom: 1px solid var(--line); }
    details.card > summary h2 { margin-bottom: 0; }
    details.card > summary { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding-right: 48px; position: relative; }
    details.card > summary h2 { margin-bottom: 0; }
    details.card > summary .kicker { margin-bottom: 0; }
    details.card > summary::after { content: ""; position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(240,237,232,.35)' stroke-width='1.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M12 4.5v15m7.5-7.5h-15'/%3E%3C/svg%3E") center/contain no-repeat; transition: transform 0.25s ease; }
    details.card[open] > summary::after { transform: translateY(-50%) rotate(45deg); }
    details.card.light > summary { background: #EDE8DF; }
    details.card.light > summary h2 { color: #1A1410; }
    details.card.light > summary::after { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(30,20,10,.4)' stroke-width='1.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M12 4.5v15m7.5-7.5h-15'/%3E%3C/svg%3E"); }
    details.card.light > *:not(summary) { background: #F5F0E8; color: #2A2018; }
    details.card.light > *:not(summary) p { color: #4A3828; }
    details.card > *:not(summary) { padding: 28px 32px; background: var(--bg); }
    .q-slider { overflow-x: auto; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; scrollbar-width: none; padding: 32px 0; }
    .q-slider::-webkit-scrollbar { display: none; }
    .q-track { display: flex; gap: 20px; padding: 0 clamp(20px,5vw,80px); }
    .q-card { scroll-snap-align: start; flex-shrink: 0; width: 340px; background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 32px 28px; display: flex; flex-direction: column; gap: 12px; }
    .q-card .q-num { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(255,45,138,.15); color: var(--pink); font-size: 13px; font-weight: 700; font-family: Inter,sans-serif; flex-shrink: 0; }
    .q-card h3 { font-family: "Cormorant Garamond", Georgia, serif; font-size: clamp(19px,1.6vw,22px); font-weight: 400; line-height: 1.25; margin: 0; color: var(--text); }
    .q-card p { font-size: 14px; line-height: 1.6; color: var(--muted); margin: 0; }
    .q-hint { display: flex; gap: 8px; align-items: center; padding: 0 clamp(20px,5vw,80px); margin-top: 4px; }
    .q-hint-dot { width: 24px; height: 2px; border-radius: 2px; background: rgba(240,237,232,.15); }
    .q-hint-dot.active { background: var(--pink); }

    /* ── Scroll progress bar ────────────────────────────── */
    #scroll-progress {
      position: fixed;
      top: 0; left: 0;
      height: 2px;
      width: 0%;
      background: linear-gradient(90deg, var(--pink), var(--accent));
      z-index: 200;
      transition: width .1s linear;
    }

    @media (max-width: 900px) {
      .top { padding: 16px 20px; grid-template-columns: 1fr auto; }
      .header-meta, .header-clock { display: none; }
      .hero { padding: 100px 20px 80px; }
      .hero h1 { font-size: clamp(42px, 11vw, 80px); }
      .hero-bottom { flex-direction: column; align-items: flex-start; }
      .hero-actions { align-items: flex-start; }
      .section { padding: 64px 20px; }
      .section-header { grid-template-columns: 1fr; gap: 24px; }
      .value-grid, .testimonials-grid { grid-template-columns: 1fr; }
      .grid, .test-shell, .author, .stage { grid-template-columns: 1fr; }
      .side { position: static; }
      .bottom-nav { bottom: 16px; padding: 4px; }
      .bottom-nav a { padding: 0 14px; font-size: 12px; }
      .author { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div id="scroll-progress"></div>
  <div id="cursor"></div>
  <div id="cursor-dot"></div>
  <div id="app"></div>
  <script>
    const TEST_CASES = ${JSON.stringify(testCases)};
    const SCALE_KEYS = ${JSON.stringify(scaleKeys)};
    const SCALE_TITLES = ${JSON.stringify(scaleTitles)};
    const SCALE_DESCRIPTIONS = ${JSON.stringify(scaleDescriptions)};
    const SCALE_ICONS = {
  "adultResponsibility": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  "emotionalContact": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  "boundariesConsistency": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  "autonomySupport": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
  "conflictTolerance": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 18.5 L6 12 L9.5 18.5"/><path d="M14.5 5.5 L18 12 L21.5 5.5"/><line x1="2.5" y1="18.5" x2="21.5" y2="5.5" stroke-opacity="0.3"/></svg>',
  "flexibility": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  "difficultyVsUnsafety": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
};
      const SCALE_ACADEMIC_BASIS = ${JSON.stringify(scaleAcademicBasis)};
    const STRENGTH_TITLES = ${JSON.stringify(strengthTitles)};
    const STRENGTH_DESCRIPTIONS = ${JSON.stringify(strengthDescriptions)};
    const ATTENTION_TITLES = ${JSON.stringify(attentionTitles)};
    const ATTENTION_DESCRIPTIONS = ${JSON.stringify(attentionDescriptions)};
    const SCALE_HOWTO = ${JSON.stringify(scaleHowTo)};
    const SCALE_LEVEL_TEXTS = ${JSON.stringify(scaleLevelTexts)};
    const REACTION_QUESTIONS = ${JSON.stringify(reactionQuestions)};
    const LEARNING_MATERIALS = ${JSON.stringify(learningMaterials)};
    const REACTION_BY_SCALE = {
      adultResponsibility: REACTION_QUESTIONS[0],
      difficultyVsUnsafety: REACTION_QUESTIONS[0],
      emotionalContact: REACTION_QUESTIONS[1],
      autonomySupport: REACTION_QUESTIONS[2],
      boundariesConsistency: REACTION_QUESTIONS[3],
      conflictTolerance: REACTION_QUESTIONS[4],
      flexibility: REACTION_QUESTIONS[0]
    };
    const QUESTIONS = TEST_CASES.flatMap(testCase => testCase.questions.map(question => ({...question, caseId: testCase.id, caseTitle: testCase.title})));
    const SESSION_KEY = "rp-recovery-session-v1";
    const RESULT_KEY = "rp-recovery-result-v1";

    let state = loadState();

    function loadState() {
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY)) || { started: false, index: 0, answers: [] };
      } catch {
        return { started: false, index: 0, answers: [] };
      }
    }

    function saveState() {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state));
    }

    function navigate(pathname) {
      history.pushState(null, "", pathname);
      render();
    }

    window.addEventListener("popstate", render);

    function shell(content) {
      const now = new Date();
      const msk = now.toLocaleTimeString("ru-RU", {timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit"});
      const spb = now.toLocaleTimeString("ru-RU", {timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit"});
      return '<header class="top"><a class="brand" href="/" data-link><span>Родительская позиция</span><small>тест · родители детей 6–17 лет</small></a><div class="header-meta">Разработан с психологом · экспериментальная методика</div><div style="display:flex;align-items:center;gap:12px"><div class="header-clock" id="hclock">МСК ' + msk + '</div><nav class="nav"><a href="/#methodology" data-link>Методика</a><a href="/#about" data-link>Авторы</a><a class="primary" href="/#test" data-link>Пройти тест →</a></nav></div></header><main style="padding-top:80px">' + content + '</main><nav class="bottom-nav"><a href="/#why" data-link>Зачем</a><a href="/#methodology" data-link>Методика</a><a href="/#about" data-link>Авторы</a><a href="/#test" data-link class="active">Пройти тест</a></nav>';
    }

    function home() {
      const questionCards = REACTION_QUESTIONS.map(item => '<div class="row qa"><span class="num">0' + item.number + '</span><div><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.text) + '</p></div></div>').join("");
      return shell('<section class="hero"><p class="hero-eyebrow">Тест на автоматическую родительскую реакцию · Шесть ситуаций</p><h1>Когда ребёнок говорит <em style="white-space:nowrap">«не хочу»</em>,<br>вы реагируете <em>раньше</em>,<br>чем думаете</h1><div class="hero-bottom"><p class="hero-lead">Для родителей, которые ловят себя то на «я сказал — значит сделай», то на «ладно, не хочешь — не надо». Шесть ситуаций без подсказок правильного ответа — и честный разбор ваших решений.</p><div class="hero-actions"><button class="button" data-start>Пройти тест — 10 минут →</button><p class="fine" style="text-align:right">без регистрации · только в этом браузере</p></div></div><div class="chips"><span class="chip c-pink"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> границы</span><span class="chip c-mint"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> контакт</span><span class="chip c-pink"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/></svg> самостоятельность</span><span class="chip c-mint"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> без регистрации</span><span class="chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> 200+ родителей</span></div></section><hr class="divider"><section class="section" id="why"><div class="section-inner"><div class="section-header fade-up"><div><p class="kicker" style="color:var(--pink)">зачем проходить</p><h2>Что изменится после этих 10 минут</h2></div><p style="max-width:400px">Это не ещё один тест «для интереса». Способ заметить свой автоматический способ реагировать — раньше, чем он сработает в следующий раз.</p></div><div class="value-grid stagger"><div class="value-item"><p class="value-num">01</p><h3>Понимание своей реакции</h3><p>Вы увидите, что чаще выбираете: удержать правило, сохранить контакт, дать самостоятельность — и в каких ситуациях это работает против вас.</p></div><div class="value-item"><p class="value-num">02</p><h3>Конкретные фразы</h3><p>Готовые формулировки для следующего разговора — не «быть терпеливее», а слова, которые можно сказать сегодня вечером.</p></div><div class="value-item"><p class="value-num">03</p><h3>Пауза 2–3 секунды</h3><p>Не план на месяц, а одно изменение в реакции на «не хочу». Этой паузы достаточно, чтобы выбрать реакцию, а не действовать на автомате.</p></div></div></div></section><hr class="divider"><section class="section"><div class="section-inner"><p class="kicker fade-up" style="color:var(--mint)">отзывы</p><h2 class="fade-up" style="margin-bottom:40px">Что говорят родители</h2><div class="testimonials-grid stagger"><div class="testimonial"><blockquote>«Я думала, что я спокойный родитель. Тест показал, что я жёстко держу правила там, где ребёнку нужен просто контакт. Это было неожиданно и очень полезно.»</blockquote><footer>— Анна, мама сына 9 лет</footer></div><div class="testimonial"><blockquote>«Понравилось, что нет правильных ответов. Ситуации реальные — я несколько раз узнал себя. Фразы из результата использую до сих пор.»</blockquote><footer>— Дмитрий, папа дочери 12 лет</footer></div><div class="testimonial"><blockquote>«Прошла за 8 минут в обеденный перерыв. Муж тоже прошёл — сравнивали профили и поняли, почему у нас разные реакции на одни ситуации.»</blockquote><footer>— Светлана, мама двоих, дети 7 и 14 лет</footer></div></div></div></section><hr class="divider"><details class="card"><summary><p class="kicker" style="color:var(--pink)">узнаваемо?</p><h2>Раздражение, чувство вины и мысль «я всё делаю неправильно» — это сигнал, а не диагноз</h2></summary><div class="rows"><div class="row"><p>Фрустрация и вина чаще всего появляются после — когда вы уже отреагировали и прокручиваете ситуацию заново. Этот тест работает с моментом до: что вы выбираете, когда решение еще не принято.</p></div><div class="row"><p>Цель не «делать всё правильно», а замечать свой способ реагировать достаточно рано, чтобы у вас был выбор, а не только автоматизм.</p></div></div></details><section class="section" style="padding-top:48px;padding-bottom:48px"><div class="section-inner"><div class="grid stagger" style="margin:0"><details class="card"><summary><h2>Что делает тест</h2></summary><p>Показывает не «какой вы родитель», а какие решения чаще появляются под давлением: удержать правило, поддержать контакт, дать выбор, проверить среду.</p></details><details class="card light"><summary><h2>Честное ограничение</h2></summary><p>Методика находится на этапе разработки и апробации. Это не психологическая диагностика и не медицинское заключение. «Карта автоматических реакций» — образ для удобства чтения, а не клинический термин.</p></details></div></div></section><section class="section" style="padding-bottom:40px"><div class="section-inner"><div class="section-header fade-up" style="margin-bottom:28px"><div><p class="kicker">прежде чем реагировать</p><h2>Пять вопросов за&nbsp;3 секунды</h2></div><p style="max-width:360px">Это не тест на правильность прошлых решений, а инструмент для следующего раза.</p></div></div><div class="q-slider"><div class="q-track">' + REACTION_QUESTIONS.map((item,i)=>'<div class="q-card"><span class="q-num">0'+(i+1)+'</span><h3>'+escapeHtml(item.title)+'</h3><p>'+escapeHtml(item.text)+'</p></div>').join('') + '</div></div><div style="padding:0 clamp(20px,5vw,80px) 8px"><p class="fine" style="color:rgba(240,237,232,.28)">Это рамка для размышления, а не алгоритм с гарантированным результатом.</p></div></section><details class="card"><summary><p class="kicker" style="color:var(--mint)">что будет в результате</p><h2>Не вердикт. Карта ваших автоматических реакций — и три коротких шага, что с ней делать.</h2></summary><div class="rows"><div class="row"><h3>1. Сразу</h3><p>Готовые фразы для следующего разговора с ребенком, под вашу зону внимания.</p></div><div class="row"><h3>2. На неделю</h3><p>Один маленький эксперимент: в следующий раз, когда услышите «не хочу», сначала задайте один из пяти вопросов выше.</p></div><div class="row"><h3>3. Дальше</h3><p>Подборка статей и книг под ваш профиль.</p></div></div><p class="fine">Эти шаги — общие практические подсказки, а не индивидуальные рекомендации.</p></details><section class="article"><p class="kicker" style="color:var(--blue)">пример</p><h2>Так выглядит результат</h2>' + resultPage(true) + '</section><div class="cta" style="margin:48px 0"><button class="button" data-start>Пройти тест за 10 минут</button><span class="fine">Данные сохраняются только в этом браузере.</span></div>' + methodologyPage() + aboutPage() + '<section id="test" class="article">' + testSection() + '</section><footer style="padding:60px 40px 100px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:24px"><div><p class="kicker" style="color:var(--muted);margin-bottom:8px">Родительская позиция</p><p class="fine">Экспериментальная методика · 2024–2025</p></div><div style="text-align:right"><p class="fine" style="margin-bottom:12px">Остались вопросы?</p><a class="button secondary" href="mailto:galya.chooru@gmail.com" style="font-size:14px;height:44px;padding:0 24px">Связаться с нами</a></div></footer>');
    }

    function start() {
      state = { started: true, index: 0, answers: [], startedAt: new Date().toISOString() };
      saveState();
      render();
      const target = document.querySelector("#test");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function currentAnswer() {
      const question = QUESTIONS[state.index];
      return state.answers.find(answer => answer.questionId === question?.id);
    }

    function testSection() {
      if (!state.started) {
        return '<div class="card question"><h2>Перед началом</h2><p>Отвечайте как в жизни, а не как «надо». Не указывайте имена ребенка, школу и другие персональные данные.</p><div class="actions"><button class="button" data-start>Начать тест</button></div></div>';
      }

      const question = QUESTIONS[state.index];
      if (!question) return resultPage(false);
      const testCase = TEST_CASES.find(item => item.id === question.caseId);
      const answer = currentAnswer();
      const percent = Math.round((state.index / QUESTIONS.length) * 100);
      const caseIndex = TEST_CASES.findIndex(item => item.id === question.caseId);
      const options = question.type === "open"
        ? '<textarea data-open placeholder="Напишите первую настоящую фразу ребенку">' + escapeHtml(answer?.textAnswer || "") + '</textarea><p class="fine">' + escapeHtml(question.helper || "") + '</p>'
        : '<div class="options">' + question.options.map(option => '<button class="option ' + (answer?.selectedOptionId === option.id ? "selected" : "") + '" data-option="' + option.id + '">' + escapeHtml(option.label) + '<br><span class="fine">' + escapeHtml(option.rationale) + '</span></button>').join("") + '</div>';

      return '<main class="test-shell"><aside class="card side"><div class="pill">Вопрос ' + (state.index + 1) + ' из ' + QUESTIONS.length + '</div><div class="progress" style="--w:' + percent + '%"><span></span></div><div class="case-list">' + TEST_CASES.map((item, index) => '<div class="case-dot ' + (index === caseIndex ? "active" : "") + '">' + (index + 1) + ". " + escapeHtml(item.title) + '</div>').join("") + '</div></aside><section class="card question"><p class="fine">' + escapeHtml(testCase.title) + ', ребенок ' + testCase.childAge + '</p><h2>' + escapeHtml(question.prompt) + '</h2><p class="scenario">' + escapeHtml(testCase.scenario) + '</p>' + options + '<p class="error" id="error"></p><div class="actions"><button class="button secondary" data-back ' + (state.index === 0 ? "disabled" : "") + '>Назад</button><button class="button" data-next>' + (state.index === QUESTIONS.length - 1 ? "Собрать результат" : "Дальше") + '</button></div></section></main>';
    }

    function setAnswer(value) {
      const question = QUESTIONS[state.index];
      state.answers = state.answers.filter(answer => answer.questionId !== question.id);
      state.answers.push({
        questionId: question.id,
        caseId: question.caseId,
        type: question.type,
        selectedOptionId: question.type === "open" ? undefined : value,
        textAnswer: question.type === "open" ? value : undefined,
        updatedAt: new Date().toISOString()
      });
      saveState();
    }

    function next() {
      const question = QUESTIONS[state.index];
      const answer = currentAnswer();
      const error = document.getElementById("error");
      if (!answer || (question.type === "open" && (answer.textAnswer || "").trim().length < (question.minLength || 15))) {
        if (error) error.textContent = question.type === "open" ? "Напишите короткую реплику ребенку, минимум 15 символов." : "Выберите один вариант.";
        return;
      }
      if (state.index < QUESTIONS.length - 1) {
        state.index += 1;
        saveState();
        render();
        const testEl = document.querySelector("#test");
        if (testEl) setTimeout(() => testEl.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        return;
      }
      const result = calculateResult(state.answers);
      localStorage.setItem(RESULT_KEY, JSON.stringify(result));
      fetch("/api/submit-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "result", result, answers: state.answers })
      }).catch(() => {});
      state.index = QUESTIONS.length; // move past last question so testSection shows resultPage
      saveState();
      render();
      const target = document.querySelector("#test");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function calculateResult(answers) {
      const raw = Object.fromEntries(SCALE_KEYS.map(key => [key, 0]));
      const min = Object.fromEntries(SCALE_KEYS.map(key => [key, 0]));
      const max = Object.fromEntries(SCALE_KEYS.map(key => [key, 0]));
      for (const answer of answers) {
        const question = QUESTIONS.find(item => item.id === answer.questionId);
        if (!question?.options?.length) continue;
        for (const key of SCALE_KEYS) {
          const values = question.options.map(option => option.weights[key] || 0);
          min[key] += Math.min(...values);
          max[key] += Math.max(...values);
        }
        const option = question.options.find(item => item.id === answer.selectedOptionId);
        if (!option) continue;
        for (const key of SCALE_KEYS) raw[key] += option.weights[key] || 0;
      }
      const normalized = Object.fromEntries(SCALE_KEYS.map(key => {
        const range = max[key] - min[key];
        const score = range === 0 ? 50 : ((raw[key] - min[key]) / range) * 100;
        return [key, Math.max(0, Math.min(100, Math.round(score)))];
      }));
      const ranked = [...SCALE_KEYS].sort((a,b) => normalized[b] - normalized[a]);
      return { normalized, strongest: ranked[0], second: ranked[1], attention: [...SCALE_KEYS].sort((a,b) => normalized[a] - normalized[b])[0] };
    }

    function pressurePattern(normalized) {
      if (normalized.boundariesConsistency >= 65 && normalized.emotionalContact < 48) {
        return "Когда ребенок усиливает сопротивление, вы чаще быстро переходите к правилу и контролю. Это помогает удерживать рамку, но иногда ребенок слышит решение раньше, чем чувствует, что его состояние поняли.";
      }
      if (normalized.emotionalContact >= 65 && normalized.boundariesConsistency < 48) {
        return "Когда ребенок усиливает сопротивление, вы чаще пытаетесь сохранить контакт. Это снижает накал, но правило или договоренность могут становиться менее видимыми, если их не назвать отдельно.";
      }
      if (normalized.autonomySupport >= 70) {
        return "Под давлением вы часто ищете выбор для ребенка. Сильная сторона этого сценария — уважение к самостоятельности; зона проверки — не становится ли выбор слишком тяжелым для возраста и ситуации.";
      }
      return "Под давлением у вас нет одного резкого сценария: ответы чередуют контакт, правило и поиск формата. Это дает гибкость, но требует ясной короткой формулы, чтобы не решать каждый раз с нуля.";
    }

    function twistPattern(normalized) {
      if (normalized.flexibility >= 65) {
        return "Когда в кейсе появляется новая информация (твист), вы заметно пересобираете решение — это говорит о готовности проверять среду и контекст, а не просто держаться первого выбора.";
      }
      if (normalized.flexibility < 45) {
        return "Когда в кейсе появляется новая информация (твист), решение меняется слабо. Само по себе это не плохо — устойчивость тоже ценна, — но стоит проверять: новые факты вы заметили и осознанно отклонили, или просто не успели их учесть?";
      }
      return "Когда в кейсе появляется новая информация (твист), решение меняется частично: что-то пересматривается, что-то остается прежним. Это рабочий баланс между устойчивостью и гибкостью.";
    }

    function resultPage(demo = false) {
      const result = demo ? {
        normalized: { adultResponsibility: 74, emotionalContact: 69, boundariesConsistency: 58, autonomySupport: 63, conflictTolerance: 52, flexibility: 71, difficultyVsUnsafety: 76 },
        strongest: "difficultyVsUnsafety",
        second: "adultResponsibility",
        attention: "conflictTolerance"
      } : JSON.parse(localStorage.getItem(RESULT_KEY) || "null");
      if (!result) return '<div class="card question"><h2>Результата пока нет</h2><p>Сначала пройдите тест. Ответы сохранятся локально в браузере.</p><button class="button" data-start>Начать тест</button></div>';
      const experiment = REACTION_BY_SCALE[result.attention] || REACTION_QUESTIONS[0];
      const materials = LEARNING_MATERIALS.filter(item => item.scaleKeys?.includes(result.attention) || item.scaleKeys?.includes(result.strongest) || item.scaleKeys?.includes(result.second)).slice(0, 4);
      const materialRows = materials.map(item => '<article class="row"><p class="fine">' + escapeHtml(item.format) + '</p><h3>' + escapeHtml(item.title) + '</h3><p class="fine">' + escapeHtml(item.author) + '</p><p>' + escapeHtml(item.why) + '</p>' + (item.href ? '<a class="pill" href="' + escapeHtml(item.href) + '" target="_blank" rel="noreferrer">Открыть</a>' : '') + '</article>').join("");
      // ── Radar SVG (pure math, no library) ─────────────────────────────────
      const RCX = 160, RCY = 160, RR = 112;
      const rN = SCALE_KEYS.length;
      const rA = SCALE_KEYS.map((_, i) => Math.PI * 2 * i / rN - Math.PI / 2);
      const rGrid = [.25,.5,.75,1].map(f => '<polygon points="' + rA.map(a => (RCX+RR*f*Math.cos(a)).toFixed(1)+','+(RCY+RR*f*Math.sin(a)).toFixed(1)).join(' ') + '" fill="none" stroke="rgba(240,237,232,' + (f===1?.14:.065) + ')" stroke-width="1"/>').join('');
      const rAxes = rA.map(a => '<line x1="'+RCX+'" y1="'+RCY+'" x2="'+(RCX+RR*Math.cos(a)).toFixed(1)+'" y2="'+(RCY+RR*Math.sin(a)).toFixed(1)+'" stroke="rgba(240,237,232,.09)" stroke-width="1"/>').join('');
      const rPts = SCALE_KEYS.map((key,i)=>(RCX+RR*result.normalized[key]/100*Math.cos(rA[i])).toFixed(1)+','+(RCY+RR*result.normalized[key]/100*Math.sin(rA[i])).toFixed(1)).join(' ');
      const rDots = SCALE_KEYS.map((key,i)=>{const px=(RCX+RR*result.normalized[key]/100*Math.cos(rA[i])).toFixed(1),py=(RCY+RR*result.normalized[key]/100*Math.sin(rA[i])).toFixed(1),c=key===result.attention?'#F5D060':key===result.strongest?'#7DDBB8':'rgba(240,237,232,.7)';return '<circle cx="'+px+'" cy="'+py+'" r="4.5" fill="'+c+'" stroke="#0C0906" stroke-width="2"/>';}).join('');
      const rSL = {adultResponsibility:'Взросл.',emotionalContact:'Контакт',boundariesConsistency:'Границы',autonomySupport:'Автономия',conflictTolerance:'Конфликт',flexibility:'Гибкость',difficultyVsUnsafety:'Риск/труд.'};
      const rLabels = SCALE_KEYS.map((key,i)=>{const lx=RCX+(RR+26)*Math.cos(rA[i]),ly=RCY+(RR+26)*Math.sin(rA[i]),anch=lx<RCX-8?'end':lx>RCX+8?'start':'middle',col=key===result.attention?'rgba(245,208,96,.9)':key===result.strongest?'rgba(125,219,184,.9)':'rgba(240,237,232,.42)';return '<text x="'+lx.toFixed(1)+'" y="'+(ly+4).toFixed(1)+'" text-anchor="'+anch+'" fill="'+col+'" font-size="9" font-family="Inter,sans-serif" letter-spacing=".01em">'+rSL[key]+'</text>';}).join('');
      const radarSVG = '<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:320px;display:block;margin:0 auto">'+rGrid+rAxes+'<polygon points="'+rPts+'" fill="rgba(125,219,184,.11)" stroke="rgba(125,219,184,.45)" stroke-width="1.5"/>'+rDots+rLabels+'</svg>';
      // ── Scale bars ───────────────────────────────────────────────────────────
      const scaleCards = [...SCALE_KEYS].sort((a, b) => result.normalized[b] - result.normalized[a]).map((key, idx) => {
        const v = result.normalized[key];
        const howTo = SCALE_HOWTO[key];
        const isStrongest = key === result.strongest, isAttention = key === result.attention;
        const tag = isAttention ? '<span style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--yellow);background:rgba(245,208,96,.12);padding:2px 7px;border-radius:99px;margin-left:8px">зона внимания</span>' : isStrongest ? '<span style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--mint);background:rgba(125,219,184,.12);padding:2px 7px;border-radius:99px;margin-left:8px">сильная</span>' : '';
        const barCol = isAttention ? 'var(--yellow)' : isStrongest ? 'var(--mint)' : idx < 3 ? 'var(--accent)' : 'rgba(240,237,232,.2)';
        const icon = SCALE_ICONS[key] || '';
        const level = v >= 70 ? 'high' : v >= 50 ? 'mid' : 'low';
        const zoneText = v >= 70 ? 'развита' : v >= 50 ? 'умеренная' : 'зона роста';
        const zoneBg = v >= 70 ? 'rgba(125,219,184,.13)' : v >= 50 ? 'rgba(82,127,240,.13)' : 'rgba(245,208,96,.13)';
        const zoneCol = v >= 70 ? 'var(--mint)' : v >= 50 ? 'var(--blue)' : 'var(--yellow)';
        const zoneLabel = '<span class="sbar-zone" style="background:' + zoneBg + ';color:' + zoneCol + '">' + zoneText + '</span>';
        const levelText = (SCALE_LEVEL_TEXTS[key] || {})[level] || '';
        const art = LEARNING_MATERIALS.find(item => item.scaleKeys?.includes(key));
        const artHtml = art
          ? '<div class="sbar-inline-art"><p class="art-meta">' + escapeHtml(art.format) + (art.author ? ' · ' + escapeHtml(art.author) : '') + '</p><h4>' + escapeHtml(art.title) + '</h4><p>' + escapeHtml(art.why) + '</p>' + (art.href ? '<a class="pill" href="' + escapeHtml(art.href) + '" target="_blank" rel="noreferrer" style="font-size:11px">Открыть →</a>' : '') + '</div>'
          : '';
        return '<div class="sbar-item">'
          + '<div class="sbar-head"><div style="display:flex;align-items:center;gap:6px;flex:1;flex-wrap:wrap">' + icon + '<span class="sbar-title">' + SCALE_TITLES[key] + '</span>' + tag + '</div>'
          + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px"><span class="sbar-num" style="color:' + barCol + '">' + v + '</span>' + zoneLabel + '</div></div>'
          + '<div class="sbar-track"><div class="sbar-fill" style="width:' + v + '%;background:' + barCol + '"></div></div>'
          + (levelText ? '<p class="sbar-level-text">' + escapeHtml(levelText) + '</p>' : '')
          + '<p class="fine" style="margin:0 0 0;color:rgba(240,237,232,.3);font-size:12px">' + escapeHtml(SCALE_DESCRIPTIONS[key]) + '</p>'
          + '<div class="sbar-tip"><p class="sbar-tip-label">попробуйте</p><p>' + escapeHtml(howTo.text) + '</p></div>'
          + artHtml
          + '</div>';
      }).join('');
      const strategyBlock = '<div class="strategy-block">'
        + '<p class="kicker" style="color:var(--pink);margin-bottom:14px">стратегия родителя</p>'
        + '<h2 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:clamp(22px,2.4vw,30px);font-weight:400;margin:0 0 16px;line-height:1.2">Ваш паттерн под давлением</h2>'
        + '<p class="strategy-pattern">' + escapeHtml(pressurePattern(result.normalized)) + '</p>'
        + '<p class="strategy-pattern">' + escapeHtml(twistPattern(result.normalized)) + '</p>'
        + '<div class="strategy-cols">'
        + '<div class="strategy-col"><span class="strategy-col-label" style="color:var(--mint)">плюсы</span><p>' + escapeHtml(STRENGTH_DESCRIPTIONS[result.strongest]) + ' ' + escapeHtml(STRENGTH_DESCRIPTIONS[result.second]) + '</p></div>'
        + '<div class="strategy-col"><span class="strategy-col-label" style="color:var(--yellow)">зона роста</span><p>' + escapeHtml(ATTENTION_DESCRIPTIONS[result.attention]) + '</p></div>'
        + '</div></div>';
      return '<div class="result-top">'
        + '<div class="result-radar-col"><div class="result-radar-wrap">' + radarSVG + '</div>'
        + '<p class="fine" style="text-align:center;margin-top:10px;color:rgba(240,237,232,.28);letter-spacing:.06em;text-transform:uppercase;font-size:10px">карта реакций</p></div>'
        + '<div class="result-insights">'
        + '<p class="fine" style="color:var(--muted);margin-bottom:16px;font-size:11px;letter-spacing:.1em;text-transform:uppercase">' + (demo ? 'демо · результат' : 'ваш результат') + '</p>'
        + '<p class="verdict-line">Ваша сила — <strong>' + STRENGTH_TITLES[result.strongest].toLowerCase() + '</strong>. Точка роста — ' + ATTENTION_TITLES[result.attention].toLowerCase() + '.</p>'
        + '<div class="ri-item ri-strong"><p class="ri-label" style="color:var(--mint)">что делаете первым</p><h3>' + STRENGTH_TITLES[result.strongest] + '</h3><p class="ri-text">' + escapeHtml(STRENGTH_DESCRIPTIONS[result.strongest]) + '</p></div>'
        + '<div class="ri-item ri-second"><p class="ri-label" style="color:var(--blue)">вторая опора</p><h3>' + STRENGTH_TITLES[result.second] + '</h3><p class="ri-text">' + escapeHtml(STRENGTH_DESCRIPTIONS[result.second]) + '</p></div>'
        + '<div class="ri-item ri-attention"><p class="ri-label" style="color:var(--yellow)">зона внимания</p><h3>' + ATTENTION_TITLES[result.attention] + '</h3><p class="ri-text">' + escapeHtml(ATTENTION_DESCRIPTIONS[result.attention]) + '</p></div>'
        + '<div class="actions" style="margin-top:28px"><button class="button secondary" data-start>Пройти заново</button><a class="pill" href="#test" data-link>К тесту</a></div>'
        + '</div></div>'
        + strategyBlock
        + '<div class="result-scales-wrap"><p class="kicker" style="margin-bottom:8px;color:var(--muted)">расшифровка по шкалам</p><p style="font-size:13px;color:rgba(240,237,232,.35);margin:0 0 24px;line-height:1.5">Рядом с каждым числом — пометка: <span style="color:var(--mint)">развита</span> (70+), <span style="color:var(--blue)">умеренная</span> (50–69) или <span style="color:var(--yellow)">зона роста</span> (&lt;50). И статья, если есть.</p><div class="result-scales">' + scaleCards + '</div></div>'
        + '<section class="card" style="margin-top:32px"><p class="kicker" style="color:var(--yellow)">что делать дальше</p><h2>Три коротких шага после результата</h2><div class="rows"><div class="row"><h3>1. Сразу — возьмите фразу для разговора</h3><p>Она нужна не для идеального воспитания, а чтобы выиграть паузу между автоматической реакцией и следующим действием.</p></div><div class="row"><h3>2. На неделю — один маленький эксперимент</h3><p>При следующем «не хочу» сначала спросите себя: <strong>' + escapeHtml(experiment.title) + '</strong></p><p class="fine">' + escapeHtml(experiment.text) + '</p></div><div class="row"><h3>3. Развивать через практику</h3><p>Материалы к каждой шкале — прямо в расшифровке выше.</p></div></div><p class="fine">Эти шаги — общие практические подсказки, а не индивидуальные рекомендации.</p></section>'
        + '<details class="card"><summary><h2>Фразы для разговора</h2></summary><p>«Я вижу, что ты сейчас не хочешь. Давай разберемся почему, но договоренность сама по себе не исчезает».</p><p>«Сначала проверим, что произошло, а потом выберем решение, которое не бросает ни тебя, ни правило».</p></details>'
        + '<details class="card" style="border-color:var(--mint);background:var(--bg)"><summary><h2>Ограничение результата</h2></summary><p>Этот результат отражает ваши решения в шести смоделированных ситуациях. В реальной жизни поведение зависит от возраста ребенка, контекста, усталости, отношений и многих других факторов. Используйте разбор как материал для наблюдения, а не как окончательный вывод о себе.</p></details>'
        + (demo ? '' : '<section class="card" id="feedback-block"><p class="kicker" style="color:var(--mint)">помогите тесту стать точнее</p><h2>Похож ли этот портрет на вас?</h2><div class="rows"><div class="row" data-feedback-form><div class="actions"><button class="button" data-feedback="yes">Да, похож</button><button class="button" data-feedback="partly">Скорее да</button><button class="button" data-feedback="no">Нет, не похож</button></div><textarea data-feedback-text rows="3" placeholder="Что не совпало или что хотелось бы добавить? (необязательно)" style="width:100%;margin-top:12px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:12px;font-family:inherit"></textarea><div class="actions" style="margin-top:12px"><button class="button" data-feedback-send>Отправить отзыв</button></div></div></div></section>')
        + '<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin-top:0"><div><p style="margin:0 0 4px;font-size:15px;font-weight:500;color:var(--text)">Остались вопросы или что-то не сработало?</p><p class="fine" style="margin:0">Напишите — разберёмся.</p></div><a class="button secondary" href="mailto:galya.chooru@gmail.com" style="flex-shrink:0">Связаться с разработчиком</a></div>';
    }


    function methodologyPage() {
      const stages = [
        ["1", "Кейс", "Ситуация похожа на реальную семейную развилку, где нет одного идеального ответа."],
        ["2", "Выбор действия", "Показывает первую стратегию: настоять, поддержать, передать выбор, проверить среду."],
        ["3", "Вынужденный приоритет", "Помогает увидеть, какая ценность становится главной, когда нельзя выбрать все."],
        ["4", "Открытая реплика", "Показывает, как намерение звучит для ребенка в конкретных словах."],
        ["5", "Поворот", "Проверяет, меняется ли решение при новой существенной информации."]
      ];
      const descriptions = SCALE_DESCRIPTIONS;
      const foundations = ${JSON.stringify(scientificFoundations)};
      const questionRows = REACTION_QUESTIONS.map(item => '<article class="row"><p class="fine">вопрос ' + item.number + ' · ' + SCALE_TITLES[item.scaleKey] + '</p><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.text) + '</p><p class="fine">' + escapeHtml(item.sourceHint) + '</p></article>').join("");
      return '<section id="methodology" class="article"><section class="article-hero"><p class="kicker">методика</p><h1>Как мы превращаем шесть ситуаций в профиль решений</h1><p class="lead" style="margin-left:0;text-align:left">Это экспериментальный кейс-тест: он помогает увидеть паттерны, но не ставит диагнозы и не делает окончательных выводов о человеке.</p></section><details class="card"><summary><h2>Почему прямых вопросов недостаточно</h2></summary><p>На прямой вопрос легко ответить правильно и красиво. В кейсе приходится выбирать между ценностями, которые одновременно важны: контакт, граница, безопасность, дисциплина и самостоятельность.</p></details><details class="card"><summary><h2>Из чего состоит один кейс</h2></summary><div class="rows">' + stages.map(item => '<div class="row stage"><span class="num">' + item[0] + '</span><h3>' + item[1] + '</h3><p>' + item[2] + '</p></div>').join("") + '</div></details><details class="card"><summary><h2>Что анализируется</h2></summary><p>Закрытые ответы считаются по фиксированной системе весов. Открытые ответы анализируются по признакам: признание состояния ребенка, ясность границы, поддержка самостоятельности, угрозы/унижение/спасательство, конкретность дальнейших действий. Итоговый профиль собирается из обоих источников.</p><p>Если внешний ИИ-анализ недоступен или API-ключ не настроен, открытые ответы разбирает локальный fallback-анализатор по прозрачным правилам и ключевым признакам. Он помогает не терять результат, но может быть менее точным, чем экспертная или расширенная ИИ-разметка.</p></details><details class="card"><summary><p class="kicker" style="color:var(--yellow)">практический фреймворк</p><h2>Пять вопросов перед реакцией</h2></summary><p>Эти вопросы соединяют методику с практикой: каждый вопрос связан с одной из шкал и помогает замедлить автоматическую реакцию на детское «не хочу».</p><div class="rows">' + questionRows + '</div></details><section class="card"><h2>Семь шкал: что они измеряют</h2><div class="rows">' + SCALE_KEYS.map(key => '<div class="row"><h3>' + (SCALE_ICONS[key] || '') + ' ' + SCALE_TITLES[key] + '</h3><p>' + descriptions[key] + '</p><p class="fine"><strong>Близкий академический конструкт:</strong> ' + SCALE_ACADEMIC_BASIS[key] + '</p></div>').join("") + '</div></section><details class="card"><summary><p class="kicker" style="color:var(--mint)">теоретическая рамка</p><h2>На чем базируются шкалы</h2></summary><p>Это не копия одной психологической методики и не валидированный опросник. Мы собрали рабочую модель из нескольких признанных рамок развития и воспитания, чтобы описывать не «тип родителя», а способ принятия решений в конфликтной ситуации.</p><div class="rows">' + foundations.map(item => '<article class="row"><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.description) + '</p><a class="pill" href="' + escapeHtml(item.href) + '" target="_blank" rel="noreferrer">источник</a></article>').join("") + '</div></details><details class="card" style="border-color:var(--mint);background:var(--bg)"><summary><h2>Что этот тест не делает</h2></summary><p>Инструмент не является клинической диагностикой, не измеряет личность родителя и не предназначен для постановки психологических заключений. Это рефлексивный ситуационный тренажер, опирающийся на эмпирически изученные конструкты родительского поведения (см. таблицу выше). Результаты показывают вероятные паттерны ответа в предложенных ситуациях, а не стабильные характеристики личности.</p></details><details class="card"><summary><h2>Откуда взялись семь шкал</h2></summary><p>Каждая шкала описывает отдельное напряжение, которое регулярно возникает в родительских решениях: кто несет взрослую ответственность, где нужен контакт, какая граница остается, сколько самостоятельности посильно ребенку, как выдерживается конфликт, меняется ли решение при новых фактах и отличаем ли мы трудность от небезопасности.</p><p>Веса вариантов заданы экспертно и будут пересматриваться после пилота: мы будем сравнивать автоматические профили с обратной связью пользователей и разметкой специалистов с психологическим образованием.</p><p>Сейчас в основе теста — 6 ситуаций и около 18–20 весовых решений, которые распределены по 7 шкалам. Это пилотный объем: на каждую шкалу приходится всего несколько решений, поэтому близкие баллы по разным шкалам не стоит читать как точную разницу — это, скорее, направление и повод присмотреться, а не строгое измерение. Расширение числа ситуаций — одна из задач после пилота.</p></details><details class="card"><summary><h2>Как проходит верификация</h2></summary><p>Мы сравниваем три слоя: автоматический результат, обратную связь пользователя после результата и независимую экспертную разметку специалистов с психологическим образованием. Главный вопрос апробации: совпадает ли профиль с тем, что видит пользователь и что отмечает эксперт по рубрике.</p></details><details class="card" style="border-color:var(--mint);background:var(--bg)"><summary><h2>Почему это пока не валидированный тест</h2></summary><p>Сейчас корректнее называть этот инструмент экспериментальным кейс-тестом или тренажером родительской рефлексии. Чтобы методика могла называться валидированным психологическим тестом, необходимы отдельные исследования надежности, валидности и нормативных показателей. Эта работа еще не завершена.</p><p>Отсутствие завершенной валидации не делает ответы бессмысленными. Кейсы помогают замедлить автоматическую реакцию, заметить свои приоритеты и увидеть расхождение между намерением и конкретными словами. Однако такие наблюдения следует воспринимать как гипотезы для размышления, а не как доказанные характеристики личности.</p></details></section>';
    }

    function aboutPage() {
      const galinaFacts = [
        "вундеркинд: закончила школу в 12 лет, 5 классов прошла за 1 год",
        "высшее психологическое образование получила в 18 лет",
        "сооснователь и COO Intelligent University",
        "психологическое образование, аспирантура по педагогике и психологии профобразования",
        "15+ лет в обучении, корпоративных университетах, EdTech и дизайн-мышлении",
        "организатор международных инженерных и дизайн-мышление соревнований для детей с 30 000+ участников"
      ];
      const ludmilaFacts = [
        "кандидат психологических наук, организационная психология МГУ",
        "член Российского психологического общества и АППП",
        "25+ лет опыта психологической практики, коучинга, HR и организационной диагностики",
        "экспертиза в разработке развивающих программ, обратной связи и методической работе"
      ];
      return '<section id="about" class="article"><section class="article-hero"><p class="kicker">о проекте</p><h1>«Родительская позиция» — инструмент для родителей, которым нужен не ярлык, а материал для размышления.</h1><p class="lead" style="margin-left:0;text-align:left">Мы соединяем реалистичные семейные кейсы, автоматический подсчет по весам и аккуратный анализ открытых ответов, чтобы увидеть привычные сценарии решений в ситуациях детского сопротивления.</p></section><section class="author"><div class="card"><div class="portrait"><img src="/authors/galina-yanovskaya-circle.png" alt="Галина Яновская" /></div></div><div class="card"><p class="kicker" style="color:var(--pink)">автор и продюсер проекта</p><h2>Галина Яновская</h2><p>В проекте Галина отвечает за продуктовую идею, голос, сценарии кейсов, связь с родительской аудиторией и превращение методики в понятный цифровой опыт.</p><p>Важная оптика проекта — без давления на «правильного» родителя или «успешного» ребенка.</p><div class="facts">' + galinaFacts.map(fact => '<div class="fact">' + escapeHtml(fact) + '</div>').join("") + '</div><p><a class="pill" href="https://t.me/thinking_kids" target="_blank" rel="noreferrer">Telegram @thinking_kids</a></p></div></section><section class="author"><div class="card"><div class="portrait mint"><img src="/authors/ludmila-ekhardt-circle.png" alt="Людмила Экхардт" /></div></div><div class="card"><p class="kicker" style="color:var(--mint)">научно-методический эксперт</p><h2>Людмила Экхардт</h2><p>Людмила помогает проверять психологическую корректность рубрик, формулировок, ограничений методики и логики интерпретации ответов.</p><p>Ее экспертиза важна для того, чтобы результат оставался рефлексивным инструментом, а не превращался в диагноз или оценку родителя.</p><div class="facts">' + ludmilaFacts.map(fact => '<div class="fact">' + escapeHtml(fact) + '</div>').join("") + '</div></div></section></section>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }

    function render() {
      const path = window.location.pathname;
      document.getElementById("app").innerHTML = home();
  const hash = window.location.hash || (path.startsWith("/methodology") ? "#methodology" : path.startsWith("/about") ? "#about" : (path.startsWith("/test") || path.startsWith("/result") || path.startsWith("/demo-result")) ? "#test" : "");
  if (hash) {
    const target = document.querySelector(hash);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
      document.querySelectorAll(".nav a[data-link]").forEach(link => {
        const href = link.getAttribute("href");
        const isActive = href === "/" ? path === "/" : path.startsWith(href);
        link.classList.toggle("active", isActive);
      });
      document.querySelectorAll("[data-link]").forEach(link => link.addEventListener("click", event => {
        event.preventDefault();
        navigate(link.getAttribute("href"));
      }));
      document.querySelectorAll("[data-start]").forEach(button => button.addEventListener("click", start));
      document.querySelectorAll("[data-option]").forEach(button => button.addEventListener("click", () => {
        setAnswer(button.dataset.option);
        render();
      }));
      const open = document.querySelector("[data-open]");
      if (open) open.addEventListener("input", event => setAnswer(event.target.value));
      const back = document.querySelector("[data-back]");
      if (back) back.addEventListener("click", () => {
        if (state.index > 0) state.index -= 1;
        saveState();
        render();
      });
      const nextButton = document.querySelector("[data-next]");
      if (nextButton) nextButton.addEventListener("click", next);

      const feedbackForm = document.querySelector("[data-feedback-form]");
      if (feedbackForm) {
        let rating = null;
        feedbackForm.querySelectorAll("[data-feedback]").forEach(btn => btn.addEventListener("click", () => {
          rating = btn.dataset.feedback;
          feedbackForm.querySelectorAll("[data-feedback]").forEach(b => b.classList.toggle("active", b === btn));
        }));
        const sendBtn = feedbackForm.querySelector("[data-feedback-send]");
        sendBtn.addEventListener("click", () => {
          const text = feedbackForm.querySelector("[data-feedback-text]").value;
          const result = JSON.parse(localStorage.getItem(RESULT_KEY) || "null");
          fetch("/api/submit-result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "feedback", result, rating, comment: text })
          }).then(() => {
            const block = document.getElementById("feedback-block");
            if (block) block.innerHTML = '<p class="kicker" style="color:var(--mint);margin-bottom:12px">спасибо</p><h2 style="margin:0 0 8px">Отзыв отправлен</h2><p style="color:var(--muted);font-size:14px;margin:0">Это помогает сделать тест точнее. Если хотите добавить что-то — напишите на <a href="mailto:galya.chooru@gmail.com" style="color:var(--text)">galya.chooru@gmail.com</a>.</p>';
          });
        });
      }
    }

    render();

    // ── Custom cursor ──────────────────────────────────────
    const cur = document.getElementById("cursor");
    const curDot = document.getElementById("cursor-dot");
    if (cur && window.matchMedia("(hover:hover)").matches) {
      let mx = 0, my = 0, cx = 0, cy = 0;
      document.addEventListener("mousemove", e => { mx = e.clientX; my = e.clientY; });
      (function loop() {
        cx += (mx - cx) * 0.12;
        cy += (my - cy) * 0.12;
        cur.style.left = cx + "px";
        cur.style.top = cy + "px";
        if (curDot) { curDot.style.left = mx + "px"; curDot.style.top = my + "px"; }
        requestAnimationFrame(loop);
      })();
      document.addEventListener("mouseover", e => {
        const t = e.target.closest("a,button,.option,.testimonial,.value-item");
        if (t) cur.classList.add("hover"); else cur.classList.remove("hover");
      });
    }

    // ── Scroll progress bar ────────────────────────────────
    const prog = document.getElementById("scroll-progress");
    if (prog) {
      window.addEventListener("scroll", () => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.width = (h > 0 ? (window.scrollY / h * 100) : 0) + "%";
      }, { passive: true });
    }

    // ── Scroll reveal (IntersectionObserver) ───────────────
    function initReveal() {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      document.querySelectorAll(".reveal, .fade-up, .stagger").forEach(el => io.observe(el));
    }
    initReveal();

    // ── Live clock ─────────────────────────────────────────
    function updateClock() {
      const el = document.getElementById("hclock");
      if (!el) return;
      const t = new Date().toLocaleTimeString("ru-RU", {timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit"});
      el.textContent = "МСК " + t;
    }
    setInterval(updateClock, 10000);
  </script>
</body>
</html>`;
}

const resultsLogPath = path.join(root, "data", "results.jsonl");

const server = http.createServer((req, res) => {
  if ((req.url.startsWith("/authors/") || req.url === "/favicon.svg" || req.url === "/favicon.ico") && serveAsset(req, res)) return;
  if (req.method === "POST" && req.url === "/api/submit-result") {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 200000) req.destroy(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const entry = { receivedAt: new Date().toISOString(), ...payload };
        fs.mkdirSync(path.dirname(resultsLogPath), { recursive: true });
        fs.appendFileSync(resultsLogPath, JSON.stringify(entry) + "\n", "utf-8");
        // Async write to Google Sheets (don't block response)
        if (entry.type === "result") {
        const r = entry.result || {};
        const n = r.normalized || {};
        const row = [
          new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
          r.strongest || "", r.second || "", r.attention || "",
          n.adultResponsibility || "", n.emotionalContact || "", n.boundariesConsistency || "",
          n.autonomySupport || "", n.conflictTolerance || "", n.flexibility || "",
          n.difficultyVsUnsafety || ""
        ];
        appendToSheet(row).catch(e => console.error("Sheets error:", e.message));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html());
});

server.listen(port, () => {
  console.log(`Recovery server ready: http://localhost:${port}`);
});
