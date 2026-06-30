import type { Language } from '../translations';

interface AboutPageProps {
  language: Language;
  onBack: () => void;
}

const copy = {
  ru: {
    eyebrow: 'Пространство совместной тишины',
    title: 'Место, где тишина становится общей',
    lead: 'ZenWorld соединяет людей в синхронной медитации: один таймер, одна музыка, один ритм дыхания — где бы вы ни находились.',
    back: 'Перейти к комнатам',
    principles: [
      ['Один ритм', 'Музыка, таймер и дыхание синхронизированы для всех участников комнаты.'],
      ['Живой голос', 'Ведущий может сопровождать практику голосом через микрофон — мягко и в реальном времени.'],
      ['Своя атмосфера', 'Выбирайте фон, звук, длительность и приватность комнаты под настроение вашей практики.'],
      ['Момент не потеряется', 'Комнаты и ход медитации сохраняются, а после краткого разрыва соединение восстанавливается.'],
    ],
    storyTitle: 'Не ещё одна социальная сеть',
    story: 'Здесь нет ленты, рейтингов и гонки за вниманием. ZenWorld задуман как тихая цифровая комната, куда можно прийти одному или вместе с близкими — замедлиться, услышать дыхание и ненадолго перестать куда-либо спешить.',
    accent: 'Расстояние остаётся снаружи. Внутри комнаты вы проживаете одну и ту же минуту вместе.',
    stepsTitle: 'Начать проще, чем успеть отвлечься',
    steps: [
      ['01', 'Создайте комнату', 'Назовите её, выберите музыку, фон и продолжительность.'],
      ['02', 'Позовите своих', 'Отправьте ссылку друзьям или оставьте комнату открытой для сообщества.'],
      ['03', 'Дышите вместе', 'Запустите практику — ZenWorld синхронизирует всё остальное.'],
    ],
    closing: 'Иногда достаточно одной общей паузы, чтобы снова почувствовать себя рядом.',
  },
  en: {
    eyebrow: 'A space for shared stillness',
    title: 'Where silence becomes something we share',
    lead: 'ZenWorld brings people into one synchronized meditation: one timer, one soundscape, one breathing rhythm — wherever you are.',
    back: 'Explore rooms',
    principles: [
      ['One rhythm', 'Music, timing, and breathing stay synchronized for everyone in the room.'],
      ['A human voice', 'A host can gently guide the practice live through their microphone.'],
      ['Your atmosphere', 'Choose the scenery, sound, duration, and privacy that fit the moment.'],
      ['The moment remains', 'Rooms and meditation progress persist, while brief disconnects recover automatically.'],
    ],
    storyTitle: 'Not another social network',
    story: 'There is no feed, ranking, or contest for attention here. ZenWorld is a quiet digital room you can enter alone or with people you care about — to slow down, hear your breath, and stop rushing for a little while.',
    accent: 'Distance stays outside. Inside the room, everyone shares the very same minute.',
    stepsTitle: 'Begin before distraction catches up',
    steps: [
      ['01', 'Create a room', 'Give it a name, then choose the sound, scenery, and duration.'],
      ['02', 'Invite your people', 'Share a link with friends or leave the room open to the community.'],
      ['03', 'Breathe together', 'Start the practice — ZenWorld keeps everything else in sync.'],
    ],
    closing: 'Sometimes one shared pause is enough to feel close again.',
  },
} as const;

export function AboutPage({ language, onBack }: AboutPageProps) {
  const text = copy[language];

  return (
    <section className="about-page">
      <div className="about-hero glass-panel">
        <div className="about-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="about-hero-copy">
          <div className="about-eyebrow">{text.eyebrow}</div>
          <h1>{text.title}</h1>
          <p>{text.lead}</p>
          <button className="btn btn-primary about-cta" onClick={onBack}>
            {text.back}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <div className="about-principles">
        {text.principles.map(([title, description], index) => (
          <article className="glass-panel about-principle" key={title}>
            <span className="about-principle-number">0{index + 1}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </div>

      <div className="about-story">
        <div>
          <div className="about-eyebrow">ZenWorld</div>
          <h2>{text.storyTitle}</h2>
        </div>
        <div>
          <p>{text.story}</p>
          <blockquote>{text.accent}</blockquote>
        </div>
      </div>

      <div className="about-how">
        <div className="about-eyebrow">{text.stepsTitle}</div>
        <div className="about-steps">
          {text.steps.map(([number, title, description]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="about-closing">
        <div className="brand-icon" aria-hidden="true" />
        <p>{text.closing}</p>
        <button className="text-button" onClick={onBack}>{text.back} →</button>
      </div>
    </section>
  );
}
