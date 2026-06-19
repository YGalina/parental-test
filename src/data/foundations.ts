import type { ScaleKey } from "@/lib/types";

export const scientificFoundations = [
  {
    title: "Авторитетное родительство: тепло плюс требовательность",
    shortTitle: "тепло и границы",
    description:
      "Шкалы контакта, границ и взрослой ответственности опираются на идею, что родительская позиция держится не на мягкости или строгости по отдельности, а на сочетании отклика и ясных ожиданий.",
    sourceLabel: "Diana Baumrind, parenting styles",
    href: "https://en.wikipedia.org/wiki/Parenting_styles"
  },
  {
    title: "Теория самодетерминации: автономия, компетентность, связанность",
    shortTitle: "автономия без брошенности",
    description:
      "Шкала поддержки самостоятельности проверяет не свободу без рамок, а такую зону выбора, где ребенок сохраняет связь со взрослым, чувствует посильность задачи и постепенно присваивает ответственность.",
    sourceLabel: "Self-Determination Theory",
    href: "https://selfdeterminationtheory.org/theory/"
  },
  {
    title: "Скаффолдинг и зона ближайшего развития",
    shortTitle: "помощь без спасательства",
    description:
      "В кейсах про учебу и обязанности важно отличить поддержку шага от выполнения за ребенка: взрослый временно помогает удержать задачу, но не забирает ее полностью.",
    sourceLabel: "Vygotsky, Bruner, Wood & Ross",
    href: "https://en.wikipedia.org/wiki/Instructional_scaffolding"
  },
  {
    title: "Эмоциональная социализация и emotion coaching",
    shortTitle: "чувство не отменяет правило",
    description:
      "Открытые реплики анализируются на способность сначала признать состояние ребенка, а затем назвать границу или следующий шаг без угроз, стыда и обесценивания.",
    sourceLabel: "Gottman Institute",
    href: "https://www.gottman.com/blog/an-introduction-to-emotion-coaching/"
  },
  {
    title: "Исполнительные функции и развитие саморегуляции",
    shortTitle: "ребенок еще учится управлять собой",
    description:
      "В интерпретации учитывается, что ребенок 6-17 лет не всегда может сам оценить последствия, распределить усилия и удержать долгосрочную цель без взрослой опоры.",
    sourceLabel: "Center on the Developing Child, Harvard",
    href: "https://developingchild.harvard.edu/resource-guides/guide-executive-function/"
  }
];

export type LearningMaterial = {
  title: string;
  author: string;
  format: "книга" | "статья" | "подборка" | "сайт";
  why: string;
  href?: string;
  scaleKeys: ScaleKey[];
};

export const learningMaterials: LearningMaterial[] = [
  {
    title: "How to Talk So Kids Will Listen & Listen So Kids Will Talk",
    author: "Adele Faber, Elaine Mazlish",
    format: "книга",
    why: "Для случаев, где нужно соединить признание чувств, ясную просьбу и конкретную фразу без морализации.",
    scaleKeys: ["emotionalContact", "boundariesConsistency", "conflictTolerance"]
  },
  {
    title: "Self-Determination Theory: обзор теории",
    author: "Center for Self-Determination Theory",
    format: "сайт",
    why: "Про автономию, компетентность и связанность: помогает не путать самостоятельность с тем, что ребенка оставили разбираться одного.",
    href: "https://selfdeterminationtheory.org/theory/",
    scaleKeys: ["autonomySupport", "adultResponsibility"]
  },
  {
    title: "An Introduction to Emotion Coaching",
    author: "The Gottman Institute",
    format: "статья",
    why: "Для ситуаций, где ребенок злится, отказывается или разочарован, а взрослому нужно не обесценить эмоцию и не потерять рамку.",
    href: "https://www.gottman.com/blog/an-introduction-to-emotion-coaching/",
    scaleKeys: ["emotionalContact", "conflictTolerance"]
  },
  {
    title: "The Explosive Child",
    author: "Ross W. Greene",
    format: "книга",
    why: "Про совместное решение проблем и поиск недостающих навыков за сложным поведением, без автоматического перехода к наказанию.",
    scaleKeys: ["flexibility", "difficultyVsUnsafety", "emotionalContact"]
  },
  {
    title: "A Guide to Executive Function",
    author: "Center on the Developing Child, Harvard",
    format: "подборка",
    why: "Помогает понять, почему ребенок может не удерживать план, срок и усилие так же, как взрослый.",
    href: "https://developingchild.harvard.edu/resource-guides/guide-executive-function/",
    scaleKeys: ["adultResponsibility", "autonomySupport"]
  },
  {
    title: "Positive Discipline",
    author: "Jane Nelsen",
    format: "книга",
    why: "Для баланса уважения, договоренностей и последствий без угроз и унижения.",
    scaleKeys: ["boundariesConsistency", "conflictTolerance", "adultResponsibility"]
  },
  {
    title: "Mindset",
    author: "Carol S. Dweck",
    format: "книга",
    why: "Для кейсов про плохой результат, олимпиаду, спорт и страх ошибки: как говорить о процессе без обесценивания разочарования.",
    scaleKeys: ["emotionalContact", "flexibility", "difficultyVsUnsafety"]
  }
];

export function materialsForScales(keys: ScaleKey[], limit = 4): LearningMaterial[] {
  const ranked = learningMaterials
    .map((material) => ({
      material,
      score: material.scaleKeys.reduce((sum, key) => sum + (keys.includes(key) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = ranked.map((item) => item.material);
  if (selected.length > 0) {
    return selected.slice(0, limit);
  }

  return learningMaterials.slice(0, limit);
}
