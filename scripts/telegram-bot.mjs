// Telegram-бот «Какой я родитель» — воронка 1
// Запускается из recovery-server.mjs (тот же процесс на Railway).

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL || ""; // напр. @kakoy_roditel — для гейта подписки
const SITE = process.env.PUBLIC_SITE_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "https://parental-test-production.up.railway.app");
const BOT_USERNAME_ENV = process.env.TELEGRAM_BOT_USERNAME || ""; // напр. kakoy_roditel_bot
const API = `https://api.telegram.org/bot${TOKEN}`;

const SCALES = ["adultResponsibility","emotionalContact","boundariesConsistency","autonomySupport","conflictTolerance","flexibility","difficultyVsUnsafety"];

const ROLE_LABELS = { mother:"Мать", father:"Отец", grandmother:"Бабушка", grandfather:"Дедушка", stepparent:"Отчим/Мачеха", other:"Другой взрослый" };
const GENDER_LABELS = { boy:"Мальчик", girl:"Девочка" };

const ARCH = {
  director: {
    name: "Дирижёр", img: "archetype-director.png",
    tagline: "Всегда в образе, всё под контролем",
    relief: "Ваша система работает: ребёнок в безопасности, всё спланировано. Добавьте 5 минут в день, когда вы не организуете — просто рядом, без повестки.",
    strength: "Вы создаёте предсказуемость и структуру.",
    growth: "Эмоциональное присутствие без задачи.",
  },
  anchor: {
    name: "Опора", img: "archetype-anchor.png",
    tagline: "Тащите всё на себе",
    relief: "Вы держите семью — огромная работа, которую никто не видит. Учитесь говорить «мне нужна пауза» раньше, чем взорвётесь.",
    strength: "Вы держите структуру и берёте ответственность.",
    growth: "Разрешить себе не быть опорой 24/7.",
  },
  mentor: {
    name: "Наставник", img: "archetype-mentor.png",
    tagline: "Растите человека, который справится сам",
    relief: "Вы даёте ребёнку то, что даст ему жизнь — опыт справляться. Добавьте ощущение, что вы рядом даже когда не вмешиваетесь.",
    strength: "Вы видите ресурс в трудностях и не спасаете лишний раз.",
    growth: "Контакт — не урок, а просто быть рядом.",
  },
  guardian: {
    name: "Защитник", img: "archetype-guardian.png",
    tagline: "Любите так сильно, что тревожно",
    relief: "Ваша любовь огромна. Научитесь различать «мне страшно» и «ему реально опасно» — и отношения изменятся быстро.",
    strength: "Вы глубоко чувствуете ребёнка.",
    growth: "Доверять ему право на собственный опыт.",
  },
  partner: {
    name: "Партнёр", img: "archetype-partner.png",
    tagline: "Вы скорее друг, чем родитель",
    relief: "Ваш контакт — то, через что пройдут все важные разговоры. Нужна одна граница, которую вы держите молча, без переговоров.",
    strength: "Ребёнку с вами безопасно и тепло.",
    growth: "Удерживать границу, даже когда некомфортно.",
  },
  peacemaker: {
    name: "Миротворец", img: "archetype-peacemaker.png",
    tagline: "Ссора для вас невыносима",
    relief: "У вас огромная чувствительность. Ловушка: уступая ради тишины, вы учите ребёнка, что давление работает. Досидите в его недовольстве на 30 секунд дольше.",
    strength: "Вы тонко чувствуете состояние ребёнка.",
    growth: "Выдерживать недовольство, не отменяя договорённость.",
  },
};

const W = o => { const w = {}; for (const k of SCALES) w[k] = o[k] || 0; return w; };

