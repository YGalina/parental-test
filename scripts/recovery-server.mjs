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

async function analyzeWithGemini(textAnswers) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || textAnswers.length === 0) return null;

  const prompt = `Ты — психолог-методолог, анализирующий родительскую коммуникацию.
Тебе даны дословные реплики, которые родитель написал бы ребёнку в трёх сложных ситуациях.

Реплики:
${textAnswers.map((t, i) => `${i + 1}. "${t}"`).join("\n")}

Напиши краткий анализ (3–4 предложения) в тёплом, но точном тоне.
Отметь: какой тон преобладает (объяснение, признание чувств, директива, вопрос, поддержка)?
Что ребёнок скорее всего услышит в этих словах?
Одна конкретная рекомендация — что можно попробовать добавить или изменить.
Пиши на русском, без заголовков, сплошным текстом.`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { console.error("Gemini: no text in response", JSON.stringify(json)); return null; }
    console.log("Gemini: analysis complete");
    return text.trim();
  } catch (e) {
    console.error("Gemini error:", e.message);
    return null;
  }
}

async function appendToSheet(row) {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) {
    console.error("Sheets: missing env vars — email:", !!email, "key:", !!key, "sheetId:", !!sheetId);
    return;
  }
  console.log("Sheets: starting append, sheetId=", sheetId);

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
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    console.error("Sheets: failed to get token:", JSON.stringify(tokenJson));
    return;
  }
  console.log("Sheets: got token, appending row...");

  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`, {
    method: "POST", headers: { Authorization: `Bearer ${tokenJson.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] })
  });
  const appendJson = await appendRes.json();
  if (!appendRes.ok) {
    console.error("Sheets: append failed:", JSON.stringify(appendJson));
  } else {
    console.log("Sheets: row appended successfully");
  }
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

