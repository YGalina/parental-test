import type { ScaleWeights, TestCase } from "@/lib/types";
import { emptyWeights } from "@/lib/types";

const w = (weights: Partial<ScaleWeights>): ScaleWeights => ({ ...emptyWeights, ...weights });

export const TEST_VERSION = {
  id: "rp-v1",
  title: "Родительская позиция: апробация MVP",
  status: "published" as const
};

export const testCases: TestCase[] = [
  {
    id: "sport",
    slug: "sportivnaya-sekciya",
    title: "Спортивная секция",
    childAge: 11,
    scenario:
      "Ребенку 11 лет. Он девять месяцев занимается плаванием. Сначала ходил охотно, но последние три недели просит пропускать тренировки. Сегодня говорит: «Я больше туда не пойду. У меня хуже всех получается». До тренировки 40 минут.",
    checks: ["эмоциональный контакт", "удержание договоренности", "различение трудности и небезопасной среды", "гибкость"],
    questions: [
      {
        id: "sport-action",
        type: "action",
        prompt: "Что вы сделаете в первую очередь?",
        options: [
          {
            id: "sport-action-talk-go",
            label: "Коротко поговорю, признаю, что ему тяжело, и предложу все равно поехать сегодня, а после тренировки спокойно решить, что дальше.",
            rationale: "Сохраняет договоренность и контакт, но может недооценить глубину причины.",
            weights: w({ adultResponsibility: 2, emotionalContact: 2, boundariesConsistency: 2, conflictTolerance: 2, difficultyVsUnsafety: 1 })
          },
          {
            id: "sport-action-skip-investigate",
            label: "Разрешу пропустить тренировку и сегодня же разберусь, что именно происходит в группе и с тренером.",
            rationale: "Хорошо проверяет безопасность, но может быстро отменять договоренность.",
            weights: w({ emotionalContact: 2, flexibility: 2, difficultyVsUnsafety: 3, boundariesConsistency: -1 })
          },
          {
            id: "sport-action-insist",
            label: "Скажу, что бросать из-за неудач нельзя, и отвезу на тренировку без долгих обсуждений.",
            rationale: "Удерживает усилие, но рискует пропустить состояние ребенка.",
            weights: w({ adultResponsibility: 2, boundariesConsistency: 3, conflictTolerance: 2, emotionalContact: -2, difficultyVsUnsafety: -1 })
          },
          {
            id: "sport-action-child-decides",
            label: "Скажу, что это его занятие и он может сам решить, продолжать или нет.",
            rationale: "Дает автономию, но для 11 лет может передать ребенку слишком большой вес решения.",
            weights: w({ autonomySupport: 3, adultResponsibility: -2, boundariesConsistency: -1, emotionalContact: 1 })
          }
        ]
      },
      {
        id: "sport-priority",
        type: "priority",
        prompt: "Что для вас сейчас важнее всего?",
        options: [
          { id: "sport-priority-trust", label: "Сохранить доверие и понять причину отказа.", rationale: "Контакт до решения.", weights: w({ emotionalContact: 3, difficultyVsUnsafety: 1 }) },
          { id: "sport-priority-contract", label: "Выполнить договоренность хотя бы на сегодня.", rationale: "Последовательность и устойчивость правил.", weights: w({ boundariesConsistency: 3, conflictTolerance: 2 }) },
          { id: "sport-priority-safety", label: "Проверить, не стало ли в секции небезопасно.", rationale: "Различение трудности и среды.", weights: w({ difficultyVsUnsafety: 3, adultResponsibility: 1 }) },
          { id: "sport-priority-choice", label: "Дать ребенку право решить, хочет ли он продолжать.", rationale: "Самостоятельность с риском раннего ухода.", weights: w({ autonomySupport: 3, adultResponsibility: -1 }) }
        ]
      },
      {
        id: "sport-open",
        type: "open",
        prompt: "Напишите первые две фразы, которые вы скажете ребенку.",
        helper: "Не указывайте имена и другие личные данные ребенка.",
        minLength: 15,
        maxLength: 400
      },
      {
        id: "sport-twist",
        type: "twist",
        prompt: "Позже вы узнали, что тренер публично сравнивал ребенка с другими и называл его последним. Что вы сделаете теперь?",
        options: [
          { id: "sport-twist-pause-talk", label: "Поставлю тренировки на паузу, поговорю с тренером и ребенком, затем решу, можно ли возвращаться.", rationale: "Проверка среды без автоматического отказа от спорта.", weights: w({ adultResponsibility: 3, emotionalContact: 2, flexibility: 3, difficultyVsUnsafety: 3 }) },
          { id: "sport-twist-leave", label: "Сразу заберу ребенка из этой группы и начну искать другой формат занятий.", rationale: "Быстро защищает, но может не собрать всю картину.", weights: w({ adultResponsibility: 2, emotionalContact: 2, flexibility: 2, difficultyVsUnsafety: 3, boundariesConsistency: -1 }) },
          { id: "sport-twist-endure", label: "Объясню, что в спорте критика бывает жесткой, и предложу учиться выдерживать ее.", rationale: "Тренирует устойчивость, но может нормализовать унижение.", weights: w({ conflictTolerance: 3, boundariesConsistency: 1, emotionalContact: -2, difficultyVsUnsafety: -3 }) },
          { id: "sport-twist-child", label: "Спрошу ребенка, хочет ли он сам поговорить с тренером или уйти.", rationale: "Уважает голос ребенка, но может оставить взрослую защиту на нем.", weights: w({ autonomySupport: 3, emotionalContact: 1, adultResponsibility: -1, difficultyVsUnsafety: 1 }) }
        ]
      }
    ]
  },
  {
    id: "homework",
    slug: "domashnee-zadanie",
    title: "Домашнее задание",
    childAge: 9,
    scenario:
      "Ребенок 9 лет больше часа сидит над заданием. Он отвлекается, злится и просит вас сделать часть работы за него.",
    checks: ["поддержка без спасательства", "передача ответственности", "реакция на фрустрацию", "разбиение задачи на шаги"],
    questions: [
      {
        id: "homework-action",
        type: "action",
        prompt: "Как вы поступите сейчас?",
        options: [
          { id: "homework-action-steps", label: "Сделаю паузу на 10 минут, потом помогу разбить задание на маленькие шаги, но писать ответы он будет сам.", rationale: "Поддерживает и не забирает ответственность.", weights: w({ adultResponsibility: 2, emotionalContact: 2, autonomySupport: 2, boundariesConsistency: 1 }) },
          { id: "homework-action-do-part", label: "Сделаю самую сложную часть, чтобы он увидел пример и наконец закончил.", rationale: "Снижает перегруз, но может закрепить ожидание спасения.", weights: w({ emotionalContact: 1, adultResponsibility: -1, autonomySupport: -2, conflictTolerance: -1 }) },
          { id: "homework-action-stop", label: "Скажу, что если не делает, пусть идет в школу без задания и объясняет учителю.", rationale: "Передает последствия, но может оставить ребенка без нужной помощи.", weights: w({ autonomySupport: 2, conflictTolerance: 2, emotionalContact: -1, adultResponsibility: -1 }) },
          { id: "homework-action-sit-control", label: "Сяду рядом и буду контролировать каждый пункт, пока задание не будет готово.", rationale: "Повышает шанс результата, но снижает самостоятельность.", weights: w({ adultResponsibility: 1, boundariesConsistency: 2, autonomySupport: -2, emotionalContact: -1 }) }
        ]
      },
      {
        id: "homework-priority",
        type: "priority",
        prompt: "Что сейчас важнее всего?",
        options: [
          { id: "homework-priority-understand", label: "Понять, где именно он застрял.", rationale: "Диагностика трудности.", weights: w({ emotionalContact: 2, adultResponsibility: 2, difficultyVsUnsafety: 1 }) },
          { id: "homework-priority-own", label: "Сохранить его ответственность за работу.", rationale: "Без спасательства.", weights: w({ autonomySupport: 3, boundariesConsistency: 1 }) },
          { id: "homework-priority-finish", label: "Довести задание до конца сегодня.", rationale: "Результат важнее процесса.", weights: w({ boundariesConsistency: 2, adultResponsibility: 1, autonomySupport: -1 }) },
          { id: "homework-priority-calm", label: "Сначала снизить злость и усталость.", rationale: "Контакт с состоянием.", weights: w({ emotionalContact: 3, flexibility: 1 }) }
        ]
      },
      {
        id: "homework-open",
        type: "open",
        prompt: "Напишите, что вы скажете ребенку в этот момент.",
        helper: "Не указывайте имена и другие личные данные ребенка.",
        minLength: 15,
        maxLength: 400
      },
      {
        id: "homework-twist",
        type: "twist",
        prompt: "На следующий день выясняется, что ребенок не понял базовую тему, на которой построено все задание. Что меняется в вашем решении?",
        options: [
          { id: "homework-twist-teach", label: "Вернусь к базовой теме и договорюсь с учителем или репетитором о способе догнать материал.", rationale: "Отделяет лень от непонимания.", weights: w({ adultResponsibility: 3, emotionalContact: 2, flexibility: 3, difficultyVsUnsafety: 2 }) },
          { id: "homework-twist-same", label: "Оставлю прежнюю линию: он должен был сказать раньше, теперь пусть отвечает за последствия.", rationale: "Последовательность, но мало гибкости к новой информации.", weights: w({ boundariesConsistency: 3, conflictTolerance: 2, flexibility: -2, emotionalContact: -1 }) },
          { id: "homework-twist-do-more", label: "Начну сильнее помогать с домашкой, пока не убедюсь, что тема понята.", rationale: "Поддержка, но риск гиперконтроля.", weights: w({ adultResponsibility: 2, emotionalContact: 1, autonomySupport: -2, flexibility: 1 }) },
          { id: "homework-twist-child-plan", label: "Предложу ребенку самому выбрать, как он будет разбираться: со мной, учителем или по видео.", rationale: "Автономия в рамках взрослой поддержки.", weights: w({ autonomySupport: 3, adultResponsibility: 1, flexibility: 2 }) }
        ]
      }
    ]
  },
  {
    id: "phone",
    slug: "telefon-nochyu",
    title: "Телефон ночью",
    childAge: 17,
    scenario:
      "Подросток 17 лет несколько раз нарушает договоренность и пользуется телефоном после полуночи. Утром ему трудно вставать в школу.",
    checks: ["границы", "последовательность", "естественные последствия", "уважение к самостоятельности подростка"],
    questions: [
      {
        id: "phone-action",
        type: "action",
        prompt: "Что вы сделаете после очередного нарушения?",
        options: [
          { id: "phone-action-charge", label: "Напомню о договоренности и на неделю перенесу зарядку телефона в общую комнату.", rationale: "Конкретное последствие без унижения.", weights: w({ adultResponsibility: 2, boundariesConsistency: 3, conflictTolerance: 2 }) },
          { id: "phone-action-talk", label: "Сначала поговорю, зачем ему телефон ночью, и предложу вместе пересобрать правила сна.", rationale: "Уважает возраст и причину, но может размыть границу.", weights: w({ emotionalContact: 2, autonomySupport: 2, flexibility: 1, boundariesConsistency: -1 }) },
          { id: "phone-action-ban", label: "Заберу телефон на неопределенный срок, раз договориться невозможно.", rationale: "Сильная граница, но риск борьбы за контроль.", weights: w({ boundariesConsistency: 3, conflictTolerance: 2, autonomySupport: -2, emotionalContact: -1 }) },
          { id: "phone-action-own", label: "Скажу, что это его сон и его последствия, вмешиваться больше не буду.", rationale: "Передает ответственность, но может игнорировать возраст и режим.", weights: w({ autonomySupport: 3, adultResponsibility: -2, boundariesConsistency: -1 }) }
        ]
      },
      {
        id: "phone-priority",
        type: "priority",
        prompt: "Что здесь для вас главное?",
        options: [
          { id: "phone-priority-health", label: "Защитить сон и школьный режим.", rationale: "Взрослая ответственность.", weights: w({ adultResponsibility: 3, boundariesConsistency: 1 }) },
          { id: "phone-priority-contract", label: "Показать, что договоренности имеют последствия.", rationale: "Последовательность.", weights: w({ boundariesConsistency: 3, conflictTolerance: 2 }) },
          { id: "phone-priority-trust", label: "Сохранить доверие и не превращать телефон в войну.", rationale: "Контакт с подростком.", weights: w({ emotionalContact: 3, flexibility: 1 }) },
          { id: "phone-priority-autonomy", label: "Дать подростку больше ответственности за собственный режим.", rationale: "Самостоятельность.", weights: w({ autonomySupport: 3, adultResponsibility: -1 }) }
        ]
      },
      {
        id: "phone-open",
        type: "open",
        prompt: "Напишите первые две фразы подростку.",
        helper: "Не указывайте имена и другие личные данные ребенка.",
        minLength: 15,
        maxLength: 400
      },
      {
        id: "phone-twist",
        type: "twist",
        prompt: "Подросток объясняет, что ночью разговаривает с другом, которому сейчас тяжело. Что вы сделаете теперь?",
        options: [
          { id: "phone-twist-support-boundary", label: "Признаю важность друга, но предложу дневной способ поддержки и сохраню ночное правило.", rationale: "Сохраняет границу и смысл заботы.", weights: w({ adultResponsibility: 3, emotionalContact: 2, boundariesConsistency: 2, autonomySupport: 1, flexibility: 1 }) },
          { id: "phone-twist-exception", label: "Разрешу ночные разговоры на время, если ситуация у друга правда тяжелая.", rationale: "Сострадание, но риск разрушения режима.", weights: w({ emotionalContact: 3, flexibility: 2, boundariesConsistency: -2 }) },
          { id: "phone-twist-no-excuses", label: "Скажу, что чужие проблемы не причина нарушать правила дома.", rationale: "Последовательность, но мало признания мотива.", weights: w({ boundariesConsistency: 3, conflictTolerance: 2, emotionalContact: -2, flexibility: -1 }) },
          { id: "phone-twist-adult-help", label: "Предложу вместе подумать, как подключить взрослых, если другу нужна серьезная помощь.", rationale: "Не оставляет подростка одному с тяжелой ситуацией.", weights: w({ adultResponsibility: 3, emotionalContact: 2, difficultyVsUnsafety: 2, autonomySupport: 1 }) }
        ]
      }
    ]
  },
  {
    id: "chores",
    slug: "domashnyaya-obyazannost",
    title: "Домашняя обязанность",
    childAge: 12,
    scenario:
      "Ребенок 12 лет должен два раза в неделю убирать после ужина. Сегодня он отказывается и говорит, что у него много уроков.",
    checks: ["семейные договоренности", "учет нагрузки", "последовательность", "переговоры без капитуляции"],
    questions: [
      {
        id: "chores-action",
        type: "action",
        prompt: "Как вы поступите?",
        options: [
          { id: "chores-action-reschedule", label: "Уточню объем уроков и предложу перенести уборку на конкретное время сегодня или завтра утром.", rationale: "Гибкость без отмены обязанности.", weights: w({ adultResponsibility: 2, emotionalContact: 1, boundariesConsistency: 2, autonomySupport: 2, flexibility: 2 }) },
          { id: "chores-action-do-parent", label: "Уберу сама, чтобы он успел сделать уроки.", rationale: "Учитывает нагрузку, но снимает договоренность.", weights: w({ emotionalContact: 1, boundariesConsistency: -2, autonomySupport: -1, conflictTolerance: -1 }) },
          { id: "chores-action-now", label: "Скажу, что договоренности не обсуждаются, и уборка должна быть сделана сейчас.", rationale: "Сильная последовательность, но мало учета контекста.", weights: w({ boundariesConsistency: 3, conflictTolerance: 2, emotionalContact: -1, flexibility: -2 }) },
          { id: "chores-action-negotiate", label: "Предложу выбрать: убрать кухню быстро сейчас или взять другую семейную задачу на выходных.", rationale: "Переговоры и ответственность.", weights: w({ autonomySupport: 3, boundariesConsistency: 2, adultResponsibility: 1 }) }
        ]
      },
      {
        id: "chores-priority",
        type: "priority",
        prompt: "Что сейчас важнее всего?",
        options: [
          { id: "chores-priority-family", label: "Сохранить семейную договоренность.", rationale: "Обязательства внутри семьи.", weights: w({ boundariesConsistency: 3, conflictTolerance: 1 }) },
          { id: "chores-priority-load", label: "Понять реальную нагрузку ребенка.", rationale: "Учет состояния и контекста.", weights: w({ emotionalContact: 2, flexibility: 2 }) },
          { id: "chores-priority-responsibility", label: "Не забирать ответственность на себя.", rationale: "Самостоятельность.", weights: w({ autonomySupport: 3, adultResponsibility: 1 }) },
          { id: "chores-priority-calm", label: "Не доводить ситуацию до ссоры.", rationale: "Снижает напряжение, но может обходить конфликт.", weights: w({ emotionalContact: 2, conflictTolerance: -1 }) }
        ]
      },
      {
        id: "chores-open",
        type: "open",
        prompt: "Напишите, что вы скажете ребенку.",
        helper: "Не указывайте имена и другие личные данные ребенка.",
        minLength: 15,
        maxLength: 400
      }
    ]
  },
  {
    id: "hobby",
    slug: "bespoleznoe-uvlechenie",
    title: "«Бесполезное» увлечение",
    childAge: 13,
    scenario:
      "Ребенок хочет оставить дополнительную математику и заняться созданием костюмов для косплея. Вам кажется, что новое увлечение не принесет пользы в будущем.",
    checks: ["отделение интересов ребенка от ожиданий родителя", "поддержка самостоятельности", "отношение к результату", "навыки за непривычной деятельностью"],
    questions: [
      {
        id: "hobby-action",
        type: "action",
        prompt: "Что вы сделаете?",
        options: [
          { id: "hobby-action-trial", label: "Предложу пробный период: часть времени остается на математику, часть - на костюмы, потом смотрим на результат.", rationale: "Компромисс и наблюдение.", weights: w({ adultResponsibility: 2, autonomySupport: 2, boundariesConsistency: 1, flexibility: 2 }) },
          { id: "hobby-action-support", label: "Поддержу переход: если ребенку действительно интересно, он может попробовать всерьез.", rationale: "Высокая автономия, но возможен недоучет долгосрочных обязательств.", weights: w({ autonomySupport: 3, emotionalContact: 2, adultResponsibility: -1 }) },
          { id: "hobby-action-insist-math", label: "Настою на математике: увлечения можно делать после важных занятий.", rationale: "Фокус на будущем, но риск обесценить интерес.", weights: w({ adultResponsibility: 2, boundariesConsistency: 2, autonomySupport: -2, emotionalContact: -1 }) },
          { id: "hobby-action-research", label: "Попрошу показать, чему он хочет научиться, какие навыки там есть и как он видит план.", rationale: "Переводит спор о пользе в разговор о навыках.", weights: w({ autonomySupport: 3, emotionalContact: 2, adultResponsibility: 1, flexibility: 2 }) }
        ]
      },
      {
        id: "hobby-priority",
        type: "priority",
        prompt: "Что для вас сейчас важнее всего?",
        options: [
          { id: "hobby-priority-future", label: "Сохранить полезную траекторию на будущее.", rationale: "Взрослый горизонт.", weights: w({ adultResponsibility: 3, boundariesConsistency: 1 }) },
          { id: "hobby-priority-interest", label: "Не обесценить настоящий интерес ребенка.", rationale: "Контакт и уважение к субъектности.", weights: w({ emotionalContact: 2, autonomySupport: 2 }) },
          { id: "hobby-priority-plan", label: "Понять, есть ли у нового увлечения план и вложение усилий.", rationale: "Ответственность за выбор.", weights: w({ autonomySupport: 2, adultResponsibility: 2 }) },
          { id: "hobby-priority-balance", label: "Найти баланс между интересом и базовой учебной нагрузкой.", rationale: "Комбинирует границы и гибкость.", weights: w({ boundariesConsistency: 2, flexibility: 2, adultResponsibility: 1 }) }
        ]
      },
      {
        id: "hobby-open",
        type: "open",
        prompt: "Напишите первые две фразы ребенку.",
        helper: "Не указывайте имена и другие личные данные ребенка.",
        minLength: 15,
        maxLength: 400
      },
      {
        id: "hobby-twist",
        type: "twist",
        prompt: "Ребенок хочет потратить на материалы значительную часть подаренных денег. Что вы сделаете?",
        options: [
          { id: "hobby-twist-budget", label: "Помогу составить бюджет и лимит: часть денег можно потратить сейчас, часть оставить.", rationale: "Финансовая рамка и самостоятельность.", weights: w({ adultResponsibility: 2, autonomySupport: 3, boundariesConsistency: 2 }) },
          { id: "hobby-twist-free", label: "Раз это его подаренные деньги, пусть сам решает и получает опыт.", rationale: "Автономия, но возможен недоучет масштаба потери.", weights: w({ autonomySupport: 3, adultResponsibility: -1, boundariesConsistency: -1 }) },
          { id: "hobby-twist-forbid", label: "Запрещу тратить большую сумму на материалы, пока не увижу серьезности.", rationale: "Защищает ресурс, но может восприниматься как недоверие.", weights: w({ adultResponsibility: 2, boundariesConsistency: 2, autonomySupport: -2, emotionalContact: -1 }) },
          { id: "hobby-twist-require-plan", label: "Попрошу список материалов, альтернативы и план проекта перед покупкой.", rationale: "Сохраняет интерес и добавляет ответственность.", weights: w({ adultResponsibility: 2, autonomySupport: 2, boundariesConsistency: 1, flexibility: 1 }) }
        ]
      }
    ]
  },
  {
    id: "failure",
    slug: "posle-neudachnogo-vystupleniya",
    title: "После неудачного выступления",
    childAge: 12,
    scenario:
      "Ребенок долго готовился к олимпиаде или соревнованию, но показал слабый результат. Он говорит: «Больше никогда не буду участвовать».",
    checks: ["отношение к ошибке", "ориентация на процесс", "поддержка", "необесценивание разочарования", "разбор опыта"],
    questions: [
      {
        id: "failure-action",
        type: "action",
        prompt: "Что вы сделаете в первые минуты?",
        options: [
          { id: "failure-action-feelings-first", label: "Сначала признаю разочарование и не буду сразу разбирать ошибки.", rationale: "Контакт и уважение к переживанию.", weights: w({ emotionalContact: 3, flexibility: 1 }) },
          { id: "failure-action-review", label: "Предложу спокойно разобрать, что получилось и что можно улучшить в следующий раз.", rationale: "Ориентация на опыт, но может быть рано.", weights: w({ adultResponsibility: 2, autonomySupport: 1, emotionalContact: 1 }) },
          { id: "failure-action-insist-continue", label: "Скажу, что бросать после неудачи нельзя, нужно продолжать тренироваться.", rationale: "Выдерживает конфликт, но риск обесценивания.", weights: w({ boundariesConsistency: 2, conflictTolerance: 3, emotionalContact: -2, autonomySupport: -1 }) },
          { id: "failure-action-let-quit", label: "Скажу, что он может больше не участвовать, если ему так неприятно.", rationale: "Снижает давление, но может закрепить решение на пике эмоций.", weights: w({ emotionalContact: 1, autonomySupport: 2, adultResponsibility: -1, conflictTolerance: -1 }) }
        ]
      },
      {
        id: "failure-priority",
        type: "priority",
        prompt: "Что важнее всего сейчас?",
        options: [
          { id: "failure-priority-not-alone", label: "Чтобы ребенок не остался один со стыдом и разочарованием.", rationale: "Эмоциональная поддержка.", weights: w({ emotionalContact: 3 }) },
          { id: "failure-priority-experience", label: "Чтобы неудача стала опытом, а не точкой отказа.", rationale: "Взрослый взгляд на процесс.", weights: w({ adultResponsibility: 2, conflictTolerance: 1 }) },
          { id: "failure-priority-choice", label: "Чтобы он сам решил, хочет ли продолжать.", rationale: "Уважение выбора.", weights: w({ autonomySupport: 3 }) },
          { id: "failure-priority-effort", label: "Чтобы вложенные усилия не пропали зря.", rationale: "Последовательность, но возможен фокус на результате.", weights: w({ boundariesConsistency: 2, adultResponsibility: 1, emotionalContact: -1 }) }
        ]
      },
      {
        id: "failure-open",
        type: "open",
        prompt: "Напишите первые две фразы ребенку.",
        helper: "Не указывайте имена и другие личные данные ребенка.",
        minLength: 15,
        maxLength: 400
      }
    ]
  }
];

export const allQuestions = testCases.flatMap((testCase) =>
  testCase.questions.map((question) => ({ ...question, caseId: testCase.id }))
);