const QUESTIONS = [
  {
    prompt: "Ребёнок отказывается делать то, о чём вы договорились: «не хочу, и всё». Ваш первый ход?",
    options: [
      { label: "Напомню договорённость и помогу начать — но отменять не буду", w: W({ adultResponsibility:2, boundariesConsistency:3, conflictTolerance:2, emotionalContact:-1 }) },
      { label: "Сначала пойму, что с ним, потом решу", w: W({ emotionalContact:3, flexibility:1, difficultyVsUnsafety:1 }) },
      { label: "Лишь бы не скандал — предложу компромисс или уступлю", w: W({ conflictTolerance:-3, boundariesConsistency:-2, emotionalContact:1 }) },
      { label: "Это его дело — пусть сам решает и отвечает", w: W({ autonomySupport:3, adultResponsibility:-2 }) },
    ],
  },
  {
    prompt: "Что вам ближе в воспитании?",
    options: [
      { label: "Чёткий режим и предсказуемость", w: W({ adultResponsibility:2, boundariesConsistency:2, emotionalContact:-1 }) },
      { label: "Тёплые близкие отношения важнее правил", w: W({ emotionalContact:3, boundariesConsistency:-2, adultResponsibility:-1 }) },
      { label: "Научить справляться самому", w: W({ autonomySupport:3, difficultyVsUnsafety:2, flexibility:1 }) },
      { label: "Уберечь от всего, что может навредить", w: W({ emotionalContact:1, autonomySupport:-3, difficultyVsUnsafety:-2 }) },
    ],
  },
  {
    prompt: "Ребёнок плачет или злится из-за вашего «нет». Что внутри сильнее?",
    options: [
      { label: "Держусь линии, недовольство выдержу", w: W({ conflictTolerance:3, boundariesConsistency:2 }) },
      { label: "Очень тяжело видеть его таким, хочется всё исправить", w: W({ conflictTolerance:-3, emotionalContact:2 }) },
      { label: "Объясняю причину снова и снова", w: W({ adultResponsibility:1, emotionalContact:1, boundariesConsistency:1 }) },
      { label: "Даю ему самому справиться с эмоцией", w: W({ autonomySupport:2, emotionalContact:-1 }) },
    ],
  },
  {
    prompt: "Ребёнок взялся за трудное дело и расстроен, что не получается.",
    options: [
      { label: "Разобью на шаги, но делать будет сам", w: W({ adultResponsibility:2, autonomySupport:2, emotionalContact:1 }) },
      { label: "Помогу или сделаю часть, чтобы не мучился", w: W({ emotionalContact:1, autonomySupport:-2, conflictTolerance:-1 }) },
      { label: "Скажу, что трудности — это нормально и полезно", w: W({ difficultyVsUnsafety:2, autonomySupport:1, flexibility:1 }) },
      { label: "Прослежу, чтобы довёл до конца", w: W({ boundariesConsistency:2, adultResponsibility:1, autonomySupport:-2 }) },
    ],
  },
  {
    prompt: "Узнали, что ребёнку плохо в секции или школе — кто-то его обижает.",
    options: [
      { label: "Поставлю на паузу, разберусь, потом решу", w: W({ adultResponsibility:2, flexibility:3, difficultyVsUnsafety:3 }) },
      { label: "Сразу заберу и защищу", w: W({ difficultyVsUnsafety:2, autonomySupport:-2, emotionalContact:1 }) },
      { label: "Скажу, что надо учиться давать отпор", w: W({ conflictTolerance:2, emotionalContact:-2, difficultyVsUnsafety:-3 }) },
      { label: "Спрошу, как он сам хочет поступить", w: W({ autonomySupport:3, adultResponsibility:-1 }) },
    ],
  },
  {
    prompt: "Если честно, моя слабая зона как родителя — это…",
    options: [
      { label: "Слишком контролирую, мало тепла", w: W({ emotionalContact:-2, boundariesConsistency:1, adultResponsibility:1 }) },
      { label: "Трудно выдерживать конфликт, я уступаю", w: W({ conflictTolerance:-3, boundariesConsistency:-2 }) },
      { label: "Слишком тревожусь и опекаю", w: W({ autonomySupport:-2, difficultyVsUnsafety:-2, emotionalContact:1 }) },
      { label: "Мало структуры, мы скорее друзья", w: W({ adultResponsibility:-2, boundariesConsistency:-2, emotionalContact:2 }) },
    ],
  },
];

// Precompute min/max per scale across all questions
const MIN = {}, MAX = {};
for (const k of SCALES) { MIN[k] = 0; MAX[k] = 0; }
for (const q of QUESTIONS) for (const k of SCALES) {
  const vals = q.options.map(o => o.w[k]);
  MIN[k] += Math.min(...vals); MAX[k] += Math.max(...vals);
}