const archetypes = {
  director: {
    id: 'director',
    name: 'Дирижёр',
    image: '/archetype-director.png',
    tagline: 'Работающая мама, которая всегда в образе',
    relief: 'Если вы Дирижёр — перестаньте мучить себя за то, что вы не умеете "просто побыть с ребёнком без цели". Ваша система работает. Ребёнок в безопасности, всё спланировано. Вам не нужен другой характер. Вам нужно добавить 5 минут в день, когда вы не организуете — просто присутствуете. Без повестки.',
    strength: 'Вы создаёте предсказуемость и структуру. Ребёнок знает, что будет дальше — это и есть безопасность.',
    growth: 'Эмоциональное присутствие без задачи.',
  },
  anchor: {
    id: 'anchor',
    name: 'Опора',
    image: '/archetype-anchor.png',
    tagline: 'Домохозяйка, которая тащит всё на себе',
    relief: 'Если вы Опора — не корите себя за то, что не успеваете на себя. Вы держите семью. Это огромная работа, которую никто не видит. Но вот что важно: когда вы на последнем ресурсе — ребёнок это чувствует. Ваша задача не стать другой — научиться говорить вслух "мне сейчас нужна пауза" раньше, чем взорвётесь.',
    strength: 'Вы держите структуру и берёте ответственность — в семье есть надёжность.',
    growth: 'Разрешить себе не быть опорой 24/7.',
  },
  mentor: {
    id: 'mentor',
    name: 'Наставник',
    image: '/archetype-mentor.png',
    tagline: 'Родитель, который хочет вырастить хорошего человека',
    relief: 'Если вы Наставник — перестаньте переживать, что недостаточно "тёплый". Вы даёте ребёнку то, что даст ему жизнь — опыт справляться самому. Это ценнее объятий в моменте. Вам не нужно становиться другим. Нужно научить ребёнка чувствовать, что вы рядом — даже когда не вмешиваетесь.',
    strength: 'Вы видите ресурс в трудностях и не спасаете там, где ребёнок может справиться сам.',
    growth: 'Эмоциональный контакт — не урок, а просто быть рядом.',
  },
  guardian: {
    id: 'guardian',
    name: 'Защитник',
    image: '/archetype-guardian.png',
    tagline: 'Мама, которая слишком сильно любит',
    relief: 'Если вы Защитник — ваша любовь огромная, и это не проблема. Проблема в одном: тревога иногда выдаётся ребёнку за заботу, и он это считывает. Как только вы научитесь различать "мне страшно" и "ему реально опасно" — ваши отношения изменятся быстрее, чем вы думаете.',
    strength: 'Вы глубоко чувствуете ребёнка и готовы дать ему всё.',
    growth: 'Доверять ребёнку право на собственный опыт — даже болезненный.',
  },
  partner: {
    id: 'partner',
    name: 'Партнёр',
    image: '/archetype-partner.png',
    tagline: 'Взрослый, который сам ещё не до конца вырос',
    relief: 'Если вы Партнёр — не ругайте себя за мягкость. Ваш контакт с ребёнком — это то, через что работают все важные разговоры. Именно вам ребёнок придёт в 15 лет с настоящей проблемой. Вам не нужен другой характер. Нужна одна граница, которую вы держите молча — без объяснений и переговоров.',
    strength: 'Вы в контакте с ребёнком. Ему с вами безопасно и тепло.',
    growth: 'Быть взрослым в отношениях — удерживать границу, даже когда это некомфортно.',
  },
  peacemaker: {
    id: 'peacemaker',
    name: 'Миротворец',
    image: '/archetype-peacemaker.png',
    tagline: 'Родитель, для которого ссора — невыносима',
    relief: 'Если вы Миротворец — вы не слабый и не "без характера". У вас огромная чувствительность: вы первым замечаете, когда ребёнку плохо, и не можете оставить его в этом. Но есть ловушка: когда вы уступаете, чтобы прекратить конфликт, ребёнок учится, что давление работает. Вам не нужно становиться жёстким. Нужна одна вещь — досидеть в его недовольстве на 30 секунд дольше, чем хочется. Граница не разрушает контакт. Её отсутствие — разрушает.',
    strength: 'Вы тонко чувствуете состояние ребёнка и цените тёплые отношения выше победы в споре.',
    growth: 'Выдерживать недовольство ребёнка, не отменяя договорённость ради тишины.',
  },
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
  const type = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".svg" ? "image/svg+xml" : "application/octet-stream";
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
  <title>Какой я родитель — тест на родительский архетип</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230C0906'/%3E%3Ccircle cx='22' cy='16' r='7' fill='%23f03eb2'/%3E%3Cpath d='M8 46c0-8 6-14 14-14s14 6 14 14' fill='%23f03eb2'/%3E%3Ccircle cx='45' cy='22' r='5' fill='%237DDBB8'/%3E%3Cpath d='M34 46c0-6 5-10 11-10s11 4 11 10' fill='%237DDBB8'/%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
  <style>
    :root {
      --bg: #0e0c18;
      --bg2: #13111f;
      --card-dark: #1e1b2e;
      --card-light: #f2f1f8;
      --text: #f0edf8;
      --muted: rgba(240,237,248,.50);
      --text-dark: #1a1830;
      --text-dark-muted: rgba(26,24,48,.55);
      --line: rgba(255,255,255,.07);
      --line-light: rgba(26,24,48,.10);
      --indigo: #6366f1;
      --indigo-light: #818cf8;
      --coral: #fb7185;
      --pink: #fb7185;
      --mint: #818cf8;
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
      -webkit-font-smoothing: antialiased;
    }
    ::selection { background: rgba(99,102,241,0.35); color: #fff; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    a { color: inherit; text-decoration: none; }

    /* ── Slider (archetypes) ─────────────────────────── */
    .kjr-slider::-webkit-scrollbar { height: 0; }
    .kjr-slider { scrollbar-width: none; }

    /* ── Floating card scroll-reveal ─────────────────── */
    .kjr-rc { opacity: 0; }

    /* ── New page sections ───────────────────────────── */
    .kjr-author { display: grid; grid-template-columns: 160px 1fr; gap: clamp(20px,4vw,36px); align-items: center; }

    /* ── Layout ────────────────────────────────────────── */
    .wrap { width: min(1240px, calc(100% - 48px)); margin: 0 auto; }

    /* ── New Nav ────────────────────────────────────────── */
    .kjr-nav {
      position: sticky; top: 0; z-index: 50;
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px clamp(16px,4vw,40px);
      background: rgba(14,12,24,0.85);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .kjr-brand { display: flex; flex-direction: column; line-height: 1.1; }
    .kjr-brand span { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
    .kjr-brand small { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .kjr-navlinks { display: flex; align-items: center; gap: 28px; }
    .kjr-navlinks a { font-size: 13px; font-weight: 500; color: rgba(240,237,248,0.70); transition: color .2s; }
    .kjr-navlinks a:hover { color: var(--text); }
    .kjr-btn {
      font-size: 13px; font-weight: 700;
      background: var(--indigo); color: #fff;
      padding: 9px 20px; border-radius: 10px;
      border: none; cursor: pointer; font-family: inherit;
      transition: background .2s, transform .15s;
    }
    .kjr-btn:hover { background: var(--indigo-light); transform: translateY(-1px); }

    /* ── Floating cards ─────────────────────────────────── */
    .kjr-card { margin: 0 24px 24px; border-radius: 30px; }
    .kjr-card-light { background: var(--card-light); color: var(--text-dark); }
    .kjr-card-dark { background: var(--card-dark); border: 1px solid var(--line); }
    .kjr-card-gradient { background: linear-gradient(135deg, #1a1830 0%, #0e1225 50%, #111827 100%); border: 1px solid var(--line); overflow: hidden; position: relative; }
    .kjr-card-pad { padding: clamp(32px,5vw,56px) clamp(20px,4vw,40px); }

    /* ── Buttons ────────────────────────────────────────── */
    .button {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--indigo); color: #fff;
      font-weight: 700; font-size: 15px; font-family: inherit;
      border: none; border-radius: 12px; padding: 14px 28px;
      box-shadow: 0 0 32px rgba(99,102,241,0.35);
      cursor: pointer;
      transition: background .2s, transform .2s, box-shadow .2s;
    }
    .button:hover { background: var(--indigo-light); transform: translateY(-2px); box-shadow: 0 8px 40px rgba(99,102,241,0.50); }
    .button.secondary {
      background: transparent; color: var(--text);
      border: 1px solid var(--line); box-shadow: none;
    }
    .button.secondary:hover { background: rgba(255,255,255,0.06); transform: none; }

    /* ── Kicker ─────────────────────────────────────────── */
    .kicker {
      font-weight: 700; font-size: 11px;
      letter-spacing: 0.15em; text-transform: uppercase;
      color: var(--indigo);
    }
    .kicker-coral { color: var(--coral); }
    .kicker-light { color: var(--indigo-light); }

    /* ── Divider ─────────────────────────────────────────── */
    .divider { border: none; border-top: 1px solid var(--line); margin: 0; }

    /* ── Sections (old test/result sections) ────────────── */
    .section { padding: 60px clamp(20px,5vw,56px); }
    .section-inner { max-width: 1000px; margin: 0 auto; }
    .section-header { margin-bottom: 40px; }

    /* ── Responsive ─────────────────────────────────────── */
    @media (max-width: 1024px) {
      .kjr-bento { grid-template-columns: 1fr !important; }
      .kjr-bento-wide { grid-column: auto !important; }
    }
    @media (max-width: 768px) {
      .kjr-card { margin-left: 12px !important; margin-right: 12px !important; }
      .kjr-test-grid { grid-template-columns: 1fr !important; }
      .kjr-test-sidebar { display: none !important; }
      .kjr-sidebar { display: none !important; }
      .kjr-reviews { grid-template-columns: 1fr !important; }
      .kjr-navlinks { display: none !important; }
      .kjr-author { grid-template-columns: 1fr !important; text-align:center; justify-items:center; }
      .kjr-arch-block { grid-template-columns: 1fr !important; }
      .kjr-arch-block > div:first-child { width: 140px !important; height: 140px !important; aspect-ratio: auto !important; border-radius: 99px !important; margin: 0 auto; }
      .kjr-radar-block { grid-template-columns: 1fr !important; }
      .kjr-scales-grid { grid-template-columns: 1fr !important; }
      .kjr-tg-gate { padding: 28px 20px !important; }
      .kjr-tg-gate h2 { font-size: 22px !important; }
    }

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
    .archetype-hero { display: grid; grid-template-columns: 280px 1fr; gap: 40px; align-items: center; margin-bottom: 48px; background: var(--panel); border: 1px solid var(--line); border-radius: 24px; overflow: hidden; }
    .archetype-img-wrap { background: rgba(240,237,232,.04); display: flex; align-items: flex-end; justify-content: center; min-height: 320px; padding-top: 20px; }
    .archetype-img { width: 100%; max-width: 260px; display: block; object-fit: contain; }
    .archetype-hero-text { padding: 36px 36px 36px 0; }
    .archetype-name { font-size: clamp(36px,4vw,52px); font-weight: 300; margin: 0 0 8px; line-height: 1.1; }
    .archetype-tagline { font-size: 14px; color: var(--muted); margin: 0 0 20px; letter-spacing: .02em; }
    .archetype-relief { font-size: 15px; line-height: 1.7; color: var(--text); background: rgba(240,237,232,.05); border-radius: 14px; padding: 16px 18px; margin-bottom: 20px; border-left: 2px solid var(--pink); }
    .archetype-meta { display: flex; flex-direction: column; gap: 10px; }
    .archetype-meta-item { display: flex; gap: 10px; font-size: 14px; line-height: 1.5; }
    .archetype-meta-label { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; font-weight: 600; white-space: nowrap; padding-top: 2px; min-width: 70px; }
    @media (max-width: 700px) { .archetype-hero { grid-template-columns: 1fr; } .archetype-img-wrap { min-height: 240px; } .archetype-hero-text { padding: 24px; } }
    .archetype2-block { display: grid; grid-template-columns: 140px 1fr; gap: 24px; align-items: center; margin-bottom: 40px; background: var(--panel); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; }
    .archetype2-img-wrap { background: rgba(240,237,232,.04); display: flex; align-items: flex-end; justify-content: center; min-height: 180px; padding-top: 12px; }
    .archetype2-img { width: 100%; max-width: 120px; display: block; object-fit: contain; }
    .archetype2-text { padding: 24px 24px 24px 0; }
    .archetype2-name { font-size: clamp(22px,2.5vw,30px); font-weight: 300; margin: 0 0 6px; }
    @media (max-width: 600px) { .archetype2-block { grid-template-columns: 100px 1fr; } .archetype2-text { padding: 16px 16px 16px 0; } }
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
    .pgroup { margin-bottom: 22px; }
    .plabel { font-size: 13px; color: var(--muted); margin-bottom: 10px; letter-spacing: .02em; }
    .pchips { display: flex; flex-wrap: wrap; gap: 8px; }
    .pchip { border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 99px; padding: 9px 16px; font-size: 14px; cursor: pointer; font-family: inherit; transition: all .2s; }
    .pchip:hover { border-color: rgba(240,237,232,.3); color: var(--text); }
    .pchip.sel { border-color: var(--pink); color: var(--text); background: rgba(255,45,138,.1); }
    .page-input { border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: 12px; padding: 10px 14px; font: inherit; }
    .page-input:focus { outline: none; border-color: rgba(240,237,232,.3); }
    .archetype-showcase { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 0 clamp(20px,5vw,80px); max-width: 1180px; margin: 0 auto; }
    .arch-card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 12px; text-align: center; transition: border-color .25s, transform .25s; }
    .arch-card:hover { border-color: rgba(240,237,232,.28); transform: translateY(-3px); }
    .kjr-arch-slide:hover { transform: translateY(-6px); box-shadow: 0 14px 40px rgba(99,102,241,0.20); }
    .kjr-cta-link:hover { transform: translateY(-2px); box-shadow: 0 8px 40px rgba(99,102,241,0.55) !important; }
    .arch-card-img { background: #fff; border-radius: 10px; margin-bottom: 10px; height: 200px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .arch-card-img img { height: 100%; width: auto; max-width: 100%; object-fit: contain; display: block; }
    .arch-card h3 { font-size: 17px; font-weight: 400; margin: 0 0 3px; }
    .arch-card p { font-size: 12px; color: var(--muted); line-height: 1.35; margin: 0; }
    @media (max-width: 760px) { .archetype-showcase { grid-template-columns: 1fr 1fr; } .arch-card-img { height: 170px; } }
    @media (max-width: 460px) { .archetype-showcase { grid-template-columns: 1fr 1fr; gap: 10px; } }
    textarea { width: 100%; min-height: 140px; resize: vertical; border: 1px solid var(--line); border-radius: 14px; background: transparent; color: var(--text); padding: 16px 20px; font: inherit; line-height: 1.6; transition: border-color .2s; }
    textarea:focus { outline: none; border-color: rgba(240,237,232,.3); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
    .error { color: var(--red); min-height: 20px; font-size: 14px; }
    .bars { display: grid; gap: 16px; margin-top: 20px; }
    .bar-row { display: grid; gap: 8px; }
    .bar-line { height: 3px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .bar-line span { display: block; height: 100%; width: var(--w); background: var(--pink); border-radius: 999px; }
    .fine { color: var(--muted); font-size: 13px; line-height: 1.5; }
    #cookie-banner { position:fixed; bottom:0; left:0; right:0; z-index:999; background:rgba(20,18,24,0.97); backdrop-filter:blur(12px); border-top:1px solid var(--line); padding:16px clamp(20px,5vw,60px); display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    #cookie-banner p { font-size:13px; color:var(--muted); margin:0; line-height:1.5; max-width:680px; }
    #cookie-banner a { color:var(--pink); }
    #cookie-banner button { flex-shrink:0; background:var(--pink); color:#000; border:none; border-radius:99px; padding:10px 24px; font-size:13px; font-weight:600; cursor:pointer; }
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
  <div id="app"></div>
  <div id="cookie-banner" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:999;background:rgba(30,27,46,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,0.10);padding:16px clamp(16px,4vw,40px)"><div style="max-width:1000px;margin:0 auto;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between"><p style="font-size:13px;line-height:1.6;color:rgba(240,237,248,0.70);max-width:640px;margin:0">Мы используем cookies для улучшения работы сайта. Данные теста хранятся только в вашем браузере. <a href="/legal/cookies" id="cookie-link" style="color:#818cf8;font-weight:600">Подробнее</a></p><button id="cookie-accept" style="flex:0 0 auto;background:#6366f1;color:#fff;border:none;font-family:inherit;font-weight:700;font-size:14px;padding:10px 24px;border-radius:8px;cursor:pointer">Принять</button></div></div>
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
    const ARCHETYPES = ${JSON.stringify(archetypes)};
    function getArchetypes(n) {
      const d = k => (n[k] || 0) - 50; // deviation from neutral
      const scores = {
        director: d('adultResponsibility')*1.5 + d('boundariesConsistency')*1 + (-d('emotionalContact'))*2 + (-d('conflictTolerance'))*1,
        anchor:   d('adultResponsibility')*2   + d('boundariesConsistency')*2 + d('emotionalContact')*0.5 + (-d('flexibility'))*0.5,
        mentor:   d('autonomySupport')*2        + d('difficultyVsUnsafety')*2  + d('flexibility')*1,
        guardian: d('emotionalContact')*1.5    + d('adultResponsibility')*1    + (-d('autonomySupport'))*2 + (-d('difficultyVsUnsafety'))*1,
        partner:  d('emotionalContact')*2      + d('flexibility')*1            + (-d('adultResponsibility'))*2 + (-d('boundariesConsistency'))*1.5,
        peacemaker: (-d('conflictTolerance'))*2.5 + (-d('boundariesConsistency'))*1.5 + d('emotionalContact')*1.5 + (-d('adultResponsibility'))*0.5,
      };
      const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      const first = ranked[0], second = ranked[1];
      const gap = first[1] - second[1];
      // второй архетип показываем если отстаёт менее чем на 20 пунктов (из ~250 max)
      return { primary: first[0], secondary: (gap < 20 && second[1] > 0) ? second[0] : null };
    }
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
    const TEXT_ANALYSIS_KEY = "rp-text-analysis-v1";

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
      _navigating = true;
      history.pushState(null, "", pathname);
      render(new URL(pathname, location.href).hash);
      _navigating = false;
    }

    window.addEventListener("popstate", () => { _navigating = false; render(); });

    function shell(content) {
      return '<nav class="kjr-nav"><a class="kjr-brand" href="/" data-link><span>Какой я родитель</span><small>тест · дети 6–17 лет</small></a><div class="kjr-navlinks"><a href="/" data-link>Главная</a></div><button class="kjr-btn" onclick="navigate(\'/\')">Пройти тест →</button></nav><main style="padding-top:0">' + content + '</main><footer style="margin:0 24px;padding:32px clamp(20px,4vw,40px);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--muted)">© 2026 ООО «Интеллект Университет» · ИНН 9703019107</span><a href="/" data-link style="font-size:12px;color:var(--muted)">galya.chooru@gmail.com</a></footer>';
    }

    function legalArticle(title, eyebrow, sections) {
      return '<article class="article" style="max-width:820px;margin:0 auto;padding:40px clamp(20px,5vw,60px) 80px"><p class="kicker" style="color:var(--muted)">' + eyebrow + '</p><h1 style="font-size:clamp(28px,4vw,44px);margin:12px 0 40px">' + title + '</h1>' + sections.map(s => '<section style="margin-bottom:32px"><h2 style="font-size:clamp(16px,2vw,20px);margin-bottom:10px">' + s[0] + '</h2><div style="color:var(--muted);line-height:1.75;font-size:15px">' + s[1] + '</div></section>').join('') + '<p style="color:var(--muted);font-size:12px;margin-top:48px;border-top:1px solid var(--line);padding-top:20px">Редакция от 10 июня 2026 года. Оператор: ООО «Интеллект Университет», ИНН 9703019107. Контакт: <a href="mailto:galya.chooru@gmail.com" style="color:var(--pink)">galya.chooru@gmail.com</a></p></article>';
    }

    function legalPrivacy() {
      return legalArticle('Политика обработки персональных данных', 'персональные данные', [
        ['1. Кто обрабатывает данные', '<p>ООО «Интеллект Университет», резидент Сколково. ИНН 9703019107, КПП 770301001, ОГРН 1207700370492.</p><p>Адрес: 123112, г. Москва, вн.тер.г. муниципальный округ Пресненский, ул. Тестовская, д. 10, помещ. 3/1.</p><p>Контакт по вопросам персональных данных: <a href="mailto:galya.chooru@gmail.com" style="color:var(--pink)">galya.chooru@gmail.com</a></p>'],
        ['2. Какие данные обрабатываются', '<p>Сайт не требует регистрации и не запрашивает имя, email или телефон. В процессе прохождения теста обрабатываются:</p><ul style="padding-left:20px;margin-top:8px"><li>Ответы на вопросы теста (хранятся только в localStorage браузера пользователя)</li><li>Технические данные: IP-адрес, тип браузера, дата и время обращения — в составе стандартных серверных логов</li><li>Данные cookies: сессионный идентификатор для работы сайта</li></ul>'],
        ['3. Цели обработки', '<p>Обеспечение работы сайта и теста, формирование результата, улучшение качества методики.</p>'],
        ['4. Правовое основание', '<p>Обработка осуществляется на основании ст. 6 Федерального закона № 152-ФЗ «О персональных данных»: согласие субъекта персональных данных (принятие политики cookies при первом визите) и законный интерес оператора по обеспечению работоспособности сервиса.</p>'],
        ['5. Передача третьим лицам', '<p>Персональные данные не передаются третьим лицам в коммерческих целях. Технические данные могут обрабатываться хостинг-провайдером Railway (США) в рамках договора об обработке данных.</p>'],
        ['6. Хранение и удаление', '<p>Ответы теста хранятся исключительно в браузере пользователя и удаляются при очистке данных браузера. Серверные логи хранятся не более 90 дней.</p>'],
        ['7. Права субъекта', '<p>Вы вправе запросить доступ, исправление или удаление своих данных, а также отозвать согласие. Запрос направляйте на <a href="mailto:galya.chooru@gmail.com" style="color:var(--pink)">galya.chooru@gmail.com</a>.</p>'],
        ['8. Обновление документа', '<p>Актуальная версия всегда доступна по адресу <a href="/legal/privacy" data-link style="color:var(--pink)">/legal/privacy</a>.</p>'],
      ]);
    }

    function legalConsent() {
      return legalArticle('Согласие на обработку персональных данных', 'согласие', [
        ['1. Оператор', '<p>ООО «Интеллект Университет», ИНН 9703019107, ОГРН 1207700370492, адрес: 123112, г. Москва, вн.тер.г. муниципальный округ Пресненский, ул. Тестовская, д. 10, помещ. 3/1.</p>'],
        ['2. Какие данные обрабатываются', '<p>Технические данные браузера (IP-адрес, user-agent, дата и время визита), данные cookies, ответы на вопросы теста в анонимном виде.</p>'],
        ['3. Цели обработки', '<p>Обеспечение работы сайта, формирование результата теста, улучшение методики.</p>'],
        ['4. Способ дачи согласия', '<p>Согласие считается данным в момент нажатия кнопки «Принять» в баннере cookies или при продолжении использования сайта после ознакомления с данным документом.</p>'],
        ['5. Срок действия', '<p>Согласие действует до момента его отзыва.</p>'],
        ['6. Отзыв согласия', '<p>Отозвать согласие можно, направив письмо на <a href="mailto:galya.chooru@gmail.com" style="color:var(--pink)">galya.chooru@gmail.com</a>, а также очистив данные браузера (cookies и localStorage).</p>'],
      ]);
    }

    function legalCookies() {
      return legalArticle('Политика cookies', 'cookies', [
        ['1. Оператор', '<p>ООО «Интеллект Университет», ИНН 9703019107, e-mail: <a href="mailto:galya.chooru@gmail.com" style="color:var(--pink)">galya.chooru@gmail.com</a>.</p>'],
        ['2. Что такое cookies', '<p>Cookies — небольшие текстовые файлы, которые сайт сохраняет в вашем браузере для обеспечения работы сервиса.</p>'],
        ['3. Какие cookies мы используем', '<ul style="padding-left:20px"><li><strong>Технические (обязательные):</strong> localStorage для сохранения прогресса и результата теста в вашем браузере. Без них сайт не работает.</li><li><strong>Серверные логи:</strong> стандартные логи хостинга (IP, user-agent) — не cookies, но аналогичные по природе технические данные.</li></ul><p style="margin-top:8px">Мы <strong>не используем</strong> маркетинговые, аналитические или рекламные cookies третьих лиц.</p>'],
        ['4. Управление cookies', '<p>Вы можете удалить сохранённые данные в любое время через настройки браузера → «Очистить данные сайта». Это сбросит прогресс и результат теста.</p>'],
        ['5. Согласие', '<p>При первом визите на сайт отображается уведомление о cookies. Продолжая использование сайта, вы соглашаетесь с настоящей политикой.</p>'],
      ]);
    }

    function legalCompany() {
      const rows = [
        ['Полное наименование', 'Общество с ограниченной ответственностью «Интеллект Университет»'],
        ['Сокращённое наименование', 'ООО «Интеллект Университет»'],
        ['Статус', 'Резидент Сколково'],
        ['Юридический адрес', '123112, г. Москва, вн.тер.г. муниципальный округ Пресненский, ул. Тестовская, д. 10, помещ. 3/1'],
        ['ИНН', '9703019107'],
        ['КПП', '770301001'],
        ['ОГРН', '1207700370492'],
        ['ОКВЭД', '72.19'],
        ['Руководитель', 'Яновская Галина Александровна'],
        ['E-mail', '<a href="mailto:galya.chooru@gmail.com" style="color:var(--pink)">galya.chooru@gmail.com</a>'],
        ['Телефон', '+7 (985) 310-02-11'],
      ];
      return '<article class="article" style="max-width:820px;margin:0 auto;padding:40px clamp(20px,5vw,60px) 80px"><p class="kicker" style="color:var(--muted)">оператор</p><h1 style="font-size:clamp(28px,4vw,44px);margin:12px 0 40px">Реквизиты</h1><div class="card" style="padding:0;overflow:hidden">' + rows.map(([k,v]) => '<div style="display:grid;grid-template-columns:1fr 1.5fr;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line)"><span style="font-size:13px;color:var(--muted)">' + k + '</span><span style="font-size:14px">' + v + '</span></div>').join('') + '</div></article>';
    }

    function home() {
      const archetypeData = [
        { key:'director', name:'Дирижёр', desc:'Контроль как язык любви' },
        { key:'anchor', name:'Опора', desc:'Тащит всё на себе, улыбаясь' },
        { key:'mentor', name:'Наставник', desc:'Растит самостоятельного человека' },
        { key:'guardian', name:'Защитник', desc:'Любит так сильно, что тревожно' },
        { key:'partner', name:'Партнёр', desc:'Скорее друг, чем родитель' },
        { key:'peacemaker', name:'Миротворец', desc:'Ссора для него невыносима' },
      ];
      const archetypeCards = archetypeData.map(a =>
        '<div class="kjr-arch-slide" style="flex:0 0 auto;width:210px;scroll-snap-align:start;background:#fff;border-radius:16px;border:1.5px solid rgba(99,102,241,0.10);overflow:hidden;transition:transform 0.3s ease,box-shadow 0.3s ease;cursor:grab">'
        + '<div style="height:170px;background:linear-gradient(135deg,#f0eeff,#e8e6ff);overflow:hidden"><img src="/archetype-' + a.key + '.png" alt="' + escapeHtml(a.name) + '" style="width:100%;height:100%;object-fit:cover;object-position:center top" draggable="false"></div>'
        + '<div style="padding:14px 16px"><div style="font-size:14px;font-weight:700;color:#1a1830">' + escapeHtml(a.name) + '</div><div style="margin-top:4px;font-size:11px;line-height:1.5;color:rgba(26,24,48,0.55)">' + escapeHtml(a.desc) + '</div></div>'
        + '</div>'
      ).join('');

      const bentoCard = (num, title, text, extra) =>
        '<div class="kjr-bcell" style="opacity:0;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:28px' + (extra || '') + '">'
        + '<div style="font-size:11px;font-weight:700;color:#818cf8">' + num + '</div>'
        + '<div style="margin-top:10px;font-size:17px;font-weight:700;color:#f0edf8">' + title + '</div>'
        + '<p style="margin-top:8px;font-size:14px;line-height:1.7;color:rgba(240,237,248,0.50)">' + text + '</p></div>';

      const reviewCards = [
        { tag:'Дирижёр', quote:'«Я думала, что я спокойный родитель. Тест показал, что я жёстко держу правила там, где ребёнку нужен просто контакт.»', author:'— Анна, мама сына 9 лет' },
        { tag:'Наставник', quote:'«Понравилось, что нет правильных ответов. Ситуации реальные — я несколько раз узнал себя.»', author:'— Дмитрий, папа дочери 12 лет' },
        { tag:'Партнёр', quote:'«Прошла за 8 минут. Муж тоже прошёл — поняли, почему у нас разные реакции на одни ситуации.»', author:'— Светлана, дети 7 и 14 лет' },
      ].map(r =>
        '<div style="background:#fff;border-radius:16px;padding:24px;border:1px solid rgba(26,24,48,0.10);display:flex;flex-direction:column">'
        + '<span style="align-self:flex-start;background:rgba(251,113,133,0.12);color:#fb7185;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-radius:99px;padding:5px 12px">' + escapeHtml(r.tag) + '</span>'
        + '<p style="margin-top:16px;font-size:13px;line-height:1.75;color:#1a1830">' + escapeHtml(r.quote) + '</p>'
        + '<div style="margin-top:16px;font-size:12px;font-weight:700;color:rgba(26,24,48,0.55)">' + escapeHtml(r.author) + '</div></div>'
      ).join('');

      const accItems = [
        { title:'7 шкал измерения', body:'<p>Тест измеряет 7 параметров родительского стиля:</p><ul style="margin:10px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:7px"><li>Ответственность взрослого — кто отвечает за безопасность и решения</li><li>Эмоциональный контакт — насколько родитель слышит чувства ребёнка</li><li>Последовательность границ — правила работают или нет</li><li>Поддержка автономии — даёте ли вы ребёнку выбор</li><li>Толерантность к конфликту — как вы переносите напряжение</li><li>Гибкость — можете ли вы менять решение без угрозы авторитету</li><li>Отличие трудного от опасного — не путаете ли вы дискомфорт с угрозой</li></ul>' },
        { title:'Академическая база', body:'<p>Методика основана на:</p><ul style="margin:10px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:7px"><li>Теория привязанности (Боулби, Эйнсворт)</li><li>Концепция авторитетного родительства (Диана Баумринд)</li><li>Исследования эмоциональной регуляции и стресс-реакций</li></ul><p style="margin-top:12px">Не является клиническим или диагностическим инструментом. Экспериментальная методика, 2026.</p>' },
        { title:'Конфиденциальность', body:'<p>Ваши ответы хранятся только в вашем браузере (localStorage). Мы не передаём данные третьим лицам и не идентифицируем пользователей.</p><p style="margin-top:12px">Анонимная агрегированная статистика помогает улучшать методику.</p>' },
      ];
      const accordionHTML = accItems.map((ac, i) =>
        '<div style="background:#fff;border-radius:16px;border:1px solid rgba(26,24,48,0.10);overflow:hidden">'
        + '<div onclick="(function(el){var b=el.nextElementSibling;var open=b.style.maxHeight!==\\x270px\\x27&&b.style.maxHeight!==\\x27\\x27;b.style.maxHeight=open?\\x270px\\x27:(b.scrollHeight+\\x27px\\x27);b.style.opacity=open?\\x270\\x27:\\x271\\x27;el.querySelector(\\x27span\\x27).style.transform=open?\\x27rotate(0)\\x27:\\x27rotate(180deg)\\x27})(this)" style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;cursor:pointer">'
        + '<span style="font-size:17px;font-weight:700;color:#1a1830">' + escapeHtml(ac.title) + '</span>'
        + '<span style="flex:0 0 auto;width:28px;height:28px;border-radius:99px;background:rgba(99,102,241,0.10);color:#6366f1;display:flex;align-items:center;justify-content:center;transition:transform 0.3s ease;font-size:14px">▾</span></div>'
        + '<div style="max-height:0;opacity:0;overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease"><div style="padding:0 24px 22px;font-size:14px;line-height:1.7;color:rgba(26,24,48,0.65)">' + ac.body + '</div></div></div>'
      ).join('');

      return (
        // NAV
        '<nav class="kjr-nav">'
        + '<a class="kjr-brand" href="/" data-link><span>Какой я родитель</span><small>тест · дети 6–17 лет</small></a>'
        + '<div class="kjr-navlinks"><a href="#methodology" onclick="event.preventDefault();document.getElementById(\\x27methodology\\x27).scrollIntoView({behavior:\\x27smooth\\x27})">Методика</a><a href="#about" onclick="event.preventDefault();document.getElementById(\\x27about\\x27).scrollIntoView({behavior:\\x27smooth\\x27})">Авторы</a></div>'
        + '<button onclick="start()" style="font-size:13px;font-weight:700;background:#6366f1;color:#fff;padding:9px 20px;border-radius:10px;border:none;cursor:pointer;font-family:inherit">Начать тест</button>'
        + '</nav>'

        // HERO
        + '<header class="kjr-hero" style="position:relative;padding:clamp(70px,11vw,140px) clamp(20px,5vw,40px) clamp(80px,10vw,120px);overflow:hidden">'
        + '<div id="kjr-glow1" style="position:absolute;width:600px;height:600px;top:-120px;left:-80px;background:radial-gradient(circle,rgba(99,102,241,0.18) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div id="kjr-glow2" style="position:absolute;width:440px;height:440px;bottom:-60px;right:-40px;background:radial-gradient(circle,rgba(251,113,133,0.16) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div id="kjr-dots" style="position:absolute;inset:0;opacity:0;background-image:radial-gradient(rgba(255,255,255,0.06) 1px,transparent 1px);background-size:32px 32px;-webkit-mask:radial-gradient(ellipse 80% 60% at 50% 50%,black 40%,transparent);mask:radial-gradient(ellipse 80% 60% at 50% 50%,black 40%,transparent);pointer-events:none"></div>'
        + '<div style="position:relative;max-width:880px;margin:0 auto;text-align:center">'
        + '<div id="kjr-eyebrow" style="opacity:0;display:inline-flex;align-items:center;gap:8px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.30);color:#818cf8;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600"><span style="width:6px;height:6px;border-radius:99px;background:#818cf8;display:inline-block"></span>экспериментальный тест · 6 ситуаций</div>'
        + '<h1 id="kjr-h1" style="opacity:0;margin-top:26px;font-weight:800;font-size:clamp(40px,5.5vw,76px);letter-spacing:-0.035em;line-height:1.04">Когда ребёнок говорит <span style="color:#fb7185;font-style:italic">«не хочу»</span>, вы реагируете раньше, чем думаете</h1>'
        + '<p id="kjr-lead" style="opacity:0;max-width:520px;margin:24px auto 0;font-size:17px;line-height:1.7;color:rgba(240,237,248,0.50)">Шесть реальных ситуаций без правильных ответов — и честный разбор того, как именно вы реагируете под давлением.</p>'
        + '<div id="kjr-cta" style="opacity:0;margin-top:36px"><button onclick="start()" class="kjr-cta-link" style="display:inline-block;background:#6366f1;color:#fff;font-weight:700;font-size:16px;border-radius:12px;padding:14px 28px;box-shadow:0 0 32px rgba(99,102,241,0.35);transition:transform 0.25s ease,box-shadow 0.25s ease;border:none;cursor:pointer;font-family:inherit">Пройти тест — 10 минут →</button>'
        + '<p style="margin-top:16px;font-size:12px;color:rgba(240,237,248,0.50)">без регистрации · данные только в браузере</p></div>'
        + '</div></header>'

        // CARD 1: ARCHETYPES
        + '<section class="kjr-card kjr-card-light kjr-card-pad" style="opacity:0">'
        + '<div style="max-width:620px;margin:0 auto;text-align:center"><p class="kicker">Шесть архетипов</p><h2 style="margin-top:14px;font-weight:800;font-size:clamp(26px,3.2vw,42px);letter-spacing:-0.025em;line-height:1.08;color:#1a1830">Каким родителем вы становитесь под давлением</h2><p style="margin-top:16px;font-size:16px;line-height:1.7;color:rgba(26,24,48,0.55)">Тест покажет ваш доминирующий паттерн реакции — не характер, а автоматику.</p></div>'
        + '<div class="kjr-slider" style="margin-top:40px;display:flex;gap:16px;overflow-x:auto;padding:4px 4px 12px;scroll-snap-type:x mandatory">' + archetypeCards + '</div>'
        + '<p style="margin-top:8px;text-align:center;font-size:12px;color:rgba(26,24,48,0.40)">← потяните, чтобы посмотреть все →</p>'
        + '</section>'

        // CARD 2: WHY
        + '<section class="kjr-card kjr-card-gradient kjr-card-pad" style="opacity:0">'
        + '<div style="position:absolute;width:420px;height:420px;top:-120px;right:-100px;background:radial-gradient(circle,rgba(99,102,241,0.18) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div style="position:relative;max-width:1000px;margin:0 auto">'
        + '<p class="kicker kicker-coral">Зачем проходить</p>'
        + '<h2 style="margin-top:14px;font-weight:800;font-size:clamp(26px,3.2vw,42px);letter-spacing:-0.025em;line-height:1.08;color:#f0edf8">Что изменится после 10 минут</h2>'
        + '<div class="kjr-bento" style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:12px">'
        + bentoCard('01','Понимание своей реакции','Что именно вы делаете под давлением — и в каких ситуациях это работает против вас.')
        + bentoCard('02','Конкретные слова','Не «быть терпеливее», а фразы, которые можно сказать ребёнку сегодня вечером.')
        + '<div class="kjr-bcell kjr-bento-wide" style="opacity:0;grid-column:span 2;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:28px;display:flex;flex-wrap:wrap;gap:28px;align-items:center"><div style="min-width:160px"><div id="kjr-counter" style="font-size:64px;font-weight:800;letter-spacing:-0.03em;color:#fb7185;line-height:1">0+</div><div style="margin-top:6px;font-size:14px;color:rgba(240,237,248,0.50)">родителей уже прошли</div></div><div style="flex:1;min-width:220px"><div style="font-size:11px;font-weight:700;color:#818cf8">03</div><div style="margin-top:10px;font-size:17px;font-weight:700;color:#f0edf8">Пауза 2–3 секунды</div><p style="margin-top:8px;font-size:14px;line-height:1.7;color:rgba(240,237,248,0.50)">Одно изменение в реакции — достаточно, чтобы выбрать, а не действовать на автомате.</p></div></div>'
        + '</div></div></section>'

        // CARD 3: REVIEWS
        + '<section class="kjr-card kjr-card-light kjr-card-pad" style="opacity:0">'
        + '<p class="kicker kicker-coral">Отзывы</p>'
        + '<h2 style="margin-top:14px;font-weight:800;font-size:clamp(26px,3.2vw,42px);letter-spacing:-0.025em;line-height:1.08;color:#1a1830">Что говорят родители</h2>'
        + '<div class="kjr-reviews" style="margin-top:32px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px">' + reviewCards + '</div>'
        + '</section>'

        // CARD 4: METHODOLOGY accordion
        + '<section id="methodology" class="kjr-card kjr-card-light kjr-card-pad" style="opacity:0">'
        + '<p class="kicker">Методика</p>'
        + '<h2 style="margin-top:14px;font-weight:800;font-size:clamp(26px,3.2vw,42px);letter-spacing:-0.025em;line-height:1.08;color:#1a1830">Как работает тест</h2>'
        + '<div style="margin-top:32px;max-width:840px;display:flex;flex-direction:column;gap:12px">' + accordionHTML + '</div>'
        + '</section>'

        // CTA
        + '<section id="cta" class="kjr-card kjr-card-gradient kjr-card-pad" style="opacity:0;position:relative;border-radius:28px 28px 0 0;margin-bottom:0">'
        + '<div style="position:absolute;width:560px;height:560px;top:50%;left:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(99,102,241,0.20) 0%,transparent 65%);pointer-events:none"></div>'
        + '<div style="position:relative;max-width:640px;margin:0 auto;text-align:center">'
        + '<h2 style="font-weight:800;font-size:clamp(26px,3.2vw,42px);letter-spacing:-0.025em;line-height:1.08;color:#f0edf8">Узнайте свой родительский архетип</h2>'
        + '<p style="margin-top:16px;font-size:16px;color:rgba(240,237,248,0.55)">Шесть ситуаций · 10 минут · без регистрации</p>'
        + '<button onclick="start()" class="kjr-cta-link" style="display:inline-block;margin-top:32px;background:#6366f1;color:#fff;font-weight:700;font-size:16px;padding:16px 40px;border-radius:12px;box-shadow:0 0 32px rgba(99,102,241,0.35);transition:transform 0.25s ease,box-shadow 0.25s ease;border:none;cursor:pointer;font-family:inherit">Пройти тест бесплатно →</button>'
        + '<div style="margin-top:28px;display:flex;flex-wrap:wrap;justify-content:center;gap:10px">'
        + '<span style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:rgba(240,237,248,0.75);border-radius:99px;padding:9px 16px;font-size:13px;font-weight:500">🔒 без регистрации</span>'
        + '<span style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:rgba(240,237,248,0.75);border-radius:99px;padding:9px 16px;font-size:13px;font-weight:500">⏱ 10 минут</span>'
        + '<span style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);color:rgba(240,237,248,0.75);border-radius:99px;padding:9px 16px;font-size:13px;font-weight:500">💾 данные только у вас</span>'
        + '</div></div></section>'

        // FOOTER
        + '<footer style="margin:0 24px;background:#0e0c18;padding:40px clamp(20px,4vw,40px);border-top:1px solid rgba(255,255,255,0.07)">'
        + '<div style="max-width:1000px;margin:0 auto;display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between">'
        + '<div><div style="font-weight:700;font-size:15px">Какой я родитель</div><div style="margin-top:6px;font-size:12px;color:rgba(240,237,248,0.50)">Экспериментальная методика · 2026</div></div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:16px 24px;font-size:12px;color:rgba(240,237,248,0.50);max-width:560px">'
        + '<a href="/legal/privacy" data-link>Политика конфиденциальности</a>'
        + '<a href="/legal/consent" data-link>Согласие на обработку данных</a>'
        + '<a href="/legal/cookies" data-link>Политика Cookies</a>'
        + '<a href="/legal/company" data-link>Реквизиты компании</a>'
        + '<a href="mailto:galya.chooru@gmail.com">galya.chooru@gmail.com</a>'
        + '</div></div>'
        + '<div style="max-width:1000px;margin:28px auto 0;padding-top:20px;border-top:1px solid rgba(255,255,255,0.07);font-size:12px;color:rgba(240,237,248,0.40)">© 2026 ООО «Интеллект Университет» · ИНН 9703019107</div>'
        + '</footer>'

        // METHODOLOGY & AUTHORS (full content)
        + methodologyPage()
        + aboutPage()

        // TEST section
        + '<section id="test" style="padding:0 clamp(16px,4vw,40px)">' + testSection() + '</section>'
      );
    }

    function start() {
      localStorage.removeItem(TEXT_ANALYSIS_KEY);
      state = { started: true, profileStep: true, index: 0, answers: [], profile: {}, startedAt: new Date().toISOString() };
      saveState();
      render();
      const target = document.querySelector("#test");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function profileForm() {
      const p = state.profile || {};
      const roleOpts = [['mother','Мать'],['father','Отец'],['grandmother','Бабушка'],['grandfather','Дедушка'],['stepparent','Отчим / Мачеха'],['other','Другой близкий взрослый']];
      const countOpts = [['1','Один'],['2','Двое'],['3+','Трое и больше']];
      const genderOpts = [['boy','Мальчик'],['girl','Девочка']];
      const chip = (group, val, label, sel) => '<button style="font-family:inherit;font-size:14px;font-weight:' + (sel?'700':'500') + ';padding:9px 18px;border-radius:10px;border:1.5px solid ' + (sel?'#6366f1':'rgba(26,24,48,0.15)') + ';background:' + (sel?'rgba(99,102,241,0.10)':'transparent') + ';color:' + (sel?'#6366f1':'rgba(26,24,48,0.75)') + ';cursor:pointer;transition:all 0.2s" data-profile="' + group + '" data-value="' + val + '">' + label + '</button>';
      const multi = p.children && p.children !== '1';
      const childWord = multi ? 'одном ребёнке' : 'ребёнке';
      const note = multi ? '<p style="font-size:13px;color:#e85f7a;margin:-4px 0 4px;line-height:1.5">Дальше отвечайте, думая об <strong>одном ребёнке</strong> — о том, с кем сейчас сложнее всего.</p>' : '';
      return '<section style="background:#f2f1f8;border-radius:26px;padding:clamp(24px,4vw,44px);color:#1a1830;max-width:680px;margin:0 auto">'
        + '<div style="display:inline-flex;align-items:center;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#6366f1"><span style="width:6px;height:6px;border-radius:99px;background:#fb7185;display:inline-block"></span>Немного о вас</div>'
        + '<h2 style="margin-top:16px;font-weight:800;font-size:clamp(22px,2.8vw,32px);letter-spacing:-0.02em;line-height:1.18;color:#1a1830">Немного о вас</h2>'
        + '<p style="margin-top:10px;font-size:14px;line-height:1.6;color:rgba(26,24,48,0.55);margin-bottom:24px">Это поможет точнее собрать результат. Имена и личные данные не нужны.</p>'
        + '<div style="display:flex;flex-direction:column;gap:20px">'
        + '<div><p style="font-size:13px;font-weight:600;color:#1a1830;margin-bottom:10px">Кто вы ребёнку?</p><div style="display:flex;flex-wrap:wrap;gap:8px">' + roleOpts.map(o => chip('role', o[0], o[1], p.role === o[0])).join('') + '</div></div>'
        + '<div><p style="font-size:13px;font-weight:600;color:#1a1830;margin-bottom:10px">Сколько у вас детей?</p><div style="display:flex;flex-wrap:wrap;gap:8px">' + countOpts.map(o => chip('children', o[0], o[1], p.children === o[0])).join('') + '</div></div>'
        + note
        + '<div><p style="font-size:13px;font-weight:600;color:#1a1830;margin-bottom:10px">Пол ' + childWord + '</p><div style="display:flex;flex-wrap:wrap;gap:8px">' + genderOpts.map(o => chip('gender', o[0], o[1], p.gender === o[0])).join('') + '</div></div>'
        + '<div><p style="font-size:13px;font-weight:600;color:#1a1830;margin-bottom:10px">Возраст ' + childWord + ' (лет)</p><input type="number" min="1" max="18" data-profile-age value="' + (p.age || '') + '" placeholder="напр. 9" style="width:130px;background:#fff;border:1.5px solid rgba(26,24,48,0.15);border-radius:10px;padding:10px 14px;font-family:inherit;font-size:15px;color:#1a1830;outline:none" /></div>'
        + '</div>'
        + '<p style="font-size:13px;color:#e85f7a;margin-top:12px;min-height:20px" id="error"></p>'
        + '<div style="margin-top:24px;display:flex;align-items:center;gap:12px">'
        + '<button style="font-family:inherit;font-size:14px;font-weight:600;padding:12px 22px;border-radius:11px;border:1px solid rgba(26,24,48,0.12);background:transparent;color:rgba(26,24,48,0.5);cursor:pointer" data-profile-cancel>← Назад</button>'
        + '<button style="font-family:inherit;font-size:14px;font-weight:700;padding:12px 26px;border-radius:11px;border:none;background:#6366f1;color:#fff;cursor:pointer;box-shadow:0 0 24px rgba(99,102,241,0.30)" data-profile-submit>Начать тест →</button>'
        + '</div>'
        + '</section>';
    }

    function currentAnswer() {
      const question = QUESTIONS[state.index];
      return state.answers.find(answer => answer.questionId === question?.id);
    }

    function testSection() {
      if (!state.started) {
        return '<div style="max-width:680px;margin:0 auto;padding:clamp(24px,4vw,44px) 0">'
          + '<section style="background:#f2f1f8;border-radius:26px;padding:clamp(24px,4vw,44px);color:#1a1830">'
          + '<div style="display:inline-flex;align-items:center;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#6366f1"><span style="width:6px;height:6px;border-radius:99px;background:#fb7185;display:inline-block"></span>Перед началом</div>'
          + '<h2 style="margin-top:16px;font-weight:800;font-size:clamp(22px,2.8vw,34px);letter-spacing:-0.02em;line-height:1.18;color:#1a1830">Шесть реальных ситуаций</h2>'
          + '<p style="margin-top:12px;font-size:15px;line-height:1.7;color:rgba(26,24,48,0.65)">Отвечайте как в жизни, а не как «надо». Не указывайте имена ребёнка, школу и другие персональные данные.</p>'
          + '<div style="margin-top:28px"><button class="button" data-start>Начать тест →</button></div>'
          + '</section></div>';
      }
      if (state.profileStep) {
        return '<div style="max-width:1100px;margin:0 auto;padding:clamp(24px,4vw,44px) 0">' + profileForm() + '</div>';
      }

      const question = QUESTIONS[state.index];
      if (!question) return resultPage(false);
      const testCase = TEST_CASES.find(item => item.id === question.caseId);
      const answer = currentAnswer();
      const percent = Math.round((state.index / QUESTIONS.length) * 100);
      const caseIndex = TEST_CASES.findIndex(item => item.id === question.caseId);
      const atStart = state.index === 0;
      const isLast = state.index === QUESTIONS.length - 1;

      const sidebarItems = TEST_CASES.map((item, index) => {
        const isDone = state.answers.some(a => a.caseId === item.id);
        const isActive = index === caseIndex;
        return '<div style="display:flex;gap:11px;align-items:center;padding:10px 12px;border-radius:11px;background:' + (isActive ? 'rgba(99,102,241,0.14)' : 'transparent') + ';border:1px solid ' + (isActive ? 'rgba(99,102,241,0.30)' : 'transparent') + '">'
          + '<span style="flex:0 0 auto;width:18px;height:18px;border-radius:99px;border:1.5px solid ' + (isActive ? '#818cf8' : (isDone ? '#6366f1' : 'rgba(255,255,255,0.25)')) + ';background:' + (isDone ? '#6366f1' : 'transparent') + ';display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff">' + (isDone ? '✓' : '') + '</span>'
          + '<span style="font-size:13px;color:' + (isActive ? '#818cf8' : (isDone ? 'rgba(240,237,248,0.80)' : 'rgba(240,237,248,0.45)')) + ';font-weight:' + (isActive ? '700' : '500') + '">' + escapeHtml(item.title) + '</span>'
          + '</div>';
      }).join('');

      const optionsHTML = question.type === 'open'
        ? '<div style="margin-top:26px">'
          + '<textarea data-open placeholder="Напишите первую настоящую фразу, которую вы скажете ребёнку…" style="width:100%;min-height:140px;resize:vertical;background:#1e1b2e;color:#f0edf8;border:1.5px solid rgba(255,255,255,0.10);border-radius:14px;padding:16px 18px;font-family:inherit;font-size:15px;line-height:1.6;outline:none">' + escapeHtml(answer?.textAnswer || '') + '</textarea>'
          + '<p style="margin-top:10px;font-size:12px;color:rgba(26,24,48,0.45)">Нет правильного ответа. Пишите так, как сказали бы на самом деле.</p>'
          + '</div>'
        : '<div style="margin-top:26px;display:flex;flex-direction:column;gap:10px">'
          + question.options.map(option => {
            const sel = answer?.selectedOptionId === option.id;
            return '<div style="display:flex;gap:13px;align-items:flex-start;padding:14px 18px;border-radius:13px;cursor:pointer;border:1.5px solid ' + (sel ? '#6366f1' : 'rgba(26,24,48,0.12)') + ';background:' + (sel ? 'rgba(99,102,241,0.08)' : '#fff') + ';color:#1a1830;font-size:15px;line-height:1.45;transition:border-color 0.2s,background 0.2s" data-option="' + option.id + '">'
              + '<span style="flex:0 0 auto;width:20px;height:20px;border-radius:99px;border:1.5px solid ' + (sel ? '#6366f1' : 'rgba(26,24,48,0.25)') + ';background:' + (sel ? '#6366f1' : 'transparent') + ';display:inline-flex;align-items:center;justify-content:center;margin-top:1px;font-size:11px;color:#fff">' + (sel ? '✓' : '') + '</span>'
              + '<span style="font-weight:' + (sel ? '600' : '400') + '">' + escapeHtml(option.label) + '</span>'
              + '</div>';
          }).join('')
          + '</div>';

      return '<div style="max-width:1100px;margin:0 auto;padding:clamp(24px,4vw,44px) 0 80px">'

        // PROGRESS
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">'
        + '<div style="font-size:13px;color:rgba(240,237,248,0.50)">Кейс <span style="color:#818cf8;font-weight:700">' + (caseIndex + 1) + '</span> из 6</div>'
        + '<div style="font-size:13px;color:rgba(240,237,248,0.50)">' + percent + '% пройдено</div>'
        + '</div>'
        + '<div style="margin-top:10px;height:6px;border-radius:99px;background:rgba(255,255,255,0.08);overflow:hidden">'
        + '<div style="height:100%;width:' + percent + '%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:99px;transition:width 0.4s ease"></div>'
        + '</div>'

        // GRID: sidebar + question card
        + '<div class="kjr-test-grid" style="margin-top:28px;display:grid;grid-template-columns:240px 1fr;gap:20px;align-items:start">'

        // SIDEBAR
        + '<aside class="kjr-sidebar" style="position:sticky;top:90px;background:#1e1b2e;border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:18px">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:rgba(240,237,248,0.40);font-weight:700;padding:0 6px 12px">Ситуации</div>'
        + '<div style="display:flex;flex-direction:column;gap:4px">' + sidebarItems + '</div>'
        + '</aside>'

        // QUESTION CARD
        + '<section style="background:#f2f1f8;border-radius:26px;padding:clamp(24px,4vw,44px);color:#1a1830">'
        + '<div style="display:inline-flex;align-items:center;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#6366f1"><span style="width:6px;height:6px;border-radius:99px;background:#fb7185;display:inline-block"></span>' + escapeHtml(testCase.title) + ' · ребёнок ' + escapeHtml(testCase.childAge || '') + '</div>'
        + '<h2 style="margin-top:16px;font-weight:800;font-size:clamp(22px,2.8vw,34px);letter-spacing:-0.02em;line-height:1.18;color:#1a1830">' + escapeHtml(question.prompt) + '</h2>'
        + '<p style="margin-top:12px;font-size:14px;line-height:1.6;color:rgba(26,24,48,0.55)">' + escapeHtml(testCase.scenario) + '</p>'
        + optionsHTML
        + '<p style="font-size:13px;color:#e85f7a;margin-top:12px;min-height:20px" id="error"></p>'
        + '<div style="margin-top:30px;display:flex;align-items:center;justify-content:space-between;gap:12px">'
        + '<button data-back ' + (atStart ? 'disabled' : '') + ' style="font-family:inherit;font-size:14px;font-weight:600;padding:12px 22px;border-radius:11px;border:1px solid rgba(26,24,48,0.12);background:transparent;color:' + (atStart ? 'rgba(26,24,48,0.30)' : '#1a1830') + ';cursor:' + (atStart ? 'not-allowed' : 'pointer') + '">← Назад</button>'
        + '<button data-next style="font-family:inherit;font-size:14px;font-weight:700;padding:12px 26px;border-radius:11px;border:none;background:#6366f1;color:#fff;cursor:pointer;box-shadow:0 0 24px rgba(99,102,241,0.30)">' + (isLast ? 'Узнать результат →' : 'Дальше →') + '</button>'
        + '</div>'
        + '</section>'

        + '</div></div>';
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
        body: JSON.stringify({ type: "result", result, answers: state.answers, profile: state.profile || {} })
      }).then(r => r.json()).then(data => {
        if (data.textAnalysis) {
          localStorage.setItem(TEXT_ANALYSIS_KEY, data.textAnalysis);
          // Re-render to show analysis if already on result page
          if (state.index >= QUESTIONS.length) render();
        }
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

    function resultPage(demo) {
      const result = demo ? {
        normalized: { adultResponsibility: 74, emotionalContact: 69, boundariesConsistency: 58, autonomySupport: 63, conflictTolerance: 52, flexibility: 71, difficultyVsUnsafety: 76 },
        strongest: "difficultyVsUnsafety",
        second: "adultResponsibility",
        attention: "conflictTolerance"
      } : JSON.parse(localStorage.getItem(RESULT_KEY) || "null");
      if (!result) return '<div style="max-width:680px;margin:0 auto;padding:40px 0"><section style="background:#f2f1f8;border-radius:26px;padding:40px;color:#1a1830;text-align:center"><h2 style="font-weight:800;font-size:28px;color:#1a1830">Результата пока нет</h2><p style="margin-top:12px;font-size:15px;color:rgba(26,24,48,0.65)">Сначала пройдите тест. Ответы сохранятся в браузере.</p><div style="margin-top:24px"><button class="button" data-start>Начать тест →</button></div></section></div>';

      const archetypeKeys = getArchetypes(result.normalized);
      const archetype = ARCHETYPES[archetypeKeys.primary];
      const archetype2 = archetypeKeys.secondary ? ARCHETYPES[archetypeKeys.secondary] : null;
      const experiment = REACTION_BY_SCALE[result.attention] || REACTION_QUESTIONS[0];
      const textAnalysis = demo ? null : localStorage.getItem(TEXT_ANALYSIS_KEY);

      // ── Radar SVG (indigo style, 360×360) ────────────────────────────────
      const RCX = 180, RCY = 180, RR = 120;
      const rN = SCALE_KEYS.length;
      const rA = SCALE_KEYS.map((_, i) => Math.PI * 2 * i / rN - Math.PI / 2);
      const rGrid = [.25,.5,.75,1].map(f => '<polygon points="' + rA.map(a => (RCX+RR*f*Math.cos(a)).toFixed(1)+','+(RCY+RR*f*Math.sin(a)).toFixed(1)).join(' ') + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>').join('');
      const rAxes = rA.map(a => '<line x1="'+RCX+'" y1="'+RCY+'" x2="'+(RCX+RR*Math.cos(a)).toFixed(1)+'" y2="'+(RCY+RR*Math.sin(a)).toFixed(1)+'" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>').join('');
      const rPts = SCALE_KEYS.map((key,i)=>(RCX+RR*result.normalized[key]/100*Math.cos(rA[i])).toFixed(1)+','+(RCY+RR*result.normalized[key]/100*Math.sin(rA[i])).toFixed(1)).join(' ');
      const rDots = SCALE_KEYS.map((key,i)=>{const px=(RCX+RR*result.normalized[key]/100*Math.cos(rA[i])).toFixed(1),py=(RCY+RR*result.normalized[key]/100*Math.sin(rA[i])).toFixed(1);return '<circle cx="'+px+'" cy="'+py+'" r="4" fill="#818cf8"/>';}).join('');
      const rSL = {adultResponsibility:'Взрослость',emotionalContact:'Контакт',boundariesConsistency:'Границы',autonomySupport:'Автономия',conflictTolerance:'Конфликт',flexibility:'Гибкость',difficultyVsUnsafety:'Риск/труд'};
      const rLabels = SCALE_KEYS.map((key,i)=>{const lx=RCX+(RR+28)*Math.cos(rA[i]),ly=RCY+(RR+28)*Math.sin(rA[i]),anch=lx<RCX-8?'end':lx>RCX+8?'start':'middle';return '<text x="'+lx.toFixed(1)+'" y="'+(ly+4).toFixed(1)+'" text-anchor="'+anch+'" dominant-baseline="middle" fill="rgba(240,237,248,0.65)" font-size="12" font-weight="600" font-family="Inter,sans-serif">'+rSL[key]+'</text>';}).join('');
      const radarSVG = '<svg viewBox="0 0 360 360" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:360px;display:block">'+rGrid+rAxes+'<polygon points="'+rPts+'" fill="rgba(99,102,241,0.28)" stroke="#818cf8" stroke-width="2.5" stroke-linejoin="round"/>'+rDots+rLabels+'</svg>';

      // ── Block 1: archetype ─────────────────────────────────────────────────
      const block1 = '<section class="kjr-rc kjr-arch-block" style="opacity:0;background:#f2f1f8;border-radius:30px;padding:clamp(24px,4vw,44px);color:#1a1830;display:grid;grid-template-columns:280px 1fr;gap:clamp(20px,4vw,40px);align-items:center">'
        + '<div style="border-radius:22px;overflow:hidden;background:linear-gradient(135deg,#f0eeff,#e8e6ff);aspect-ratio:3/4">'
        + '<img src="' + escapeHtml(archetype.image) + '" alt="' + escapeHtml(archetype.name) + '" style="width:100%;height:100%;object-fit:cover;object-position:center top" />'
        + '</div>'
        + '<div>'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:#6366f1">' + (demo ? 'Демо · ваш архетип' : 'Ваш архетип') + '</div>'
        + '<h1 style="margin-top:10px;font-weight:800;font-size:clamp(40px,5vw,68px);letter-spacing:-0.03em;line-height:1.02;color:#1a1830">' + escapeHtml(archetype.name) + '</h1>'
        + '<p style="margin-top:14px;font-size:18px;line-height:1.55;color:rgba(26,24,48,0.65);max-width:440px">' + escapeHtml(archetype.tagline) + '</p>'
        + '<div style="margin-top:22px;display:flex;flex-wrap:wrap;gap:10px">'
        + '<div style="background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.20);border-radius:14px;padding:12px 16px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#6366f1">Сила</div><div style="margin-top:4px;font-size:14px;font-weight:600;color:#1a1830">' + escapeHtml(archetype.strength) + '</div></div>'
        + '<div style="background:rgba(251,113,133,0.10);border:1px solid rgba(251,113,133,0.22);border-radius:14px;padding:12px 16px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#fb7185">Зона роста</div><div style="margin-top:4px;font-size:14px;font-weight:600;color:#1a1830">' + escapeHtml(archetype.growth) + '</div></div>'
        + '</div>'
        + (archetype2 ? '<div style="margin-top:18px;padding:14px 18px;background:rgba(99,102,241,0.06);border-radius:14px;border-left:3px solid rgba(99,102,241,0.30)"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#818cf8">Второй архетип</div><div style="margin-top:4px;font-size:15px;font-weight:700;color:#1a1830">' + escapeHtml(archetype2.name) + '</div><p style="margin-top:4px;font-size:13px;color:rgba(26,24,48,0.6)">' + escapeHtml(archetype2.tagline) + '</p></div>' : '')
        + '<div style="margin-top:20px"><button class="button secondary" data-start style="border:1px solid rgba(26,24,48,0.15);color:#1a1830">Пройти заново</button></div>'
        + '</div>'
        + '</section>';

      // ── Block 2: radar + highlights ────────────────────────────────────────
      const highlights = [
        { icon:'↑', kicker:'Ваша сила', title: STRENGTH_TITLES[result.strongest], text: escapeHtml(STRENGTH_DESCRIPTIONS[result.strongest]), iconBg:'rgba(99,102,241,0.15)', iconColor:'#818cf8' },
        { icon:'•', kicker:'Вторая опора', title: STRENGTH_TITLES[result.second], text: escapeHtml(STRENGTH_DESCRIPTIONS[result.second]), iconBg:'rgba(99,102,241,0.10)', iconColor:'#818cf8' },
        { icon:'↓', kicker:'Зона внимания', title: ATTENTION_TITLES[result.attention], text: escapeHtml(ATTENTION_DESCRIPTIONS[result.attention]), iconBg:'rgba(251,113,133,0.15)', iconColor:'#fb7185' },
      ];
      const block2 = '<section class="kjr-rc kjr-radar-block" style="opacity:0;position:relative;overflow:hidden;background:linear-gradient(135deg,#1a1830 0%,#0e1225 50%,#111827 100%);border-radius:30px;padding:clamp(24px,4vw,44px);display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,4vw,40px);align-items:center">'
        + '<div style="position:absolute;width:380px;height:380px;top:-120px;left:-80px;background:radial-gradient(circle,rgba(99,102,241,0.16) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div style="position:relative;display:flex;justify-content:center">' + radarSVG + '</div>'
        + '<div style="position:relative">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:#818cf8">Профиль решений</div>'
        + '<h2 style="margin-top:10px;font-weight:800;font-size:clamp(22px,2.6vw,32px);letter-spacing:-0.02em;line-height:1.12;color:#f0edf8">7 шкал родительского стиля</h2>'
        + '<div style="margin-top:22px;display:flex;flex-direction:column;gap:14px">'
        + highlights.map(h => '<div style="display:flex;gap:14px;align-items:flex-start"><span style="flex:0 0 auto;width:38px;height:38px;border-radius:12px;background:' + h.iconBg + ';color:' + h.iconColor + ';display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:800">' + h.icon + '</span><div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:' + h.iconColor + '">' + h.kicker + '</div><div style="margin-top:3px;font-size:15px;font-weight:700;color:#f0edf8">' + h.title + '</div><div style="margin-top:3px;font-size:13px;line-height:1.55;color:rgba(240,237,248,0.55)">' + h.text + '</div></div></div>').join('')
        + '</div>'
        + (textAnalysis ? '<div style="margin-top:22px;padding:14px 16px;background:rgba(99,102,241,0.08);border-left:3px solid #818cf8;border-radius:0 12px 12px 0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#818cf8;margin-bottom:8px">Анализ ваших слов</div><p style="font-size:13px;line-height:1.65;color:rgba(240,237,248,0.80)">' + escapeHtml(textAnalysis) + '</p></div>' : '')
        + '</div>'
        + '</section>';

      // ── Block 3: scales breakdown ──────────────────────────────────────────
      const scaleItems = [...SCALE_KEYS].sort((a, b) => result.normalized[b] - result.normalized[a]).map((key, idx) => {
        const v = result.normalized[key];
        const howTo = SCALE_HOWTO[key];
        const level = v >= 70 ? 'high' : v >= 50 ? 'mid' : 'low';
        const levelText = (SCALE_LEVEL_TEXTS[key] || {})[level] || SCALE_DESCRIPTIONS[key];
        const badge = v >= 70 ? 'развита' : v >= 50 ? 'умеренная' : 'зона роста';
        const badgeBg = v >= 70 ? 'rgba(99,102,241,0.12)' : v >= 50 ? 'rgba(26,24,48,0.06)' : 'rgba(251,113,133,0.12)';
        const badgeColor = v >= 70 ? '#6366f1' : v >= 50 ? 'rgba(26,24,48,0.55)' : '#e85f7a';
        const barColor = v >= 70 ? '#6366f1' : v >= 50 ? '#a5a3c4' : '#fb7185';
        return '<div style="background:#fff;border:1px solid rgba(26,24,48,0.08);border-radius:18px;padding:20px 22px">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
          + '<span style="font-size:16px;font-weight:700;color:#1a1830">' + escapeHtml(SCALE_TITLES[key]) + '</span>'
          + '<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-radius:99px;padding:5px 12px;background:' + badgeBg + ';color:' + badgeColor + '">' + badge + '</span>'
          + '</div>'
          + '<div style="margin-top:12px;height:8px;border-radius:99px;background:rgba(26,24,48,0.07);overflow:hidden">'
          + '<div style="height:100%;width:' + v + '%;border-radius:99px;background:' + barColor + '"></div>'
          + '</div>'
          + '<p style="margin-top:12px;font-size:14px;line-height:1.6;color:rgba(26,24,48,0.62)">' + escapeHtml(levelText) + '</p>'
          + '<div onclick="(function(el){var t=el.nextElementSibling;var vis=t.style.display!==\\x27none\\x27&&t.style.display!==\\x27\\x27;t.style.display=vis?\\x27none\\x27:\\x27block\\x27;el.querySelector(\\x27.tip-arr\\x27).style.transform=vis?\\x27rotate(0)\\x27:\\x27rotate(180deg)\\x27})(this)" style="margin-top:12px;display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;font-weight:700;color:#6366f1">Попробуйте <span class="tip-arr" style="display:inline-block;transition:transform 0.25s ease">▾</span></div>'
          + '<div style="display:none;margin-top:12px;background:rgba(99,102,241,0.06);border-left:3px solid #6366f1;border-radius:0 12px 12px 0;padding:14px 16px;font-size:14px;line-height:1.6;color:#1a1830">' + escapeHtml(howTo.text) + '</div>'
          + '</div>';
      }).join('');
      const block3 = '<section class="kjr-rc" style="opacity:0;background:#f2f1f8;border-radius:30px;padding:clamp(24px,4vw,44px);color:#1a1830">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:#6366f1">Расшифровка</div>'
        + '<h2 style="margin-top:10px;font-weight:800;font-size:clamp(22px,2.8vw,34px);letter-spacing:-0.02em;line-height:1.1">Что показывает каждая шкала</h2>'
        + '<div style="margin-top:28px;display:flex;flex-direction:column;gap:12px">' + scaleItems + '</div>'
        + '</section>';

      // ── Block 4: next steps ────────────────────────────────────────────────
      const steps = [
        { num:'01', when:'Сразу', title:'Пауза 3 секунды', text:'Сегодня вечером, перед первой реакцией на «не хочу», сосчитайте до трёх. Этого достаточно, чтобы выбрать ответ, а не действовать на автомате.' },
        { num:'02', when:'На неделю', title: escapeHtml(experiment.title), text: escapeHtml(experiment.text) },
        { num:'03', when:'Дальше', title:'Назовите чувство до совета', text:'Сделайте привычкой сначала отражать эмоцию («вижу, что злишься»), а уже потом переходить к решению.' },
      ];
      const block4 = '<section class="kjr-rc" style="opacity:0;position:relative;overflow:hidden;background:linear-gradient(135deg,#1a1830 0%,#0e1225 50%,#111827 100%);border-radius:30px;padding:clamp(28px,4vw,52px)">'
        + '<div style="position:absolute;width:480px;height:480px;bottom:-160px;right:-120px;background:radial-gradient(circle,rgba(251,113,133,0.12) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div style="position:relative">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:#818cf8">Что делать дальше</div>'
        + '<h2 style="margin-top:10px;font-weight:800;font-size:clamp(22px,2.8vw,34px);letter-spacing:-0.02em;line-height:1.1;color:#f0edf8">Три шага, начиная с сегодняшнего вечера</h2>'
        + '<div style="margin-top:28px;display:flex;flex-direction:column;gap:12px">'
        + steps.map(s => '<div style="display:flex;gap:20px;align-items:flex-start;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:22px 24px"><div style="flex:0 0 auto;font-size:40px;font-weight:800;letter-spacing:-0.03em;color:#818cf8;line-height:1;min-width:50px">' + s.num + '</div><div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#fb7185">' + s.when + '</div><div style="margin-top:5px;font-size:17px;font-weight:700;color:#f0edf8">' + s.title + '</div><p style="margin-top:6px;font-size:14px;line-height:1.6;color:rgba(240,237,248,0.55)">' + s.text + '</p></div></div>').join('')
        + '</div>'
        + '<div style="margin-top:28px;display:flex;flex-wrap:wrap;gap:12px;align-items:center">'
        + '<button class="button secondary" data-start style="border-color:rgba(255,255,255,0.15);color:#f0edf8">Пройти заново</button>'
        + (demo ? '' : '<section id="feedback-block"><div data-feedback-form style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span style="font-size:13px;color:rgba(240,237,248,0.55)">Похож на вас?</span><button class="button" style="font-size:12px;padding:8px 16px;box-shadow:none" data-feedback="yes">Да</button><button class="button" style="font-size:12px;padding:8px 16px;box-shadow:none" data-feedback="partly">Скорее да</button><button class="button" style="font-size:12px;padding:8px 16px;box-shadow:none" data-feedback="no">Нет</button><button style="font-family:inherit;font-size:12px;font-weight:700;padding:8px 16px;border-radius:10px;border:none;background:#fb7185;color:#fff;cursor:pointer" data-feedback-send>Отправить</button></div></section>')
        + '</div>'
        + '</div>'
        + '</section>';

      // ── TG gate block ──────────────────────────────────────────────────────
      const blockTg = demo ? '' : '<section class="kjr-rc kjr-tg-gate" style="opacity:0;background:linear-gradient(135deg,#1a1830 0%,#0e1225 60%,#0d1520 100%);border-radius:30px;padding:clamp(28px,4vw,48px);text-align:center;border:1px solid rgba(99,102,241,0.18)">'
        + '<div style="display:inline-flex;align-items:center;justify-content:center;width:60px;height:60px;border-radius:18px;background:rgba(99,102,241,0.15);margin-bottom:20px">'
        + '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.02c-.12.57-.46.71-.93.44l-2.58-1.9-1.24 1.2c-.14.14-.26.26-.53.26l.19-2.65 4.84-4.37c.21-.19-.05-.29-.32-.1L7.39 15.1l-2.54-.79c-.55-.17-.56-.55.12-.82l9.94-3.83c.46-.17.86.11.73.14z" fill="#818cf8"/></svg>'
        + '</div>'
        + '<h2 style="font-weight:800;font-size:clamp(24px,3vw,36px);letter-spacing:-0.02em;line-height:1.1;color:#f0edf8">Подпишитесь — и получите полный разбор</h2>'
        + '<p style="margin-top:14px;font-size:16px;line-height:1.65;color:rgba(240,237,248,0.55);max-width:480px;margin-left:auto;margin-right:auto">В канале @thinking_kids — практики по вашему архетипу, разборы ситуаций и материалы для осознанного родительства. Без советов «просто будьте спокойнее».</p>'
        + '<div style="margin-top:28px;display:flex;flex-wrap:wrap;gap:12px;justify-content:center">'
        + '<a href="https://t.me/thinking_kids" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:10px;background:#6366f1;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:14px;text-decoration:none;box-shadow:0 0 28px rgba(99,102,241,0.35)">Подписаться на @thinking_kids →</a>'
        + '</div>'
        + '<p style="margin-top:16px;font-size:12px;color:rgba(240,237,248,0.30)">Полный профиль по 7 шкалам — ниже</p>'
        + '</section>';

      return '<div style="max-width:1080px;margin:0 auto;padding:clamp(28px,4vw,52px) 0 24px;display:flex;flex-direction:column;gap:24px">'
        + block1 + blockTg + block2 + block3 + block4
        + '</div>';
    }


    function methodologyPage() {
      var accData = [
        { title: 'Почему прямых вопросов недостаточно',
          body: '<p style="font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Если спросить родителя «вы поддерживаете самостоятельность ребёнка?», почти каждый ответит «да». Прямые вопросы измеряют идеал, а не поведение.</p>'
              + '<p style="margin-top:14px;font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Под давлением мы действуем не из ценностей, а из автоматики. Поэтому тест ставит вас в конкретные ситуации с дефицитом времени — и смотрит на выбор, а не на декларацию.</p>' },
        { title: 'Из чего состоит один кейс',
          body: '<p style="font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Каждый кейс — это короткая реальная ситуация и пять слоёв реакции:</p>'
              + '<ul style="margin:12px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:9px;font-size:15px;line-height:1.6;color:rgba(26,24,48,0.7)">'
              + '<li>Кейс — что произошло и сколько времени на реакцию</li>'
              + '<li>Выбор — какой из вариантов ближе всего к вашему первому импульсу</li>'
              + '<li>Приоритет — что для вас важнее в этот момент: контакт, правило, результат</li>'
              + '<li>Реплика — что именно вы скажете (в одном из кейсов — своими словами)</li>'
              + '<li>Поворот — как ситуация развивается дальше при вашей реакции</li>'
              + '</ul>' },
        { title: 'Что анализируется',
          body: '<p style="font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Мы не считаем «правильные» ответы — их нет. Анализируется паттерн: к чему вы тяготеете под давлением.</p>'
              + '<ul style="margin:12px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:9px;font-size:15px;line-height:1.6;color:rgba(26,24,48,0.7)">'
              + '<li>Куда смещается ваш фокус — на чувство, правило или эффективность</li>'
              + '<li>Насколько вы оставляете ребёнку пространство выбора</li>'
              + '<li>Как вы переносите напряжение и неопределённость</li>'
              + '<li>Путаете ли вы дискомфорт ребёнка с реальной опасностью</li>'
              + '</ul>' },
        { title: 'Пять вопросов перед реакцией',
          body: '<p style="font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Под каждым кейсом скрыты пять внутренних вопросов, которые формируют профиль:</p>'
              + '<div style="margin-top:14px">'
              + [['1','Взрослость','Кто сейчас отвечает за безопасность и решение?'],
                 ['2','Контакт','Заметил ли я, что чувствует ребёнок?'],
                 ['3','Границы','Моя реакция предсказуема или зависит от настроения?'],
                 ['4','Автономия','Оставил ли я ребёнку хоть какой-то выбор?'],
                 ['5','Риск/труд','Это правда опасно — или просто трудно и неприятно?']].map(function(r) {
                   return '<div style="display:grid;grid-template-columns:40px 160px 1fr;gap:16px;align-items:baseline;padding:14px 0;border-top:1px solid rgba(26,24,48,0.08)">'
                     + '<span style="font-size:20px;font-weight:800;color:#6366f1">' + r[0] + '</span>'
                     + '<span style="font-size:13px;font-weight:700;color:#1a1830">' + r[1] + '</span>'
                     + '<span style="font-size:15px;line-height:1.55;color:rgba(26,24,48,0.7)">' + r[2] + '</span>'
                     + '</div>';
                 }).join('')
              + '</div>' },
      ];
      var scalesData = [
        { num:'01', name:'Ответственность взрослого', desc:'Кто отвечает за безопасность и ключевые решения — и не перекладывается ли это на ребёнка раньше времени.' },
        { num:'02', name:'Эмоциональный контакт', desc:'Насколько родитель замечает и называет чувства ребёнка, прежде чем переходить к решению.' },
        { num:'03', name:'Последовательность границ', desc:'Работают ли правила стабильно или зависят от настроения и усталости взрослого.' },
        { num:'04', name:'Поддержка автономии', desc:'Даёте ли вы ребёнку реальный выбор и пространство для собственных решений внутри ваших рамок.' },
        { num:'05', name:'Толерантность к конфликту', desc:'Как вы переносите напряжение и спор — выдерживаете или спешите снять любой ценой.' },
        { num:'06', name:'Гибкость', desc:'Можете ли вы изменить решение, не воспринимая это как угрозу своему авторитету.' },
        { num:'07', name:'Отличие трудного от опасного', desc:'Различаете ли вы реальную угрозу и просто дискомфорт, непривычность, лень.' },
      ];
      var accordionHTML = accData.map(function(ac, i) {
        return '<div class="kjr-rc" style="opacity:0;background:#f2f1f8;border-radius:24px;border:1px solid rgba(26,24,48,0.06);overflow:hidden;color:#1a1830">'
          + '<div onclick="(function(el){var b=el.nextElementSibling;var open=b.style.maxHeight!==\\x270px\\x27&&b.style.maxHeight!==\\x27\\x27;b.style.maxHeight=open?\\x270px\\x27:(b.scrollHeight+\\x27px\\x27);b.style.opacity=open?\\x270\\x27:\\x271\\x27;el.querySelector(\\x27.macc-arr\\x27).style.transform=open?\\x27rotate(0)\\x27:\\x27rotate(180deg)\\x27})(this)" style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px 28px;cursor:pointer">'
          + '<span style="font-size:clamp(17px,2vw,21px);font-weight:700;letter-spacing:-0.01em">' + escapeHtml(ac.title) + '</span>'
          + '<span class="macc-arr" style="flex:0 0 auto;width:32px;height:32px;border-radius:99px;background:rgba(99,102,241,0.10);color:#6366f1;display:inline-flex;align-items:center;justify-content:center;transition:transform 0.3s ease;font-size:15px">▾</span>'
          + '</div>'
          + '<div style="max-height:' + (i === 0 ? 'none' : '0') + ';opacity:' + (i === 0 ? '1' : '0') + ';overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease">'
          + '<div style="padding:0 28px 28px">' + ac.body + '</div>'
          + '</div></div>';
      }).join('');
      var scalesHTML = scalesData.map(function(s) {
        return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:20px">'
          + '<div style="display:flex;gap:10px;align-items:baseline">'
          + '<span style="font-size:12px;font-weight:800;color:#fb7185">' + s.num + '</span>'
          + '<span style="font-size:16px;font-weight:700;color:#f0edf8">' + escapeHtml(s.name) + '</span>'
          + '</div>'
          + '<p style="margin-top:8px;font-size:13px;line-height:1.6;color:rgba(240,237,248,0.55)">' + escapeHtml(s.desc) + '</p>'
          + '</div>';
      }).join('');

      return '<section id="methodology" style="max-width:880px;margin:0 auto;padding:0 clamp(16px,4vw,40px) 40px">'

        // HERO
        + '<div style="position:relative;padding:clamp(56px,8vw,100px) 0 clamp(40px,5vw,60px);overflow:hidden">'
        + '<div style="position:absolute;width:520px;height:520px;top:-160px;left:-80px;background:radial-gradient(circle,rgba(99,102,241,0.16) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div style="position:relative">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;font-weight:700;color:#fb7185">Методика</div>'
        + '<h1 style="margin-top:16px;font-weight:800;font-size:clamp(34px,5vw,60px);letter-spacing:-0.03em;line-height:1.05">Как мы превращаем шесть ситуаций в профиль решений</h1>'
        + '<p style="margin-top:20px;font-size:17px;line-height:1.7;color:rgba(240,237,248,0.55);max-width:600px">Тест не спрашивает «какой вы родитель» напрямую. Он наблюдает, что вы выбираете под давлением — и собирает из этих выборов профиль по семи шкалам.</p>'
        + '</div></div>'

        // ACCORDIONS
        + '<div style="display:flex;flex-direction:column;gap:14px">' + accordionHTML + '</div>'

        // 7 SCALES
        + '<section class="kjr-rc" style="opacity:0;background:linear-gradient(135deg,#1a1830 0%,#0e1225 50%,#111827 100%);border-radius:24px;padding:clamp(24px,4vw,40px);margin-top:14px">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:#818cf8">7 шкал измерения</div>'
        + '<h2 style="margin-top:10px;font-weight:800;font-size:clamp(22px,2.6vw,32px);letter-spacing:-0.02em;line-height:1.1;color:#f0edf8">Что именно измеряет тест</h2>'
        + '<div class="kjr-scales-grid" style="margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:12px">' + scalesHTML + '</div>'
        + '</section>'

        // CAVEATS
        + '<section class="kjr-rc" style="opacity:0;display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px">'
        + '<div style="background:#f2f1f8;border-left:4px solid #fb7185;border-radius:0 20px 20px 0;padding:24px 28px;color:#1a1830">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#e85f7a">Что этот тест не делает</div>'
        + '<p style="margin-top:12px;font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Тест не ставит диагнозов и не оценивает вас как «хорошего» или «плохого» родителя. Он не заменяет консультацию психолога и не предсказывает поведение ребёнка. Это инструмент саморефлексии, а не клинической диагностики.</p>'
        + '</div>'
        + '<div style="background:#f2f1f8;border-left:4px solid #fb7185;border-radius:0 20px 20px 0;padding:24px 28px;color:#1a1830">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#e85f7a">Почему это не валидированный тест</div>'
        + '<p style="margin-top:12px;font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7)">Методика опирается на признанные психологические концепции, но сама по себе не проходила процедуру научной валидации с выборкой и проверкой надёжности. Это экспериментальный, развивающийся инструмент 2026 года.</p>'
        + '</div>'
        + '</section>'

        + '</section>';
    }

    function aboutPage() {
      var authors = [
        {
          role: 'Автор и продюсер проекта',
          name: 'Галина Яновская',
          imgSrc: '/authors/galina-yanovskaya-circle.png',
          imgAlt: 'Галина Яновская',
          bio: 'Создатель и продюсер проекта «Какой я родитель». Собрала команду, методику и формат теста так, чтобы он говорил с современными работающими родителями на их языке — честно, без морализаторства и чувства вины.',
          facts: ['Автор идеи и формата', 'Продюсирование проекта', 'ООО «Интеллект Университет»'],
          tgLabel: 'Telegram @thinking_kids',
          tgLink: 'https://t.me/thinking_kids',
        },
        {
          role: 'Научно-методический эксперт',
          name: 'Людмила Экхардт',
          imgSrc: '/authors/ludmila-ekhardt-circle.png',
          imgAlt: 'Людмила Экхардт',
          bio: 'Отвечает за научно-методическую основу теста. Перевела академические концепции — теорию привязанности и авторитетного родительства — в живые ситуации и семь рабочих шкал, по которым строится профиль.',
          facts: ['Методология и шкалы', 'Психология развития', 'Научная редактура'],
          tgLabel: 'Telegram',
          tgLink: '#',
        },
      ];
      var authorCards = authors.map(function(a) {
        return '<section class="kjr-rc kjr-author" style="opacity:0;background:#f2f1f8;border-radius:28px;padding:clamp(24px,4vw,40px);color:#1a1830">'
          + '<div style="width:160px;height:160px;border-radius:99px;overflow:hidden;background:linear-gradient(135deg,#e8e6ff,#f0eeff);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          + '<img src="' + escapeHtml(a.imgSrc) + '" alt="' + escapeHtml(a.imgAlt) + '" style="width:100%;height:100%;object-fit:cover" />'
          + '</div>'
          + '<div>'
          + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#6366f1">' + escapeHtml(a.role) + '</div>'
          + '<h2 style="margin-top:8px;font-weight:800;font-size:clamp(24px,3vw,36px);letter-spacing:-0.02em;line-height:1.05">' + escapeHtml(a.name) + '</h2>'
          + '<p style="margin-top:14px;font-size:15px;line-height:1.7;color:rgba(26,24,48,0.7);max-width:480px">' + escapeHtml(a.bio) + '</p>'
          + '<div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:8px">'
          + a.facts.map(function(f){ return '<span style="background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.18);color:#4f46c9;font-size:12px;font-weight:600;border-radius:99px;padding:7px 14px">' + escapeHtml(f) + '</span>'; }).join('')
          + '</div>'
          + '<a href="' + escapeHtml(a.tgLink) + '" target="_blank" rel="noreferrer" style="margin-top:18px;display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#6366f1">' + escapeHtml(a.tgLabel) + ' →</a>'
          + '</div>'
          + '</section>';
      }).join('');

      return '<section id="about" style="max-width:880px;margin:0 auto;padding:0 clamp(16px,4vw,40px) 40px">'

        // HERO
        + '<div style="position:relative;padding:clamp(56px,8vw,100px) 0 clamp(36px,5vw,56px);overflow:hidden">'
        + '<div style="position:absolute;width:520px;height:520px;top:-160px;right:-100px;background:radial-gradient(circle,rgba(251,113,133,0.13) 0%,transparent 70%);pointer-events:none"></div>'
        + '<div style="position:relative">'
        + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;font-weight:700;color:#fb7185">О проекте</div>'
        + '<h1 style="margin-top:16px;font-weight:800;font-size:clamp(34px,5vw,60px);letter-spacing:-0.03em;line-height:1.05">Тест, который делают практики, а не алгоритм</h1>'
        + '<p style="margin-top:20px;font-size:17px;line-height:1.7;color:rgba(240,237,248,0.55);max-width:600px">«Какой я родитель» вырос из живой работы с семьями. Мы хотели инструмент, который не оценивает и не пугает, а помогает родителю на секунду увидеть себя со стороны.</p>'
        + '</div></div>'

        // AUTHOR CARDS
        + '<div style="display:flex;flex-direction:column;gap:20px">' + authorCards + '</div>'

        // CTA
        + '<section class="kjr-rc" style="opacity:0;background:linear-gradient(135deg,#1a1830 0%,#0e1225 50%,#111827 100%);border-radius:28px;padding:clamp(28px,4vw,48px);text-align:center;margin-top:20px">'
        + '<h2 style="font-weight:800;font-size:clamp(22px,2.8vw,34px);letter-spacing:-0.02em;line-height:1.1;color:#f0edf8">Узнайте свой родительский архетип</h2>'
        + '<p style="margin-top:14px;font-size:16px;color:rgba(240,237,248,0.55)">Шесть ситуаций · 10 минут · без регистрации</p>'
        + '<button onclick="start()" style="display:inline-block;margin-top:26px;background:#6366f1;color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;box-shadow:0 0 32px rgba(99,102,241,0.35);border:none;cursor:pointer;font-family:inherit">Пройти тест бесплатно →</button>'
        + '</section>'

        + '</section>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }

    function initHomeGsap() {
      (function() {
        function init() {
          var g = window.gsap;
          if (!g) { setTimeout(init, 120); return; }
          if (window.ScrollTrigger) g.registerPlugin(window.ScrollTrigger);
          var tl = g.timeline();
          tl.fromTo("#kjr-eyebrow",{opacity:0,y:20},{opacity:1,y:0,duration:0.6,ease:"power2.out"},0)
            .fromTo("#kjr-h1",{opacity:0,y:30},{opacity:1,y:0,duration:0.7,ease:"power2.out"},0.15)
            .fromTo("#kjr-lead",{opacity:0,y:20},{opacity:1,y:0,duration:0.6,ease:"power2.out"},0.30)
            .fromTo("#kjr-cta",{opacity:0,scale:0.95},{opacity:1,scale:1,duration:0.6,ease:"power2.out"},0.45)
            .to("#kjr-dots",{opacity:0.6,duration:0.8,ease:"power2.out"},0.60);
          g.utils.toArray(".kjr-card, .kjr-rc").forEach(function(card) {
            g.fromTo(card,{opacity:0,y:40},{opacity:1,y:0,duration:0.7,ease:"power2.out",
              scrollTrigger:{trigger:card,start:"top 88%",once:true}});
          });
          if (window.ScrollTrigger) {
            window.ScrollTrigger.create({trigger:".kjr-bento",start:"top 85%",once:true,onEnter:function() {
              g.fromTo(".kjr-bcell",{opacity:0,y:20},{opacity:1,y:0,duration:0.6,stagger:0.1,ease:"power2.out"});
              var el = document.getElementById("kjr-counter");
              if (el) { var obj = {v:0}; g.to(obj,{v:200,duration:1.5,ease:"power2.out",onUpdate:function(){el.textContent=Math.round(obj.v)+"+";}}) }
            }});
          }
          var hdr = document.querySelector(".kjr-hero");
          if (hdr) { hdr.addEventListener("mousemove",function(e) {
            var r = hdr.getBoundingClientRect(); var dx = (e.clientX-r.left)/r.width-0.5; var dy = (e.clientY-r.top)/r.height-0.5;
            g.to("#kjr-glow1",{x:dx*40,y:dy*40,duration:0.3,ease:"power1.out"});
            g.to("#kjr-glow2",{x:-dx*30,y:-dy*30,duration:0.3,ease:"power1.out"});
          }); }
        }
        init();
      })();
    }

    let _navigating = false;
    function render(scrollToHash) {
      const path = window.location.pathname;
      if (path === "/legal/privacy") { document.getElementById("app").innerHTML = shell(legalPrivacy()); window.scrollTo(0,0); return; }
      if (path === "/legal/consent") { document.getElementById("app").innerHTML = shell(legalConsent()); window.scrollTo(0,0); return; }
      if (path === "/legal/cookies") { document.getElementById("app").innerHTML = shell(legalCookies()); window.scrollTo(0,0); return; }
      if (path === "/legal/company") { document.getElementById("app").innerHTML = shell(legalCompany()); window.scrollTo(0,0); return; }
      document.getElementById("app").innerHTML = home();
      initHomeGsap();
  const hash = scrollToHash || (path.startsWith("/methodology") ? "#methodology" : path.startsWith("/about") ? "#about" : (path.startsWith("/test") || path.startsWith("/result") || path.startsWith("/demo-result")) ? "#test" : "");
  if (hash && _navigating) {
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
      document.querySelectorAll("[data-profile]").forEach(button => button.addEventListener("click", () => {
        if (!state.profile) state.profile = {};
        state.profile[button.dataset.profile] = button.dataset.value;
        saveState();
        render();
      }));
      const ageInput = document.querySelector("[data-profile-age]");
      if (ageInput) ageInput.addEventListener("input", event => {
        if (!state.profile) state.profile = {};
        state.profile.age = event.target.value;
        saveState();
      });
      const profileCancel = document.querySelector("[data-profile-cancel]");
      if (profileCancel) profileCancel.addEventListener("click", () => {
        state = { started: false, index: 0, answers: [] };
        saveState();
        render();
      });
      const profileSubmit = document.querySelector("[data-profile-submit]");
      if (profileSubmit) profileSubmit.addEventListener("click", () => {
        const p = state.profile || {};
        const error = document.getElementById("error");
        if (!p.role || !p.children || !p.gender || !p.age) {
          if (error) error.textContent = "Заполните все поля, чтобы продолжить.";
          return;
        }
        state.profileStep = false;
        saveState();
        render();
        const testEl = document.querySelector("#test");
        if (testEl) setTimeout(() => testEl.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      });
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

    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
    render();

    // ── Cookie banner ───────────────────────────────────────
    (function() {
      const COOKIE_KEY = "rp-cookies-accepted";
      const banner = document.getElementById("cookie-banner");
      if (!banner) return;
      if (!localStorage.getItem(COOKIE_KEY)) banner.style.display = "flex";
      document.getElementById("cookie-accept").addEventListener("click", () => {
        localStorage.setItem(COOKIE_KEY, "1");
        banner.style.display = "none";
      });
      document.getElementById("cookie-link").addEventListener("click", (e) => {
        e.preventDefault();
        navigate("/legal/cookies");
      });
    })();

    // cursor and scroll-progress removed in new design

    // ── Scroll reveal (IntersectionObserver) ───────────────
    function initReveal() {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      document.querySelectorAll(".reveal, .fade-up, .stagger").forEach(el => io.observe(el));
    }
    initReveal();

  </script>
</body>
</html>`;
}

const resultsLogPath = path.join(root, "data", "results.jsonl");

const server = http.createServer((req, res) => {
  if ((req.url.startsWith("/authors/") || req.url.startsWith("/archetype-") || req.url === "/favicon.svg" || req.url === "/favicon.ico") && serveAsset(req, res)) return;
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
          console.log("Sheets: result entry received, sending to sheets...");
          const r = entry.result || {};
          const n = r.normalized || {};
          const sd = k => (n[k]||0) - 50;
          const archetypeScores = {
            director: sd('adultResponsibility')*1.5 + sd('boundariesConsistency')*1 + (-sd('emotionalContact'))*2 + (-sd('conflictTolerance'))*1,
            anchor:   sd('adultResponsibility')*2   + sd('boundariesConsistency')*2 + sd('emotionalContact')*0.5 + (-sd('flexibility'))*0.5,
            mentor:   sd('autonomySupport')*2        + sd('difficultyVsUnsafety')*2  + sd('flexibility')*1,
            guardian: sd('emotionalContact')*1.5    + sd('adultResponsibility')*1    + (-sd('autonomySupport'))*2 + (-sd('difficultyVsUnsafety'))*1,
            partner:  sd('emotionalContact')*2      + sd('flexibility')*1            + (-sd('adultResponsibility'))*2 + (-sd('boundariesConsistency'))*1.5,
            peacemaker: (-sd('conflictTolerance'))*2.5 + (-sd('boundariesConsistency'))*1.5 + sd('emotionalContact')*1.5 + (-sd('adultResponsibility'))*0.5,
          };
          const archetypeKey = Object.entries(archetypeScores).sort((a,b)=>b[1]-a[1])[0][0];
          const prof = entry.profile || {};
          const roleLabels = { mother: "Мать", father: "Отец", grandmother: "Бабушка", grandfather: "Дедушка", stepparent: "Отчим/Мачеха", other: "Другой взрослый" };
          const genderLabels = { boy: "Мальчик", girl: "Девочка" };
          const row = [
            new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
            roleLabels[prof.role] || "", genderLabels[prof.gender] || "", prof.age || "", prof.children || "",
            archetypeKey,
            r.strongest || "", r.second || "", r.attention || "",
            n.adultResponsibility || "", n.emotionalContact || "", n.boundariesConsistency || "",
            n.autonomySupport || "", n.conflictTolerance || "", n.flexibility || "",
            n.difficultyVsUnsafety || "",
            "сайт"
          ];
          appendToSheet(row).catch(e => console.error("Sheets error:", e.message));

          // Analyze open text answers with Gemini
          const textAnswers = (entry.answers || [])
            .filter(a => a.textAnswer && a.textAnswer.trim().length >= 10)
            .map(a => a.textAnswer.trim());
          if (textAnswers.length > 0) {
            analyzeWithGemini(textAnswers).then(analysis => {
              if (analysis) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, textAnalysis: analysis }));
              } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
              }
            }).catch(() => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            });
            return; // response sent async
          }
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

// Telegram-бот (воронка 1) — в том же процессе
import("./telegram-bot.mjs").then(({ startTelegramBot }) => {
  startTelegramBot({ appendToSheet });
}).catch(e => console.error("Telegram bot failed to start:", e.message));
