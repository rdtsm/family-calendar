/** Keyword -> emoji, so the parent never has to open a picker. First match wins. */
const RULES: [RegExp, string][] = [
  [/box|karate|judo|taekwondo|martial/i, "🥊"],
  [/foot|soccer/i, "⚽"],
  [/basket/i, "🏀"],
  [/tennis|badminton/i, "🎾"],
  [/volley/i, "🏐"],
  [/swim|pool/i, "🏊"],
  [/dance|ballet/i, "🩰"],
  [/gym|fitness|workout/i, "🤸"],
  [/\brun|jog|athletic|track/i, "🏃"],
  [/cycl|bike/i, "🚴"],
  // Above the general music rule, or "drum lesson with music theory" is a piano.
  // Bounded, so a surname like Drummond is not a drum kit.
  [/\bdrums?\b|\bdrumming\b|percussion/i, "🥁"],
  [/piano|music|violin|guitar|choir/i, "🎹"],
  [/\bart\b|paint|draw/i, "🎨"],
  [/chess/i, "♟️"],
  [/code|robot|stem/i, "🤖"],
  [/german|deutsch/i, "🇩🇪"],
  [/chinese|mandarin|putonghua/i, "🇨🇳"],
  [/spanish|french|english|language/i, "🗣️"],
  // A subject, so it belongs with the languages — above the generic tuition and
  // school rules, or "maths tuition" is a stack of books and "maths class" a
  // satchel. Bounded on both sides so a Mathilda keeps her party.
  [/\bmaths?\b|\bmathematic|algebra|arithmetic/i, "🧮"],
  [/brunch/i, "🥐"],
  [/tuition|tutor|study|homework|revision|exam|test/i, "📚"],
  [/school|class|lesson/i, "🎒"],
  [/library|\bread|\bbook/i, "📖"],
  [/\bgam(e|es|ing)\b|xbox|playstation|minecraft|roblox/i, "🎮"],
  [/dentist|dental/i, "🦷"],
  [/doctor|clinic|hospital|vaccin|check.?up/i, "🩺"],
  [/haircut|barber|salon/i, "💇"],
  [/birthday/i, "🎂"],
  [/party|celebrat/i, "🎉"],
  [/playdate|play date|friend/i, "🧸"],
  [/movie|cinema|film/i, "🎬"],
  [/dinner|lunch|breakfast|meal|eat/i, "🍽️"],
  [/church|mosque|temple|pray/i, "🙏"],
  [/flight|airport|fly/i, "✈️"],
  [/train|bus|pickup|pick up|drop.?off/i, "🚌"],
  [/sleep|bed|nap/i, "😴"],
  [/clean|chore|tidy/i, "🧹"],
];

export function emojiFor(title: string): string {
  for (const [re, emoji] of RULES) if (re.test(title)) return emoji;
  return "📌";
}

/**
 * The first grapheme of whatever was typed, or null if there isn't one.
 * Graphemes rather than code points, so 👨‍👩‍👧 and 🇲🇾 survive as one character.
 * Used on both sides: the kid's input keeps exactly one, the server re-checks it.
 */
export function firstGrapheme(input: string): string | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const first = [...segmenter.segment(input.trim())][0]?.segment;
  return first && first.length <= 16 ? first : null;
}

/** One-tap presets in the parent form. */
export const QUICK_PICKS = [
  { title: "German", emoji: "🇩🇪" },
  { title: "Chinese", emoji: "🇨🇳" },
  { title: "Boxing", emoji: "🥊" },
  { title: "Swimming", emoji: "🏊" },
  { title: "Football", emoji: "⚽" },
  { title: "Playdate", emoji: "🧸" },
  { title: "Doctor", emoji: "🩺" },
  { title: "School", emoji: "🎒" },
  { title: "Brunch", emoji: "🥐" },
  { title: "Dinner", emoji: "🍽️" },
];

/** One-tap topics on the kid's own add sheet. Their words, not a parent's. */
export const KID_PICKS = [
  { title: "Football", emoji: "⚽" },
  { title: "Homework", emoji: "📚" },
  { title: "Reading", emoji: "📖" },
  { title: "Piano", emoji: "🎹" },
  { title: "Playdate", emoji: "🧸" },
  { title: "Drawing", emoji: "🎨" },
  { title: "Gaming", emoji: "🎮" },
  { title: "Cycling", emoji: "🚴" },
];