function computeArchetype(answers) {
  const raw = {}; for (const k of SCALES) raw[k] = 0;
  answers.forEach((optIdx, qIdx) => { for (const k of SCALES) raw[k] += QUESTIONS[qIdx].options[optIdx].w[k]; });
  const n = {};
  for (const k of SCALES) { const range = MAX[k] - MIN[k]; n[k] = range === 0 ? 50 : Math.round(((raw[k] - MIN[k]) / range) * 100); }
  const d = k => n[k] - 50;
  const scores = {
    director: d('adultResponsibility')*1.5 + d('boundariesConsistency')*1 + (-d('emotionalContact'))*2 + (-d('conflictTolerance'))*1,
    anchor:   d('adultResponsibility')*2   + d('boundariesConsistency')*2 + d('emotionalContact')*0.5 + (-d('flexibility'))*0.5,
    mentor:   d('autonomySupport')*2        + d('difficultyVsUnsafety')*2  + d('flexibility')*1,
    guardian: d('emotionalContact')*1.5    + d('adultResponsibility')*1    + (-d('autonomySupport'))*2 + (-d('difficultyVsUnsafety'))*1,
    partner:  d('emotionalContact')*2      + d('flexibility')*1            + (-d('adultResponsibility'))*2 + (-d('boundariesConsistency'))*1.5,
    peacemaker: (-d('conflictTolerance'))*2.5 + (-d('boundariesConsistency'))*1.5 + d('emotionalContact')*1.5 + (-d('adultResponsibility'))*0.5,
  };
  const key = Object.entries(scores).sort((a,b) => b[1]-a[1])[0][0];
  return { key, normalized: n };
}

async function tg(method, params) {
  try {
    const res = await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
    return await res.json();
  } catch (e) { console.error("TG error", method, e.message); return { ok: false }; }
}

const sessions = new Map(); // chatId -> { stage, profile, answers, msgId }

function kb(rows) { return { inline_keyboard: rows }; }

function roleStep() {
  return {
    text: "👋 Это тест «Какой я родитель».\n\nЗа 6 коротких вопросов вы узнаете свой родительский архетип — и какую стратегию выбираете под давлением.\n\nСначала пара слов о вас.\n\n<b>Кто вы ребёнку?</b>",
    keyboard: kb([
      [{ text: "Мать", callback_data: "role:mother" }, { text: "Отец", callback_data: "role:father" }],
      [{ text: "Бабушка", callback_data: "role:grandmother" }, { text: "Дедушка", callback_data: "role:grandfather" }],
      [{ text: "Отчим / Мачеха", callback_data: "role:stepparent" }, { text: "Другой", callback_data: "role:other" }],
    ]),
  };
}
function genderStep() {
  return { text: "<b>Пол ребёнка?</b>\n<i>Если детей несколько — думайте о том, с кем сейчас сложнее всего.</i>", keyboard: kb([[{ text: "Мальчик", callback_data: "gender:boy" }, { text: "Девочка", callback_data: "gender:girl" }]]) };
}
function ageStep() {
  return { text: "<b>Возраст ребёнка?</b>", keyboard: kb([
    [{ text: "до 6", callback_data: "age:0-5" }, { text: "6–9", callback_data: "age:6-9" }],
    [{ text: "10–12", callback_data: "age:10-12" }, { text: "13–17", callback_data: "age:13-17" }],
    [{ text: "18+", callback_data: "age:18+" }],
  ]) };
}
function questionStep(i) {
  const q = QUESTIONS[i];
  return { text: `<b>Вопрос ${i+1} из ${QUESTIONS.length}</b>\n\n${q.prompt}`, keyboard: kb(q.options.map((o, idx) => [{ text: o.label, callback_data: `q:${i}:${idx}` }])) };
}
function gateStep() {
  const rows = [];
  if (CHANNEL) rows.push([{ text: "📢 Подписаться на канал", url: `https://t.me/${CHANNEL.replace("@","")}` }]);
  rows.push([{ text: "✅ Я подписался — показать результат", callback_data: "check" }]);
  return { text: "Готово! Ваш архетип посчитан.\n\nЧтобы открыть результат — подпишитесь на канал <b>«Галина Яновская — дети и образование»</b>. Там разборы реальных ситуаций и фразы для разговора с ребёнком.", keyboard: kb(rows) };
}

async function isSubscribed(userId) {
  if (!CHANNEL) return true; // гейт выключен, если канал не задан
  const res = await tg("getChatMember", { chat_id: CHANNEL, user_id: userId });
  const status = res?.result?.status;
  return status && !["left", "kicked"].includes(status);
}

