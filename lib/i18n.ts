import type { Language } from "./schema";

// Labels for the family card, which is meant to be read by someone other than
// the person using the app. The Kannada and Hindi labels have not been
// reviewed by a fluent reader.
export const CARD_LABELS: Record<
  Language,
  {
    happened: string;
    when: string;
    where: string;
    todo: string;
    official: string;
    suggested: string;
    source: string;
    madeOn: string;
    disclaimer: string;
  }
> = {
  en: {
    happened: "What happened",
    when: "When",
    where: "Where",
    todo: "What to do",
    official: "From the notice",
    suggested: "Suggested precautions (not from the notice)",
    source: "Source",
    madeOn: "Made on",
    disclaimer: "Made by an AI tool from a photo. Please check the original notice.",
  },
  kn: {
    happened: "ಏನಾಯಿತು",
    when: "ಯಾವಾಗ",
    where: "ಎಲ್ಲಿ",
    todo: "ಏನು ಮಾಡಬೇಕು",
    official: "ಸೂಚನೆಯಲ್ಲಿ ಇರುವುದು",
    suggested: "ಸಲಹೆಗಳು (ಸೂಚನೆಯಲ್ಲಿ ಇಲ್ಲ)",
    source: "ಮೂಲ",
    madeOn: "ತಯಾರಿಸಿದ ದಿನ",
    disclaimer: "ಫೋಟೋದಿಂದ AI ಸಾಧನ ತಯಾರಿಸಿದೆ. ದಯವಿಟ್ಟು ಮೂಲ ಸೂಚನೆಯನ್ನು ಪರಿಶೀಲಿಸಿ.",
  },
  hi: {
    happened: "क्या हुआ",
    when: "कब",
    where: "कहाँ",
    todo: "क्या करना है",
    official: "सूचना में लिखा है",
    suggested: "सुझाव (सूचना में नहीं)",
    source: "स्रोत",
    madeOn: "बनाने की तारीख",
    disclaimer: "फोटो से AI टूल द्वारा बनाया गया। कृपया मूल सूचना देखें।",
  },
};
