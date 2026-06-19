import type { ScaleKey } from "@/lib/types";

export type ReactionQuestion = {
  id: string;
  number: number;
  title: string;
  text: string;
  scaleKey: ScaleKey;
  sourceHint: string;
};

export const reactionQuestions: ReactionQuestion[] = [
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

export const reactionQuestionByScale: Partial<Record<ScaleKey, ReactionQuestion>> = {
  adultResponsibility: reactionQuestions[0],
  difficultyVsUnsafety: reactionQuestions[0],
  emotionalContact: reactionQuestions[1],
  autonomySupport: reactionQuestions[2],
  boundariesConsistency: reactionQuestions[3],
  conflictTolerance: reactionQuestions[4],
  flexibility: reactionQuestions[0]
};

export function reactionQuestionForScale(key?: ScaleKey): ReactionQuestion {
  return (key && reactionQuestionByScale[key]) || reactionQuestions[0];
}