async function sendResult(chatId, s, appendToSheet) {
  const { key, normalized } = computeArchetype(s.answers);
  const a = ARCH[key];
  const botUser = BOT_USERNAME_ENV || (s.botUsername || "");
  const shareUrl = botUser ? `https://t.me/${botUser}` : SITE;
  const caption = `🎭 Ваш архетип: <b>${a.name}</b>\n<i>${a.tagline}</i>\n\n${a.relief}\n\n💪 <b>Сила:</b> ${a.strength}\n🌱 <b>Зона роста:</b> ${a.growth}`;
  const buttons = kb([
    [{ text: "🔎 Полный разбор по 7 шкалам", url: SITE }],
    [{ text: "👥 А ваш партнёр какой? Отправить тест", url: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("Прошла тест «Какой я родитель» — узнай и ты свой архетип:")}` }],
  ]);
  await tg("sendPhoto", { chat_id: chatId, photo: `${SITE}/${a.img}`, caption, parse_mode: "HTML", reply_markup: buttons });

  // Запись в Google Sheets (тот же формат колонок, что и сайт)
  if (typeof appendToSheet === "function") {
    const n = normalized;
    const row = [
      new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
      ROLE_LABELS[s.profile.role] || "", GENDER_LABELS[s.profile.gender] || "", s.profile.age || "", "",
      key, "", "", "",
      n.adultResponsibility, n.emotionalContact, n.boundariesConsistency,
      n.autonomySupport, n.conflictTolerance, n.flexibility, n.difficultyVsUnsafety,
      "бот",
    ];
    appendToSheet(row).catch(e => console.error("Bot→Sheets error:", e.message));
  }
  s.stage = "done";
}

async function editOrSend(chatId, s, step, parseHtml = true) {
  const params = { chat_id: chatId, text: step.text, reply_markup: step.keyboard, parse_mode: "HTML" };
  if (s.msgId) {
    const res = await tg("editMessageText", { ...params, message_id: s.msgId });
    if (res.ok) return;
  }
  const res = await tg("sendMessage", params);
  if (res.ok) s.msgId = res.result.message_id;
}

export function startTelegramBot(deps = {}) {
  if (!TOKEN) { console.log("Telegram: TELEGRAM_BOT_TOKEN не задан — бот не запущен"); return; }
  const appendToSheet = deps.appendToSheet;
  console.log("Telegram: бот запущен (long polling)");

  let offset = 0;
  let botUsername = BOT_USERNAME_ENV;
  tg("getMe").then(r => { if (r?.result?.username) { botUsername = r.result.username; console.log("Telegram: @" + botUsername); } });

  async function loop() {
    while (true) {
      try {
        const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`);
        const data = await res.json();
        if (!data.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          try { await handleUpdate(upd, appendToSheet, botUsername); } catch (e) { console.error("Telegram handle error:", e.message); }
        }
      } catch (e) {
        console.error("Telegram poll error:", e.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  loop();
}

async function handleUpdate(upd, appendToSheet, botUsername) {
  // /start
  if (upd.message && upd.message.text) {
    const chatId = upd.message.chat.id;
    if (upd.message.text.startsWith("/start")) {
      const s = { stage: "role", profile: {}, answers: [], msgId: null, botUsername };
      sessions.set(chatId, s);
      await editOrSend(chatId, s, roleStep());
    }
    return;
  }

  // Кнопки
  if (upd.callback_query) {
    const cq = upd.callback_query;
    const chatId = cq.message.chat.id;
    const userId = cq.from.id;
    const data = cq.data;
    let s = sessions.get(chatId);
    if (!s) { s = { stage: "role", profile: {}, answers: [], msgId: cq.message.message_id, botUsername }; sessions.set(chatId, s); }
    if (!s.msgId) s.msgId = cq.message.message_id;
    s.botUsername = botUsername;
    await tg("answerCallbackQuery", { callback_query_id: cq.id });

    if (data.startsWith("role:")) { s.profile.role = data.split(":")[1]; s.stage = "gender"; await editOrSend(chatId, s, genderStep()); return; }
    if (data.startsWith("gender:")) { s.profile.gender = data.split(":")[1]; s.stage = "age"; await editOrSend(chatId, s, ageStep()); return; }
    if (data.startsWith("age:")) { s.profile.age = data.split(":")[1]; s.stage = "q0"; s.answers = []; await editOrSend(chatId, s, questionStep(0)); return; }
    if (data.startsWith("q:")) {
      const [, qi, oi] = data.split(":");
      s.answers[Number(qi)] = Number(oi);
      const next = Number(qi) + 1;
      if (next < QUESTIONS.length) { await editOrSend(chatId, s, questionStep(next)); }
      else { await editOrSend(chatId, s, gateStep()); s.stage = "gate"; }
      return;
    }
    if (data === "check") {
      const ok = await isSubscribed(userId);
      if (!ok) {
        await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Похоже, подписки пока нет. Подпишитесь и нажмите ещё раз.", show_alert: true });
        return;
      }
      // Убираем гейт-сообщение и шлём результат
      await tg("deleteMessage", { chat_id: chatId, message_id: s.msgId }).catch(() => {});
      s.msgId = null;
      await sendResult(chatId, s, appendToSheet);
      return;
    }
  }
}
